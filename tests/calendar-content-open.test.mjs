import assert from "node:assert/strict";
import test from "node:test";
import { parseStoryDate, storyWeekFor } from "../src/shared/storyDate.ts";
import { componentFunctionHarness, componentScriptHarness } from "./helpers/component-script-harness.mjs";

const turn = () => new Promise(setImmediate);
const calendarUrl = new URL("../src/client/apps/CalendarApp.svelte", import.meta.url);
const makeEvents = (count, date = "2026-09-05") => Array.from({ length: count }, (_, index) => ({
  id: `${date}-${index}`, contentId: `content-${date}-${index}`, date,
  time: "10:00", title: `予定${index}`, place: "", memo: ""
}));

function calendarHarness(props) {
  return componentScriptHarness(calendarUrl, { currentDate: "2026-09-05", ...props }, { parseStoryDate, storyWeekFor });
}

// 親の実開封handlerとCalendarの実送信列をつなぎ、個別失敗と列の中断を区別する。
function calendarAppHarness() {
  const sent = [];
  const context = {
    uiState: { sessionToken: "session", locked: false }, playerOperationGeneration: 0,
    globalErrorVisible: false, activeIncomingCall: undefined, pendingPresentationSequenceCount: 0,
    qaMode: false, inFlightContentOpenKeys: [], suppressedContentOpenKeys: [], phoneHistoryNavigationId: 0,
    playerState: { stateVersion: 1, revision: "current", clientRevision: "client" },
    rememberAppContent() {}, syncPhoneHistoryContent() {}, clearSyncedTalkReadCursors() {},
    pendingTalkReadCursorPayload: () => [], queueAlbumMediaAddedAssistant() {}, enqueuePresentation() {},
    applyErrorPlayerState() {}, waitMs: () => Promise.resolve()
  };
  context.recordContentOpened = async (_token, { contentId }) => {
    sent.push(contentId);
    return { ok: true, playerState: context.playerState };
  };
  context.applyPlayerState = (state) => {
    if (state.stateVersion < context.playerState.stateVersion) return false;
    context.playerState = state;
    return true;
  };
  context.showGlobalError = () => { context.globalErrorVisible = true; };
  componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), [
    "handleCalendarContentOpen", "handleContentOpen", "contentOpenKey", "PROGRESSION_RETRY_DELAYS_MS"
  ], context);
  return { context, sent, mount: () => calendarHarness({ events: makeEvents(3), onContentOpen: context.handleCalendarContentOpen }) };
}

test("同日の一件が別経路で開封中でも、その後の予定の開封報告を続ける", async () => {
  const { context, sent, mount } = calendarAppHarness();
  const events = makeEvents(3);
  context.inFlightContentOpenKeys.push(`calendar:${events[1].contentId}`);
  const harness = mount();
  await harness.evaluate("contentOpenQueue");
  assert.deepEqual(sent, [events[0].contentId, events[2].contentId]);
});

test("個別の利用不能・古い成功応答では同日の後続を止めない", async () => {
  for (const result of [
    { ok: false, error: "not_available" },
    { ok: true, playerState: { stateVersion: 0, revision: "older", clientRevision: "client" } }
  ]) {
    const { context, sent, mount } = calendarAppHarness();
    const events = makeEvents(3);
    const original = context.recordContentOpened;
    context.recordContentOpened = async (token, payload) => {
      const success = await original(token, payload);
      return payload.contentId === events[1].contentId ? result : success;
    };
    const harness = mount();
    await harness.evaluate("contentOpenQueue");
    assert.deepEqual(sent, events.map((event) => event.contentId));
  }
});

test("着信・エラー・終了演出・ロック・session終了・リセットは開封の前後で中断する", async () => {
  const interruptions = [
    (context) => { context.activeIncomingCall = { id: "call" }; },
    (context) => { context.globalErrorVisible = true; },
    (context) => { context.pendingPresentationSequenceCount = 1; },
    (context) => { context.uiState.locked = true; },
    (context) => { context.uiState.sessionToken = undefined; },
    (context) => { context.playerOperationGeneration += 1; }
  ];
  for (const interrupt of interruptions) {
    const { context, sent, mount } = calendarAppHarness();
    const original = context.recordContentOpened;
    context.recordContentOpened = async (...args) => {
      const result = await original(...args);
      interrupt(context);
      return result;
    };
    const harness = mount();
    await harness.evaluate("contentOpenQueue");
    assert.deepEqual(sent, [makeEvents(3)[0].contentId]);
  }
  for (const interrupt of interruptions.slice(0, -1)) {
    const { context, sent, mount } = calendarAppHarness();
    interrupt(context);
    const harness = mount();
    await harness.evaluate("contentOpenQueue");
    assert.deepEqual(sent, []);
  }
});

