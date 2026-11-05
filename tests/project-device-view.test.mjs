import assert from "node:assert/strict";
import { resourceUrl } from "../src/client/system/resourceUrls.ts";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { compile, parse } from "svelte/compiler";
import * as serverRuntime from "svelte/internal/server";
import { render } from "svelte/server";
import ts from "typescript";
import { deviceViewFor } from "../src/client/system/deviceView.ts";
import { hasAssistantCandidate } from "../src/shared/assistantMessages.ts";
import { latestQuickReplyPlacement, resolvedTalkInputState } from "../src/client/system/talkInputState.ts";
import { quickReplyLabel, quickReplyText } from "../src/shared/quickReplies.ts";
import { componentFunctionHarness, componentScriptHarness } from "./helpers/component-script-harness.mjs";

const baseViewInput = {
  locked: false,
  appId: null,
  searchAgentOpen: false,
  notificationShadeOpen: false,
  incomingCallActive: false,
  effectActive: false
};

test("端末表示snapshotはホームと実表示中のアプリを区別する", () => {
  assert.deepEqual(deviceViewFor(baseViewInput), { screen: "home", appId: null });
  assert.deepEqual(deviceViewFor({ ...baseViewInput, appId: "notes" }), { screen: "app", appId: "notes" });
});

test("重なりは着信・演出・ロック・検索・通知・アプリの順に返す", () => {
  const layers = [
    ["incomingCallActive", "incoming_call"],
    ["effectActive", "effect"],
    ["locked", "lock"],
    ["searchAgentOpen", "search_agent"],
    ["notificationShadeOpen", "notification_shade"]
  ];
  for (let mask = 0; mask < 2 ** layers.length; mask += 1) {
    const input = { ...baseViewInput, appId: "notes" };
    for (const [index, [flag]] of layers.entries()) input[flag] = Boolean(mask & (1 << index));
    const foreground = layers.find(([flag]) => input[flag])?.[1] ?? "app";
    assert.deepEqual(deviceViewFor(input), {
      screen: foreground,
      appId: foreground === "app" ? "notes" : null
    });
  }
});

test("snapshotは読み取り専用の2項目だけで、以前の値を後から変更しない", () => {
  const input = { ...baseViewInput, appId: "browser" };
  const previous = deviceViewFor(input);
  input.appId = null;
  const current = deviceViewFor(input);
  assert.equal(Object.isFrozen(previous), true);
  assert.throws(() => { previous.screen = "home"; }, TypeError);
  assert.deepEqual(previous, { screen: "app", appId: "browser" });
  assert.deepEqual(current, { screen: "home", appId: null });
  assert.deepEqual(Object.keys(current).sort(), ["appId", "screen"]);
});

const searchAgentUrl = new URL("../src/client/system/SearchAgent.svelte", import.meta.url);

test("検索結果から親だけを修復した場合も案内し、同じ結果を開き直しても修復案内を繰り返さない", async () => {
  const messages = [];
  const state = { visibleDeviceState: { apps: [{ id: "chat", available: false, corrupted: true }] }, contentStates: [] };
  const context = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), [
    "handleOpenSearchAgentResult", "isSearchAgentResultAlreadyRepaired"
  ], {
    uiState: { sessionToken: "session" }, playerState: state, displayedTalkTarget: null, hasAssistantCandidate,
    captureContentNavigation: () => () => true,
    handleContentOpen: async () => { state.visibleDeviceState.apps = [{ id: "chat", available: true, corrupted: false }]; return true; },
    focusOpenedContent() {}, showAssistantNotice: (...args) => messages.push(args)
  });
  const result = { appId: "chat", contentId: "room", targetKind: "content", repairable: true };
  assert.equal(await context.handleOpenSearchAgentResult(result), true);
  assert.equal(messages.length, 1);
  assert.equal(await context.handleOpenSearchAgentResult(result), true);
  assert.equal(messages.length, 1);
});

