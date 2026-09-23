import assert from "node:assert/strict";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

const appUrl = new URL("../src/client/App.svelte", import.meta.url);
const turn = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function eventHarness(recordScenarioEvent) {
  return componentFunctionHarness(appUrl, [
    "recordBackgroundScenarioEvent", "sendBackgroundScenarioEvent", "isUnauthorizedFailure", "requiresPlayerEntry", "PROGRESSION_RETRY_DELAYS_MS"
  ], {
    backgroundScenarioEventQueue: Promise.resolve(), playerOperationGeneration: 0,
    uiState: { sessionToken: "session", locked: false }, globalErrorVisible: false,
    recordScenarioEvent, applyErrorPlayerState() {},
    showGlobalError() { this.globalErrorVisible = true; }, waitMs: () => Promise.resolve()
  });
}

test("進行通知は再試行待ちも含めてcue順を守り、呼出元の状態反映より後に次を送る", async () => {
  const events = [];
  let attempts = 0;
  const retry = deferred();
  const context = eventHarness(async (_token, id) => {
    events.push(id);
    if (id === "cue1" && ++attempts === 1) return { ok: false, error: "temporary", retryable: true };
    return { ok: true };
  });
  context.waitMs = () => retry.promise;
  const pending = ["cue1", "cue2", "complete"].map((id) => context.recordBackgroundScenarioEvent("session", id, {})
    .then((result) => { if (result?.ok) events.push(`適用:${id}`); }));
  await turn();
  assert.deepEqual(events, ["cue1"]);
  retry.resolve();
  await Promise.all(pending);
  assert.deepEqual(events, ["cue1", "cue1", "適用:cue1", "cue2", "適用:cue2", "complete", "適用:complete"]);
});

test("再試行を使い切った進行通知は明示エラーになり、後続cueを実行しない", async () => {
  const sent = [];
  const context = eventHarness(async (_token, id) => {
    sent.push(id);
    return { ok: false, error: "temporary", retryable: true };
  });
  context.showGlobalError = () => { context.globalErrorVisible = true; };
  await Promise.all([context.recordBackgroundScenarioEvent("session", "cue1", {}), context.recordBackgroundScenarioEvent("session", "cue2", {})]);
  assert.deepEqual(sent, ["cue1", "cue1", "cue1"]);
  assert.equal(context.globalErrorVisible, true);
});

test("同じtokenのリセット後は待機済み旧通知を送らず、新しい通知は受理する", async () => {
  const response = deferred();
  const sent = [];
  const context = eventHarness(async (_token, id) => {
    sent.push(id);
    return id === "old1" ? response.promise : { ok: true };
  });
  const first = context.recordBackgroundScenarioEvent("session", "old1", {});
  const second = context.recordBackgroundScenarioEvent("session", "old2", {});
  await turn();
  context.playerOperationGeneration += 1;
  const fresh = context.recordBackgroundScenarioEvent("session", "new", {});
  response.resolve({ ok: true });
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal((await fresh).ok, true);
  assert.deepEqual(sent, ["old1", "new"]);
});

test("ロック中のProjectStage通知許可を保ち、演出cancelだけでは到達通知を捨てない", async () => {
  const response = deferred();
  const sent = [];
  const context = eventHarness(async (_token, id) => {
    sent.push(id);
    return id === "cue" ? response.promise : { ok: true };
  });
  const cue = context.recordBackgroundScenarioEvent("session", "cue", {});
  const completed = context.recordBackgroundScenarioEvent("session", "complete", {});
  await turn();
  context.presentationGeneration = 100;
  response.resolve({ ok: true });
  await Promise.all([cue, completed]);
  context.uiState.locked = true;
  assert.equal(await context.recordBackgroundScenarioEvent("session", "locked-audio", {}), null);
  assert.equal((await context.recordBackgroundScenarioEvent("session", "project", {}, { stopWhenLocked: false })).ok, true);
  assert.deepEqual(sent, ["cue", "complete", "project"]);
});