test("同日9件の開封hookは直前の完了を待ち、最大同時実行数1で全件成功する", async () => {
  const events = makeEvents(9);
  const opened = [];
  const committed = [];
  let release;
  let inFlight = 0;
  let maximumInFlight = 0;
  const harness = calendarHarness({
    events,
    async onContentOpen(contentId) {
      opened.push(contentId);
      maximumInFlight = Math.max(maximumInFlight, ++inFlight);
      await new Promise((resolve) => { release = resolve; });
      committed.push(contentId);
      inFlight -= 1;
      return true;
    }
  });
  for (let index = 0; index < 9; index += 1) {
    await turn();
    assert.deepEqual(opened, events.slice(0, index + 1).map((event) => event.contentId));
    assert.equal(committed.length, index);
    release();
  }
  await harness.evaluate("contentOpenQueue");
  assert.deepEqual(committed, events.map((event) => event.contentId));
  assert.equal(maximumInFlight, 1);
  harness.flush();
  await turn();
  assert.equal(opened.length, 9);
});

test("開封待ちに日付を切り替えても閲覧対象は即時変わり、送信列は増えない", async () => {
  const first = makeEvents(2);
  const second = makeEvents(2, "2026-09-06");
  const opened = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const harness = calendarHarness({
    events: [...first, ...second],
    async onContentOpen(contentId) {
      opened.push(contentId);
      if (opened.length === 1) await gate;
      return true;
    }
  });
  await turn();
  harness.evaluate("moveSelectedDate(1)");
  harness.flush();
  assert.equal(harness.evaluate("selectedDate"), "2026-09-06");
  assert.deepEqual(Array.from(harness.evaluate("selectedEvents")), second);
  await turn();
  assert.deepEqual(opened, [first[0].contentId]);
  release();
  await harness.evaluate("contentOpenQueue");
  assert.deepEqual(opened, [...first, ...second].map((event) => event.contentId));
});

for (const switchAt of ["待機中", "応答後"]) {
  test(`falseでは当該日付の残りだけを中止し、${switchAt}に選んだ別日付の開封は続行する`, async () => {
    const first = makeEvents(3);
    const second = makeEvents(2, "2026-09-06");
    const opened = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const harness = calendarHarness({
      events: [...first, ...second],
      async onContentOpen(contentId) {
        opened.push(contentId);
        await gate;
        return contentId !== first[0].contentId;
      }
    });
    await turn();
    if (switchAt === "待機中") {
      harness.evaluate("moveSelectedDate(1)");
      harness.flush();
    }
    release();
    await harness.evaluate("contentOpenQueue");
    if (switchAt === "応答後") {
      assert.deepEqual(opened, [first[0].contentId]);
      harness.evaluate("moveSelectedDate(1)");
      harness.flush();
      await harness.evaluate("contentOpenQueue");
    }
    assert.deepEqual(opened, [first[0].contentId, ...second.map((event) => event.contentId)]);
  });
}

test("開封callbackの例外は握りつぶさず列をrejectし、後続も送信しない", async () => {
  const first = makeEvents(3);
  const second = makeEvents(2, "2026-09-06");
  const opened = [];
  const failure = new Error("検証用の失敗");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const harness = calendarHarness({
    events: [...first, ...second],
    async onContentOpen(contentId) {
      opened.push(contentId);
      await gate;
      throw failure;
    }
  });
  await turn();
  harness.evaluate("moveSelectedDate(1)");
  harness.flush();
  const rejected = assert.rejects(harness.evaluate("contentOpenQueue"), (error) => error === failure);
  release();
  await rejected;
  assert.deepEqual(opened, [first[0].contentId]);
});

test("破棄後は現在の日付と待機中の別日付の残りを開封しない", async () => {
  const first = makeEvents(3);
  const second = makeEvents(2, "2026-09-06");
  const opened = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const harness = calendarHarness({
    events: [...first, ...second],
    async onContentOpen(contentId) {
      opened.push(contentId);
      await gate;
      return true;
    }
  });
  await turn();
  harness.evaluate("moveSelectedDate(1)");
  harness.flush();
  harness.destroy();
  release();
  await harness.evaluate("contentOpenQueue");
  harness.evaluate("moveSelectedDate(-1)");
  harness.flush();
  await harness.evaluate("contentOpenQueue");
  assert.deepEqual(opened, [first[0].contentId]);
});

test("初回送信より前に破棄されたカレンダーは開封を送らない", async () => {
  const opened = [];
  const harness = calendarHarness({ events: makeEvents(2), onContentOpen(contentId) { opened.push(contentId); return true; } });
  harness.destroy();
  await harness.evaluate("contentOpenQueue");
  assert.deepEqual(opened, []);
});

test("破損予定は自動開封せず、未指定callbackと空の予定も安全に扱う", async () => {
  const events = makeEvents(3);
  events[1].corrupted = true;
  const opened = [];
  const harness = calendarHarness({ events, onContentOpen(contentId) { opened.push(contentId); return true; } });
  await harness.evaluate("contentOpenQueue");
  assert.deepEqual(opened, [events[0].contentId, events[2].contentId]);
  const withoutCallback = calendarHarness({ events });
  await withoutCallback.evaluate("contentOpenQueue");
  assert.equal(withoutCallback.evaluate("contentOpenDestroyed"), false);
  const empty = calendarHarness({ events: [] });
  await empty.evaluate("contentOpenQueue");
  assert.equal(empty.evaluate("contentOpenDestroyed"), false);
});