test("修復の案内は、開いた先の画面に条件成立済みの案内候補があれば出さない", async () => {
  for (const [label, assistantMessages, expected] of [
    ["候補なし", [], 1],
    ["別画面の候補", [{ id: "home", trigger: "screen:home", body: "", weight: 1 }], 1],
    ["weight 0の候補", [{ id: "zero", trigger: "screen:notes", body: "", weight: 0 }], 1],
    ["開いた先の候補", [{ id: "notes", trigger: "screen:notes", body: "", weight: 1 }], 0]
  ]) {
    for (const targetKind of ["content", "talk_history"]) {
      const messages = [];
      const state = { visibleDeviceState: { apps: [] }, contentStates: [], assistantMessages };
      const context = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), [
        "handleOpenSearchAgentResult", "isSearchAgentResultAlreadyRepaired"
      ], {
        uiState: { sessionToken: "session" }, playerState: state, displayedTalkTarget: null, hasAssistantCandidate,
        captureContentNavigation: () => () => true,
        handleContentOpen: async () => { state.contentStates = [{ contentId: "note", state: "repaired" }]; return true; },
        focusOpenedContent() {}, rememberAppContent() {}, focusedTalkHistoryRepairId: "",
        showAssistantNotice: (...args) => messages.push(args)
      });
      const result = { appId: "notes", contentId: "note", targetKind, targetTalkId: "talk", repairable: true };
      assert.equal(await context.handleOpenSearchAgentResult(result), true);
      assert.equal(messages.length, expected, `${label}/${targetKind}`);
    }
  }
});

function searchAgentHarness(props = {}, dependencies = {}) {
  return componentScriptHarness(searchAgentUrl, {
    deviceState: { apps: [] },
    talk: { talkId: "search", messages: [] },
    selectOpenFailureMessage: () => "開けませんでした。",
    ...props
  }, {
    appCatalog: [],
    Element: class Element {},
    tick: () => Promise.resolve(),
    window: { clearTimeout() {}, matchMedia: () => ({ matches: false }) },
    loadTalkDelaySeenMessages: () => ({}),
    saveTalkDelaySeenMessages() {},
    resolvedTalkInputState: () => ({ visible: true, canSubmit: true }),
    latestQuickReplyPlacement: () => undefined,
    quickReplyLabel, quickReplyText,
    ...dependencies
  });
}

test("検索アイコンと吹き出しは開いた扱いにせず、初期化中に親へ同期通知しない", () => {
  const opened = [];
  const harness = searchAgentHarness({
    peeking: true,
    onOpenChange: (open) => opened.push(open)
  });
  assert.equal(harness.evaluate("expanded"), false);
  assert.deepEqual(opened, []);
  harness.update({ surfaceMessage: { id: "hello", body: "案内", surface: "home" } });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  assert.equal(harness.evaluate("expanded"), false);
  assert.deepEqual(opened, []);
});

test("検索の手動開閉は実expandedの更新直後に通知する", () => {
  const opened = [];
  const harness = searchAgentHarness({ onOpenChange: (open) => opened.push(open) });
  harness.evaluate("toggleExpanded()");
  assert.equal(harness.evaluate("expanded"), true);
  assert.deepEqual(opened, [true], "flushを待たず、実際の開いた状態を通知する");
  harness.evaluate("closeExpanded()");
  assert.equal(harness.evaluate("expanded"), false);
  assert.deepEqual(opened, [true, false]);
  harness.evaluate("toggleExpanded(); toggleExpanded()");
  assert.deepEqual(opened, [true, false, true, false]);
  harness.flush();
  assert.deepEqual(opened, [true, false, true, false], "後から古いtrueを再通知しない");
});

test("検索の開閉通知は手動操作と強制閉じ・破棄を区別する", async () => {
  const opened = [];
  const harness = searchAgentHarness({
    onOpenChange: (open, source) => opened.push([open, source]),
    onOpenSearchAgentResult: async () => true
  });
  harness.evaluate("openExpanded(); closeExpanded(); openExpanded()");
  harness.update({ closeRequestId: 1 });
  harness.evaluate("openExpanded()");
  await harness.evaluate('openResult({ appId: "notes", contentId: "note" })');
  harness.destroy();
  assert.deepEqual(opened, [
    [true, "user"], [false, "user"], [true, "user"], [false, "system"],
    [true, "user"], [false, "system"], [false, "system"]
  ]);
});

