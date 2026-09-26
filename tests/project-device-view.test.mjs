import assert from "node:assert/strict";
import { resourceUrl } from "../src/client/system/resourceUrls.ts";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { compile } from "svelte/compiler";
import * as serverRuntime from "svelte/internal/server";
import { render } from "svelte/server";
import ts from "typescript";
import { deviceViewFor } from "../src/client/system/deviceView.ts";
import { latestQuickReplyPlacement, resolvedTalkInputState } from "../src/client/system/talkInputState.ts";
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
    uiState: { sessionToken: "session" }, playerState: state, displayedTalkTarget: null,
    captureContentNavigation: () => () => true,
    handleContentOpen: async () => { state.visibleDeviceState.apps = [{ id: "chat", available: true, corrupted: false }]; return true; },
    focusOpenedContent() {}, showTransientAssistantMessage: message => messages.push(message)
  });
  const result = { appId: "chat", contentId: "room", targetKind: "content", repairable: true };
  assert.equal(await context.handleOpenSearchAgentResult(result), true);
  assert.equal(messages.length, 1);
  assert.equal(await context.handleOpenSearchAgentResult(result), true);
  assert.equal(messages.length, 1);
});

function searchAgentHarness(props = {}, dependencies = {}) {
  return componentScriptHarness(searchAgentUrl, {
    deviceState: { apps: [] },
    talk: { talkId: "search", messages: [] },
    ...props
  }, {
    appCatalog: [],
    Element: class Element {},
    projectConstants: { "searchAgent.broken_link_tutorial_body": "初回の検索案内" },
    tick: () => Promise.resolve(),
    window: { clearTimeout() {}, matchMedia: () => ({ matches: false }) },
    loadTalkDelaySeenMessages: () => ({}),
    saveTalkDelaySeenMessages() {},
    resolvedTalkInputState: () => ({ visible: true, canSubmit: true }),
    latestQuickReplyPlacement: () => undefined,
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

test("初回の破損リンク案内は背景タップで消えず、会話を開いて閉じたときは引っ込む", () => {
  const harness = searchAgentHarness({
    peeking: true, surfaceKey: "home",
    surfaceMessage: { id: "broken-link-1", surface: "home", body: "初回の検索案内" }
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

test("stickyの案内は会話を閉じても背景をタップしても表示し続ける", () => {
  const harness = searchAgentHarness({
    peeking: true, surfaceKey: "home",
    surfaceMessage: { id: "urgent", surface: "home", body: "今すぐ検索", sticky: true }
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
    assert.equal(harness.evaluate("displayedMessages.at(-1).body"), "このデータはまだ開けないみたい。");
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

test("PhoneFrameは表示中の検索だけに開閉callbackをそのまま渡す", () => {
  const onSearchAgentOpenChange = () => {};
  const props = {
    assistantVisible: true,
    searchAgentTalk: { talkId: "search", messages: [] },
    onSearchAgentOpenChange
  };
  const [child] = renderedSearchAgentProps(props);
  assert.equal(child.onOpenChange, onSearchAgentOpenChange);
  assert.equal(renderedSearchAgentProps({ ...props, assistantVisible: false }).length, 0);
  assert.equal(renderedSearchAgentProps({ ...props, searchAgentTalk: null }).length, 0);
});