function navigationHarness() {
  const response = deferred();
  const focused = [];
  const states = [];
  const context = componentFunctionHarness(appUrl, ["captureContentNavigation", "contentOpenKey", "openAppContent", "handleOpenSearchAgentResult", "openTalkMessageLink"], {
    searchAgentCloseRequestId: 0, contentNavigationRequestId: 0, phoneHistoryScope: "scope", phoneHistoryNavigationId: 0,
    uiState: { sessionToken: "session", locked: false }, globalErrorVisible: false,
    shadeOpen: false, transientAssistantMessage: undefined, suppressedContentOpenKeys: [], inFlightContentOpenKeys: [],
    displayedTalkTarget: null, notificationToast: null,
    playerState: null,
    focusedTalkHistoryRepairId: "", showTransientAssistantMessage() {}, rememberAppContent() {},
    isSearchAgentResultAlreadyRepaired: () => false,
    openContentFromExplicitNavigation: () => response.promise,
    handleContentOpen: () => response.promise, openMessageLink: () => response.promise,
    applyPlayerState(state) { states.push(state); return true; }, applyErrorPlayerState() {},
    enqueuePresentation() {}, showTalkBackLink() {},
    focusOpenedContent(...args) { focused.push(args); }
  });
  return { context, response, focused, states };
}

function inFlightNavigationHarness() {
  const harness = navigationHarness();
  let requests = 0;
  Object.assign(harness.context, {
    qaMode: false, playerState: { stateVersion: 1, visibleDeviceState: { apps: [] }, contentStates: [] },
    apps: [{ id: "notes", available: true }],
    deviceState: { notifications: [{ id: "notification", appId: "notes", targetContentId: "note" }] },
    pendingTalkReadCursorPayload: () => [], clearSyncedTalkReadCursors() {},
    queueAlbumMediaAddedAssistant() {}, syncPhoneHistoryContent() {},
    recordContentOpened() { requests += 1; return harness.response.promise; }
  });
  // in-flight判定と通知のclose要求も実関数を通し、通信だけを保留する。
  componentFunctionHarness(appUrl, [
    "handleContentOpen", "openContentFromExplicitNavigation", "openNotification", "openNotificationApp", "requestSearchAgentClose"
  ], harness.context);
  return { ...harness, get requests() { return requests; } };
}

test("遷移先のないリンク成功も状態と演出を適用し、画面を移動しない", async () => {
  const { context, response, focused, states } = navigationHarness();
  const presentations = [];
  context.enqueuePresentation = value => presentations.push(value);
  const pending = context.openTalkMessageLink("talk", "message", 0, { backLinkSource: null });
  const presentation = { effects: [{ type: "noise", durationMs: 100 }] };
  response.resolve({ ok: true, playerState: { stateVersion: 2 }, target: null, presentation });
  await pending;
  assert.equal(states.length, 1);
  assert.deepEqual(presentations, [presentation]);
  assert.deepEqual(focused, []);
});

test("同じ対象の開封待ちに再選択しても先行要求を取消さず一度だけ開く", async () => {
  const harness = inFlightNavigationHarness();
  const { context, response, focused, states } = harness;
  const first = context.openAppContent(context.apps[0], "note");
  const requestId = context.contentNavigationRequestId;
  const repeated = await context.openAppContent(context.apps[0], "note");
  assert.equal(repeated, false);
  assert.equal(context.contentNavigationRequestId, requestId);
  assert.equal(harness.requests, 1);
  response.resolve({ ok: true, playerState: { stateVersion: 2 } });
  assert.equal(await first, true);
  assert.deepEqual(focused, [["notes", "note"]]);
  assert.equal(states.length, 1);
});

test("同じ通知の開封待ちに一覧を開き直してもclose要求で先行遷移を取消さない", async () => {
  const harness = inFlightNavigationHarness();
  const { context, response, focused } = harness;
  const pending = [];
  const openAppContent = context.openAppContent;
  context.openAppContent = (...args) => {
    const result = openAppContent(...args);
    pending.push(result);
    return result;
  };
  context.openNotification("notification");
  const closeRequestId = context.searchAgentCloseRequestId;
  context.shadeOpen = true;
  context.openNotification("notification");
  assert.equal(context.searchAgentCloseRequestId, closeRequestId);
  assert.equal(harness.requests, 1);
  response.resolve({ ok: true, playerState: { stateVersion: 2 } });
  await Promise.all(pending);
  assert.deepEqual(focused, [["notes", "note"]]);
});