test("検索の履歴復元は画面変更・強制閉じの後に開き、表示件数と位置を復元してfocusを動かさない", async () => {
  const opened = [];
  const positions = [];
  let focused = 0;
  const restoredList = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
  const harness = searchAgentHarness({
    onOpenChange: (open, source) => opened.push([open, source]),
    onScrollChange: (position) => positions.push({ ...position })
  }, {
    restoredList,
    restoredInput: { focus() { focused += 1; } },
    window: { clearTimeout() {}, matchMedia: () => ({ matches: true }) }
  });
  harness.evaluate("messageListElement = restoredList; inputElement = restoredInput");
  harness.update({
    surfaceKey: "notes", closeRequestId: 1,
    restoreRequest: { id: 1, open: true, scrollTop: 173, visibleMessageCount: 120 }
  });
  await new Promise(setImmediate);
  assert.equal(harness.evaluate("expanded"), true);
  assert.equal(harness.evaluate("visibleMessageCount"), 120);
  assert.equal(restoredList.scrollTop, 173);
  assert.equal(focused, 0);
  assert.deepEqual(opened, [[false, "system"], [false, "system"], [true, "system"]]);
  assert.deepEqual(positions.at(-1), { scrollTop: 173, visibleMessageCount: 120 });
  harness.flush();
  await new Promise(setImmediate);
  assert.equal(restoredList.scrollTop, 173, "同じ復元要求や自動スクロールで位置を変えない");
  harness.update({ restoreRequest: { id: 2, open: false } });
  assert.equal(harness.evaluate("expanded"), false);
  assert.deepEqual(opened.at(-1), [false, "system"]);
});

test("検索の履歴復元は古いtick待ちの末尾移動・focus・復元位置を無効にする", async () => {
  const ticks = [];
  let focused = 0;
  const restoredList = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
  const harness = searchAgentHarness({}, {
    tick: () => new Promise((resolve) => ticks.push(resolve)),
    restoredList,
    restoredInput: { focus() { focused += 1; } },
    window: { clearTimeout() {}, matchMedia: () => ({ matches: true }) }
  });
  harness.evaluate("messageListElement = restoredList; inputElement = restoredInput; openExpanded()");
  harness.update({ restoreRequest: { id: 1, open: true, scrollTop: 300, visibleMessageCount: 80 } });
  harness.update({ restoreRequest: { id: 2, open: true, scrollTop: 600, visibleMessageCount: 120 } });
  ticks.splice(0).reverse().forEach((resolve) => resolve());
  await new Promise(setImmediate);
  assert.equal(restoredList.scrollTop, 600);
  assert.equal(harness.evaluate("visibleMessageCount"), 120);
  assert.equal(focused, 0);
  harness.update({ restoreRequest: { id: 1, open: false } });
  assert.equal(harness.evaluate("expanded"), true, "後から届いた古い復元要求は適用しない");

  harness.update({ restoreRequest: { id: 3, open: true, scrollTop: 900 } });
  harness.evaluate("closeExpanded()");
  ticks.splice(0).forEach((resolve) => resolve());
  await new Promise(setImmediate);
  assert.equal(harness.evaluate("expanded"), false);
  assert.equal(restoredList.scrollTop, 600, "復元を待つ間の手動閉じを優先する");
});

test("検索の復元位置がなければ末尾を開き、スクロール時と閉じる直前に最新位置を通知する", async () => {
  const events = [];
  const restoredList = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
  const harness = searchAgentHarness({
    onOpenChange: (open, source) => events.push({ open, source }),
    onScrollChange: (position) => events.push({ ...position })
  }, { restoredList });
  harness.evaluate("messageListElement = restoredList");
  harness.update({ restoreRequest: { id: 1, open: true } });
  await new Promise(setImmediate);
  assert.equal(restoredList.scrollTop, 2000);
  assert.equal(harness.evaluate("visibleMessageCount"), 40);
  restoredList.scrollTop = 250;
  harness.evaluate("handleMessageListScroll()");
  assert.deepEqual(events.at(-1), { scrollTop: 250, visibleMessageCount: 40 });
  restoredList.scrollTop = 420;
  harness.evaluate("closeExpanded()");
  assert.deepEqual(events.slice(-2), [
    { scrollTop: 420, visibleMessageCount: 40 }, { open: false, source: "user" }
  ], "履歴を閉じた状態に更新する前に位置を保存できる");
});

test("過去の検索履歴を追加しても読んでいた位置を保ち、追加後の位置を通知する", async () => {
  const ticks = [];
  const positions = [];
  let top = 0;
  const list = {
    scrollHeight: 1000,
    clientHeight: 400,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
  };
  const harness = searchAgentHarness({ onScrollChange: (position) => positions.push({ ...position }) }, {
    tick: () => new Promise((resolve) => ticks.push(resolve)), list
  });
  harness.evaluate("messageListElement = list; openExpanded()");
  ticks.splice(0).forEach((resolve) => resolve());
  await new Promise(setImmediate);
  list.scrollTop = 20;
  harness.evaluate("hasOlderHistory = true; visibleServerMessages = Array(100).fill({}); handleMessageListScroll()");
  assert.equal(harness.evaluate("visibleMessageCount"), 80);
  list.scrollHeight += 500;
  assert.equal(list.scrollTop, 20, "履歴の描画完了までは元の位置を保つ");
  ticks.splice(0).forEach((resolve) => resolve());
  await new Promise(setImmediate);
  assert.equal(list.scrollTop, 520, "先頭に追加した高さの分だけ位置を補正する");
  assert.deepEqual(positions.at(-1), { scrollTop: 520, visibleMessageCount: 80 });
  harness.destroy();
});

test("検索のDOM破棄後の0位置は最後のスクロール通知を上書きしない", () => {
  const positions = [];
  const list = { scrollTop: 456, scrollHeight: 1000, clientHeight: 400, isConnected: true };
  const harness = searchAgentHarness({ onScrollChange: (position) => positions.push({ ...position }) }, {
    tick: () => new Promise(() => {}), list
  });
  harness.evaluate("messageListElement = list; expanded = true; visibleMessageCount = 120; handleMessageListScroll()");
  list.isConnected = false;
  list.scrollTop = 0;
  harness.destroy();
  assert.deepEqual(positions, [{ scrollTop: 456, visibleMessageCount: 120 }]);
});

test("hide=closeは背景タップで消えず、会話を開いて閉じたときは引っ込む", () => {
  const harness = searchAgentHarness({
    peeking: true, surfaceKey: "home",
    surfaceMessage: { id: "hint", surface: "home", body: "案内", hide: "close" }
  });
  harness.evaluate("handleScreenPointerDown({ target: null })");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  harness.evaluate("openExpanded(); closeExpanded()");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), false);
  assert.equal(harness.evaluate("agentPeeking"), true);
  harness.update({ surfaceKey: "notes" });
  harness.update({ surfaceKey: "home" });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  harness.update({ surfaceMessage: { id: "other", surface: "home", body: "通常案内" } });
  harness.evaluate("handleScreenPointerDown({ target: null })");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), false, "通常案内の背景タップは従来どおり");
});

test("パネル内で届いた新しい案内は一度も見ないままcloseで消さない", () => {
  const harness = searchAgentHarness();
  harness.evaluate("openExpanded()");
  harness.update({ surfaceMessage: { id: "new:1", trigger: "repaired", body: "新しい通知", hide: "close" } });
  harness.evaluate("closeExpanded()");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  harness.evaluate("openExpanded(); closeExpanded()");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), false);
  harness.update({ surfaceMessage: { id: "new:2", trigger: "repaired", body: "新しい通知", hide: "close" } });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true, "次の操作は同じ案内でも再表示");
});

test("hide=neverの案内は会話を閉じても背景をタップしても表示し続ける", () => {
  const harness = searchAgentHarness({
    peeking: true, surfaceKey: "home",
    surfaceMessage: { id: "urgent", surface: "home", body: "今すぐ検索", hide: "never" }
  });
  harness.evaluate("openExpanded()");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), false, "会話を開いている間は吹き出しを出さない");
  harness.evaluate("closeExpanded()");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  assert.equal(harness.evaluate("agentPeeking"), false);
  harness.evaluate("handleScreenPointerDown({ target: null })");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  harness.update({ surfaceMessage: undefined });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), false, "condを満たさなくなれば消える");
});

test("同じ文言でもhideとsurfaceだけが表示・非表示を決める", () => {
  for (const surface of ["home", "notes"]) for (const hide of ["auto", "close", "never"]) {
    const h = searchAgentHarness({ surfaceKey: surface, surfaceMessage: { id: "hint", surface, body: "同じ案内文", hide } });
    h.evaluate("handleScreenPointerDown({target:null})"); h.flush();
    assert.equal(h.evaluate("surfaceBubbleVisible"), hide !== "auto");
    h.evaluate("openExpanded(); closeExpanded()"); h.flush();
    assert.equal(h.evaluate("surfaceBubbleVisible"), hide === "never");
    h.update({ surfaceKey: "photos" }); h.update({ surfaceKey: surface });
    assert.equal(h.evaluate("surfaceBubbleVisible"), true);
  }
});