for (const operation of ["通知", "検索", "本文リンク"]) {
  test(`${operation}の旧応答は後から選ばれた画面へ割り込まない`, async () => {
    const { context, response, focused, states } = navigationHarness();
    const pending = operation === "通知" ? context.openAppContent({ id: "notes", available: true }, "note")
      : operation === "検索" ? context.handleOpenSearchAgentResult({ appId: "notes", contentId: "note", repairable: false })
      : context.openTalkMessageLink("talk", "message", 0, { backLinkSource: null });
    context.searchAgentCloseRequestId += 1;
    response.resolve(operation === "本文リンク" ? { ok: true, playerState: { stateVersion: 2 }, target: { appId: "notes", contentId: "note" } } : true);
    const navigated = await pending;
    assert.deepEqual(focused, []);
    if (operation === "通知") assert.equal(navigated, false, "古い開封の呼出元にも遷移中止を返す");
    if (operation === "本文リンク") assert.equal(states.length, 1, "確定済みの進行は取り込む");
  });
}

test("背景の開封報告による履歴番号更新は正当な明示遷移を取り消さない", async () => {
  const { context, response, focused } = navigationHarness();
  const pending = context.openAppContent({ id: "notes", available: true }, "note");
  context.phoneHistoryNavigationId += 2;
  response.resolve(true);
  await pending;
  assert.deepEqual(focused, [["notes", "note"]]);
});

for (const firstResponse of ["old", "new"]) {
  test(`本文リンクを続けて押した場合は応答順${firstResponse}にかかわらず最後の対象へ移動する`, async () => {
    const { context, focused } = navigationHarness();
    const replies = { old: deferred(), new: deferred() };
    context.openMessageLink = async (_token, request) => {
      await replies[request.messageRef].promise;
      return { ok: true, playerState: {}, target: { appId: "notes", contentId: request.messageRef } };
    };
    context.focusOpenedContent = (...target) => {
      focused.push(target);
      context.searchAgentCloseRequestId += 1;
    };
    context.openContentFromExplicitNavigation = () => Promise.resolve(true);
    const old = context.openTalkMessageLink("talk", "old", 0, { backLinkSource: null });
    const latest = context.openTalkMessageLink("talk", "new", 0, { backLinkSource: null });
    replies[firstResponse].resolve();
    await turn();
    replies[firstResponse === "old" ? "new" : "old"].resolve();
    await Promise.all([old, latest]);
    assert.deepEqual(focused, [["notes", "new"]]);
  });
}

test("リセット・別session・ロック・エラー後の旧画面遷移を適用しない", () => {
  for (const change of [
    (context) => { context.phoneHistoryScope = "new"; },
    (context) => { context.uiState.sessionToken = "new"; },
    (context) => { context.uiState.locked = true; },
    (context) => { context.globalErrorVisible = true; }
  ]) {
    const { context } = navigationHarness();
    const current = context.captureContentNavigation();
    assert.equal(current(), true);
    change(context);
    assert.equal(current(), false);
  }
});

test("過去の予定時刻にも取得間隔を保ち、遠い予定は元の時刻まで待つ", () => {
  const delays = [];
  const context = componentFunctionHarness(appUrl, ["syncScenarioWakeTimer", "SCENARIO_WAKE_TIMER_MIN_MS", "SCENARIO_WAKE_TIMER_MAX_MS"], {
    qaMode: false, scenarioWakeTimer: undefined, scenarioWakeTimerKey: "", scenarioWakeGeneration: 0,
    window: { clearTimeout() {}, setTimeout(_callback, ms) { delays.push(ms); return delays.length; } }
  });
  context.syncScenarioWakeTimer("2000-01-01T00:00:00Z", "token", false, false);
  assert.ok(delays[0] >= 250 && delays[0] <= 1000);
  const future = Date.now() + 10_000;
  context.syncScenarioWakeTimer(new Date(future).toISOString(), "token", false, false);
  assert.ok(delays[1] >= 9_000 && delays[1] <= 10_000);
});