test("吹き出しから会話を開いて閉じると引っ込み、画面へ戻ったときだけ案内を再表示する", () => {
  const harness = searchAgentHarness({
    peeking: true, surfaceKey: "home",
    surfaceMessage: { id: "hint", surface: "home", body: "案内" }
  });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  harness.evaluate("openExpanded()");
  harness.flush();
  assert.equal(harness.evaluate("expanded"), true);
  harness.evaluate("closeExpanded()");
  harness.flush();
  assert.equal(harness.evaluate("surfaceBubbleVisible"), false);
  assert.equal(harness.evaluate("agentPeeking"), true);
  harness.update({ surfaceMessage: { id: "hint", surface: "home", body: "案内" } });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), false, "同じ画面でstateを再取得しても再表示しない");
  harness.update({ surfaceKey: "notes" });
  harness.update({ surfaceKey: "home" });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true);
  harness.evaluate("openExpanded()");
  harness.flush();
  harness.update({ surfaceKey: "notes", surfaceMessage: { id: "note-hint", body: "別画面の案内" } });
  assert.equal(harness.evaluate("surfaceBubbleVisible"), true, "画面遷移によるcloseが新しい案内を既読にしない");
});

for (const [name, change] of [
  ["強制閉じ要求", { closeRequestId: 1 }],
  ["表示先変更", { surfaceKey: "notes" }]
]) {
  test(`検索の${name}はfalseを通知し、その後は開き直せる`, () => {
    const opened = [];
    const harness = searchAgentHarness({ onOpenChange: (open) => opened.push(open) });
    harness.evaluate("openExpanded()");
    harness.update(change);
    assert.equal(harness.evaluate("expanded"), false);
    assert.deepEqual(opened, [true, false]);
    harness.flush();
    assert.deepEqual(opened, [true, false]);
    harness.evaluate("openExpanded()");
    harness.flush();
    assert.equal(harness.evaluate("expanded"), true);
    assert.deepEqual(opened, [true, false, true]);
  });
}

test("検索の破棄は開いた直後でもfalseを返し、新しいcomponentへtrueを残さない", () => {
  const opened = [];
  const onOpenChange = (open) => opened.push(open);
  const first = searchAgentHarness({ onOpenChange });
  first.evaluate("openExpanded()");
  first.destroy();
  assert.deepEqual(opened, [true, false]);
  const second = searchAgentHarness({ onOpenChange });
  assert.equal(second.evaluate("expanded"), false);
  assert.deepEqual(opened, [true, false]);
  second.evaluate("openExpanded()");
  assert.deepEqual(opened, [true, false, true]);
  second.destroy();
  assert.deepEqual(opened, [true, false, true, false]);
});

test("検索結果を開けた場合は閉じた状態を通知する", async () => {
  const opened = [];
  const harness = searchAgentHarness({
    onOpenChange: (open) => opened.push(open),
    onOpenSearchAgentResult: async () => true
  });
  harness.evaluate("openExpanded()");
  await harness.evaluate('openResult({ appId: "notes", contentId: "note" })');
  assert.equal(harness.evaluate("expanded"), false);
  assert.deepEqual(opened, [true, false]);
});

test("開封失敗の本文は失敗確定時にだけ抽選し、その後の状態更新では書き換えない", async () => {
  let draws = 0;
  let finish;
  const harness = searchAgentHarness({
    selectOpenFailureMessage: () => `失敗案内${++draws}`,
    onOpenSearchAgentResult: () => new Promise(resolve => { finish = resolve; })
  }, { crypto: globalThis.crypto });
  harness.update({ deviceState: { apps: [] } });
  assert.equal(draws, 0);
  const request = harness.evaluate('openResult({appId:"notes",contentId:"item"})');
  harness.flush();
  assert.equal(draws, 0, "通信待ち中は選ばない");
  finish(false); await request; harness.flush();
  assert.equal(draws, 1);
  assert.equal(harness.evaluate("displayedMessages.at(-1).body"), "失敗案内1");
  harness.update({ deviceState: { apps: [] }, selectOpenFailureMessage: () => `別の案内${++draws}` });
  assert.equal(draws, 1, "状態更新で再抽選しない");
  assert.equal(harness.evaluate("displayedMessages.at(-1).body"), "失敗案内1");
  const again = harness.evaluate('openResult({appId:"notes",contentId:"item"})');
  finish(false); await again; harness.flush();
  assert.equal(draws, 2);
  assert.equal(harness.evaluate("displayedMessages.at(-1).body"), "別の案内2");
});

test("入力欄を隠した検索会話でも、開封失敗後にQuick Replyで続行できる", async () => {
  const menu = { kind: "message", id: "menu", seq: 1, talkId: "search", sender: "other", body: "選んでください", sentAt: "2026-01-01T00:00:00Z", quickReplies: ["続ける"] };
  const talk = { talkId: "search", messages: [menu], inputVisible: false, inputEnabled: true, inputVisibleAfterSeq: 0, inputEnabledAfterSeq: 0, canPost: true };
  let sentText, complete;
  const harness = searchAgentHarness({
    talk, onOpenSearchAgentResult: async () => false,
    onSend: (text) => { sentText = text; return new Promise(resolve => { complete = resolve; }); }
  }, {
    crypto: globalThis.crypto, MAX_SEARCH_AGENT_QUERY_LENGTH: 500,
    loadTalkDelaySeenMessages: () => ({ search: new Set([menu.id]) }),
    latestQuickReplyPlacement, resolvedTalkInputState, shouldQueueTalkMessage: () => false
  });
  try {
    harness.evaluate("openExpanded()");
    harness.flush();
    assert.equal(harness.evaluate("composerVisible"), false);
    assert.equal(harness.evaluate("quickReplyPlacement.replies[0]"), "続ける");
    await harness.evaluate('openResult({ appId: "messages", contentId: "unavailable" })');
    harness.flush();
    assert.equal(harness.evaluate("displayedMessages.at(-1).body"), "開けませんでした。");
    assert.equal(harness.evaluate("quickReplyPlacement.replies[0]"), "続ける");
    harness.evaluate("closeExpanded(); openExpanded()");
    harness.flush();
    assert.equal(harness.evaluate("quickReplyPlacement.replies[0]"), "続ける");
    const pending = harness.evaluate('sendQuickReply("続ける")');
    harness.flush();
    assert.equal(sentText, "続ける");
    assert.equal(harness.evaluate("quickReplyPlacement"), undefined, "送信中は二重選択を防ぐ");
    complete({ ok: false, error: "通信エラー" });
    await pending;
    harness.flush();
    assert.equal(harness.evaluate("quickReplyPlacement.replies[0]"), "続ける", "送信失敗後は再試行できる");
    harness.update({ talk: { ...talk, inputEnabled: false } });
    assert.equal(harness.evaluate("quickReplyPlacement"), undefined, "disable中は表示しない");
    harness.update({ talk: { ...talk, messages: [...talk.messages, { ...menu, id: "next", seq: 2, quickReplies: undefined }] } });
    assert.equal(harness.evaluate("quickReplyPlacement"), undefined, "新しい台本メッセージに選択肢がなければ旧選択肢は残さない");
  } finally { harness.destroy(); }
});

test("検索の発言を変える候補はラベルで送信し、空発言の仮吹き出しを出さず失敗後に候補を戻す", async () => {
  for (const text of ["はい、お願いします", ""]) {
    const reply = { label: "はい", text };
    const menu = { kind: "message", id: "menu", seq: 12, talkId: "search", sender: "other", body: "選んでください", sentAt: "2026-01-01T00:00:00Z", quickReplies: [reply] };
    const talk = { talkId: "search", messages: [menu], inputVisible: false, inputEnabled: true, inputVisibleAfterSeq: 0, inputEnabledAfterSeq: 0, canPost: true };
    const transmissions = [];
    const completions = [];
    const harness = searchAgentHarness({
      talk, onSend: (message, options) => {
        transmissions.push({ message, options: { ...options } });
        return new Promise((resolve) => completions.push(resolve));
      }
    }, {
      crypto: globalThis.crypto, MAX_SEARCH_AGENT_QUERY_LENGTH: 500,
      loadTalkDelaySeenMessages: () => ({ search: new Set([menu.id]) }),
      latestQuickReplyPlacement, resolvedTalkInputState, shouldQueueTalkMessage: () => false
    });
    try {
      harness.evaluate('input = "未送信の下書き"; openExpanded()');
      harness.flush();
      const pending = harness.evaluate("sendQuickReply(quickReplyPlacement.replies[0], 12)");
      harness.flush();
      assert.equal(harness.evaluate("pending"), true);
      assert.equal(harness.evaluate("typingVisible"), true);
      assert.equal(harness.evaluate("quickReplyPlacement"), undefined);
      assert.equal(harness.evaluate("input"), "未送信の下書き");
      assert.equal(harness.evaluate("transientMessages.length"), text ? 1 : 0);
      if (text) assert.equal(harness.evaluate("transientMessages[0].body"), text);
      assert.deepEqual(transmissions, [{ message: "はい", options: { display: text, quickReplySeq: 12 } }]);
      completions.shift()({ ok: false, error: "候補を送信できませんでした。" });
      await pending;
      harness.flush();
      assert.equal(harness.evaluate("pending"), false);
      assert.equal(harness.evaluate("sendError"), "候補を送信できませんでした。");
      assert.equal(harness.evaluate("quickReplyPlacement.replies[0]"), reply);
      assert.equal(harness.evaluate("transientMessages.length"), 0);
      const retry = harness.evaluate("sendQuickReply(quickReplyPlacement.replies[0], 12)");
      harness.update({ talk: { ...talk, quickRepliesClosedSeq: 12 } });
      completions.shift()({ ok: true });
      await retry;
      harness.flush();
      assert.equal(harness.evaluate("quickReplyPlacement"), undefined, "成功消費した候補は相手の発話が同じでも閉じる");
      assert.equal(harness.evaluate("input"), "未送信の下書き");
      harness.evaluate("closeExpanded(); openExpanded()");
      harness.flush();
      assert.equal(harness.evaluate("quickReplyPlacement"), undefined, "再表示しても消費済み候補を戻さない");
    } finally { harness.destroy(); }
  }
});

test("検索Quick Replyの描画callbackは後から届いた最新発話でseqを置き換えない", async () => {
  const calls = [];
  const harness = searchAgentHarness({ onSend: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } }, {
    crypto: globalThis.crypto
  });
  const source = readFileSync(searchAgentUrl, "utf8");
  let callback;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Component" && node.name === "QuickReplies") {
      callback = node.attributes.find((attribute) => attribute.name === "onSelect")?.value.expression;
      return;
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") for (const item of Array.isArray(child) ? child : [child]) visit(item);
    }
  }
  visit(parse(source, { modern: true }).fragment);
  assert.ok(callback);
  const select = harness.evaluate(`((message) => (${source.slice(callback.start, callback.end)}))({ seq: 12 })`);
  harness.evaluate('messages = [{ seq: 99 }]; composerEnabled = true');
  await select({ label: "続きを読む", text: "" });
  assert.equal(calls[0][0], "続きを読む");
  assert.deepEqual({ ...calls[0][1] }, { display: "", quickReplySeq: 12 });
  harness.destroy();
});

test("検索の従来文字列候補は追加optionsを付けず1引数で送る", async () => {
  const calls = [];
  const harness = searchAgentHarness({ onSend: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } }, {
    crypto: globalThis.crypto
  });
  harness.evaluate("composerEnabled = true");
  await harness.evaluate('sendQuickReply("従来の候補", 12)');
  assert.deepEqual(calls, [["従来の候補"]]);
  harness.destroy();
});

test("Quick Replyボタンはラベルだけを描画し、選択時はラベルと発言の組を保つ", () => {
  const quickRepliesUrl = new URL("../src/client/system/QuickReplies.svelte", import.meta.url);
  const source = readFileSync(quickRepliesUrl, "utf8");
  const compiled = ts.transpileModule(compile(source, { filename: "QuickReplies.svelte", generate: "server" }).js.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const sandbox = {
    exports: {},
    require(name) {
      if (name === "svelte/internal/server") return serverRuntime;
      if (name === "../../shared/quickReplies.ts") return { quickReplyLabel };
      throw new Error(`想定外の依存: ${name}`);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(compiled, sandbox);
  const reply = { label: "短いボタン", text: "履歴に残す丁寧な発言" };
  const rendered = render(sandbox.exports.default, { props: { replies: ["従来の候補", reply, { label: "続きを読む", text: "" }] } });
  assert.match(rendered.body, />従来の候補<|>従来の候補<!--/u);
  assert.match(rendered.body, /短いボタン/u);
  assert.match(rendered.body, /続きを読む/u);
  assert.doesNotMatch(rendered.body, /履歴に残す丁寧な発言|\[object Object\]/u);
  const selected = [];
  const harness = componentScriptHarness(quickRepliesUrl, { replies: [reply], onSelect: (value) => selected.push(value) }, { quickReplyLabel, chosen: reply });
  harness.evaluate("selectReply({ preventDefault() {} }, chosen)");
  assert.equal(selected[0], reply);
  harness.destroy();
});

test("強制閉じ後に届いた古い検索結果は開き直した状態を上書きしない", async () => {
  let complete;
  const result = new Promise((resolve) => { complete = resolve; });
  const opened = [];
  const harness = searchAgentHarness({
    onOpenChange: (open) => opened.push(open),
    onOpenSearchAgentResult: () => result
  });
  harness.evaluate("openExpanded()");
  const pending = harness.evaluate('openResult({ appId: "notes", contentId: "note" })');
  harness.update({ closeRequestId: 1 });
  harness.evaluate("openExpanded()");
  complete(true);
  await pending;
  assert.equal(harness.evaluate("expanded"), true);
  assert.deepEqual(opened, [true, false, true]);
});

test("検索を破棄・再生成した後の旧結果応答は新パネルを閉じたと報告しない", async () => {
  let complete;
  const result = new Promise((resolve) => { complete = resolve; });
  const opened = [];
  const onOpenChange = (open) => opened.push(open);
  const old = searchAgentHarness({ closeRequestId: 1, onOpenChange, onOpenSearchAgentResult: () => result });
  old.evaluate("openExpanded()");
  const pending = old.evaluate('openResult({ appId: "notes", contentId: "note" })');
  old.destroy();

  // Svelteは破棄済みcomponentのpropsを更新しない。新しいcomponentだけが新要求番号を持つ。
  const fresh = searchAgentHarness({ closeRequestId: 2, onOpenChange });
  fresh.evaluate("openExpanded()");
  complete(true);
  await pending;
  assert.equal(fresh.evaluate("expanded"), true);
  assert.deepEqual(opened, [true, false, true]);
  fresh.destroy();
});

test("検索の通知callbackを省略しても既存の開閉と破棄は動作する", () => {
  const harness = searchAgentHarness();
  harness.evaluate("openExpanded(); closeExpanded()");
  harness.destroy();
});

const frameSource = readFileSync(new URL("../src/client/system/PhoneFrame.svelte", import.meta.url), "utf8");
const compiledFrame = ts.transpileModule(compile(frameSource, { filename: "PhoneFrame.svelte", generate: "server" }).js.code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function renderedSearchAgentProps(props) {
  const children = [];
  const sandbox = {
    exports: {},
    require(name) {
      if (name === "svelte/internal/server") return serverRuntime;
      if (name === "@lucide/svelte") return { House() {}, Play() {}, Radio() {} };
      if (name === "./appCatalog") return { appCatalog: [] };
      if (name === "./SearchAgent.svelte") return {
        __esModule: true,
        default(_renderer, childProps) { children.push(childProps); }
      };
      if (["./IncomingCallScreen.svelte", "./StatusBar.svelte"].includes(name)) return { __esModule: true, default() {} };
      if (name === "./resourceUrls") return { resourceUrl };
      throw new Error(`想定外の依存: ${name}`);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(compiledFrame, sandbox);
  const rendered = render(sandbox.exports.default, { props: { deviceState: {}, ...props } });
  void rendered.body;
  return children;
}

test("PhoneFrameは表示中の検索だけに復元要求と開閉・スクロールcallbackをそのまま渡す", () => {
  const onSearchAgentOpenChange = () => {};
  const onSearchAgentScrollChange = () => {};
  const searchAgentRestoreRequest = { id: 1, open: true, scrollTop: 200, visibleMessageCount: 80 };
  const props = {
    assistantVisible: true,
    searchAgentTalk: { talkId: "search", messages: [] },
    onSearchAgentOpenChange, onSearchAgentScrollChange, searchAgentRestoreRequest
  };
  const [child] = renderedSearchAgentProps(props);
  assert.equal(child.onOpenChange, onSearchAgentOpenChange);
  assert.equal(child.onScrollChange, onSearchAgentScrollChange);
  assert.equal(child.restoreRequest, searchAgentRestoreRequest);
  assert.equal(renderedSearchAgentProps({ ...props, assistantVisible: false }).length, 0);
  assert.equal(renderedSearchAgentProps({ ...props, searchAgentTalk: null }).length, 0);
});
