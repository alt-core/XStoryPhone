import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { browserPagesModule } from "./helpers/browser-app-harness.mjs";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";
import {
  goBackInPhoneHistory,
  consumePhoneHistoryPop,
  currentPhoneHistoryState,
  phoneHistoryMarkerFrom,
  phoneHistoryStateFrom,
  pushPhoneHistoryRoute,
  replacePhoneHistoryRoute,
  replacePhoneHistoryView,
  savePhoneHistoryViewBeforePop,
  samePhoneHistoryPage,
  samePhoneHistoryRoute
} from "../src/client/system/phoneHistory.ts";

const appUrl = new URL("../src/client/App.svelte", import.meta.url);
const appScript = readFileSync(appUrl, "utf8").match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const appAst = ts.createSourceFile("app.ts", appScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const incomingCallReaction = appAst.statements.find((statement) => (
  ts.isLabeledStatement(statement) && statement.statement.getText(appAst).includes("activeIncomingCall?.id")
));
const incomingCallCode = ts.transpileModule(incomingCallReaction.statement.getText(appAst), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const turn = () => new Promise(setImmediate);
// vm内のmoduleが作った値も、構造だけで比べる。
const plain = (value) => JSON.parse(JSON.stringify(value));
const windowStub = { location: { origin: "http://localhost" } };
const browserPages = browserPagesModule({ resourceUrl: (url) => url, window: windowStub });

class History {
  entries = [null];
  index = 0;
  get state() { return this.entries[this.index]; }
  replaceState(value) { this.entries[this.index] = structuredClone(value); }
  pushState(value) { this.entries.splice(++this.index); this.entries.push(structuredClone(value)); }
  back() { this.index -= 1; }
  go(delta) { this.index += delta; }
}

// ブラウザと同じく、履歴移動の完了を着信・通話終了とは別のタイミングで通知する。
class AsyncHistory extends History {
  travels = [];
  back() { this.go(-1); }
  go(delta) { this.travels.push(delta); }
  pop(context) {
    assert.notEqual(this.travels.length, 0, "履歴移動が保留されている");
    super.go(this.travels.shift());
    context.handlePhoneHistoryPop({ state: this.state });
  }
}

function startIncomingCall(context) {
  context.incomingCall = context.activeIncomingCall = { id: "call" };
  // 着信入口も実物のリアクティブ節を通し、履歴を記録する指定漏れを検出する。
  vm.runInContext(incomingCallCode, context);
}

const deviceState = {
  messages: [
    { id: "thread_a", contentId: "thread_a", messages: [] },
    { id: "thread_b", contentId: "thread_b", messages: [] },
    { id: "thread_broken", contentId: "thread_broken", corrupted: true, messages: [] }
  ],
  chatThreads: [
    { id: "room_a", contentId: "room_a", messages: [] },
    { id: "room_b", contentId: "room_b", messages: [] }
  ],
  browserTabs: [
    { id: "tab_a", contentId: "first", title: "先頭", url: "/first.html", allowedUrls: ["/first-next.html"] },
    { id: "tab_b", contentId: "second", title: "次", url: "/second.html" }
  ]
};

// Appの遷移関数を実物で動かし、各アプリcomponentの通知(操作・表示・開封報告)だけを手で送る。
function setup({ activeAppId = null, focusedContentId = "", lastContentByAppId = {}, history = new History() } = {}) {
  replacePhoneHistoryRoute(history, "test", { kind: "home" });
  if (activeAppId) {
    pushPhoneHistoryRoute(history, "test", { kind: "app", appId: activeAppId, ...(focusedContentId ? { contentId: focusedContentId } : {}) });
  }
  const requests = [];
  const refreshes = [];
  const blocked = [];
  const context = componentFunctionHarness(appUrl, [
    "handleContentOpen", "rememberAppContent", "contentOpenKey", "syncPhoneHistoryContent", "handleDisplayedTalkChange",
    "handleDisplayedContentChange", "handleAppNavigate", "handleBrowserPageNavigate", "handleSingleScreenContentOpen",
    "handleBlockedContentTap", "replaceCurrentPhoneRoute", "pushCurrentPhoneRoute", "focusAppContent", "focusOpenedContent",
    "requestSearchAgentClose", "suppressNextContentOpenReport", "openContentFromExplicitNavigation", "openAppContent",
    "captureContentNavigation", "showTalkBackLink", "openTalkBackLink", "restorePhoneHistoryRoute", "openPhoneHistoryContent",
    "beginAppSession", "openApp", "appStartContentId", "clearPhoneRoute", "closeApp", "completeIncomingCall",
    "fallbackPhoneHistoryToHome", "fallbackPhoneHistoryToApp", "resetPhoneHistoryBoundary",
    "currentHistoryRoute", "appRoute", "isListDetailApp", "browserTabFor", "setBrowserPage",
    "currentPhoneRoute", "handleSearchAgentOpenChange", "handleSearchAgentScrollChange", "handlePhoneHistoryPop",
    "saveCurrentPhoneHistoryView", "captureCurrentPhoneHistoryView", "cancelPhoneHistoryViewRestore", "restorePhoneHistoryView",
    "PROGRESSION_RETRY_DELAYS_MS", "LIST_START_APP_IDS", "DETAIL_START_APP_IDS"
  ], {
    window: { history, requestAnimationFrame(callback) { callback(); }, clearTimeout() {} },
    crypto: { randomUUID: () => "next-scope" },
    phoneHistoryStateFrom, phoneHistoryMarkerFrom, pushPhoneHistoryRoute, replacePhoneHistoryRoute, goBackInPhoneHistory,
    consumePhoneHistoryPop, currentPhoneHistoryState, replacePhoneHistoryView, savePhoneHistoryViewBeforePop, samePhoneHistoryPage, samePhoneHistoryRoute, ...browserPages,
    tick: () => Promise.resolve(),
    capturePhoneHistoryScroll: () => context.scrollPositions,
    restorePhoneHistoryScroll: (_root, positions) => { context.scrollPositions = plain(positions); return () => {}; },
    searchAgentScrollPosition: undefined,
    scrollPositions: [], phoneHistorySurface: { isConnected: true }, phoneHistoryViewRestoring: false, phoneHistoryScrollCleanup: undefined,
    searchAgentRestoreRequest: null, searchAgentRestoreRequestId: 0, searchAgentOpen: false,
    isMemoryStorage: false, outOfGameVisible: false, gameOverVisible: false, allClearVisible: false, activeIncomingCall: null,
    incomingCall: undefined, interruptedIncomingCallId: "", locallyCompletedIncomingCallIds: [], noiseVisible: false, noiseTimer: undefined,
    qaMode: false, phoneHistoryReady: true, phoneHistoryScope: "test", phoneHistoryNavigationId: 0,
    contentNavigationRequestId: 0, searchAgentCloseRequestId: 0,
    uiState: { sessionToken: "session", locked: false, lastContentByAppId },
    playerState: { stateVersion: 1, revision: "test", clientRevision: "test" }, globalErrorVisible: false,
    deviceState,
    activeAppId, focusedContentId, focusedContentRequestId: 0, focusedTalkHistoryRepairId: "",
    displayedTalkTarget: null, displayedContent: null, browserPages: {},
    shadeOpen: false, transientAssistantMessage: undefined, temporaryTalkBackLink: null, notificationToast: null, appModalOpen: false,
    apps: ["notes", "mail", "photos", "phone", "messages", "chat", "browser", "radio"].map((id) => ({ id, available: true })),
    inFlightContentOpenKeys: [], inFlightMediaObservedKeys: [], suppressedContentOpenKeys: [],
    pendingTalkReadCursorPayload: () => [], clearSyncedTalkReadCursors() {}, queueAlbumMediaAddedAssistant() {},
    enqueuePresentation() {}, applyErrorPlayerState() {}, trackEvent() {},
    stopBackgroundMediaPlayback() {}, cancelPresentations() {},
    recordBackgroundScenarioEvent: async () => undefined, refreshPlayerStateOnHomeIfStale() {},
    refreshPlayerStateWithRetry: async () => { refreshes.push(true); return true; },
    showGlobalError() { context.globalErrorVisible = true; }, waitMs: () => Promise.resolve(),
    triggerNoise() { blocked.push("noise"); },
    recordBlockedContentLink(appId, contentId) { blocked.push(`${appId}:${contentId}`); },
    recordContentOpened(_token, input) {
      return new Promise((resolve) => requests.push({ input, resolve }));
    }
  });
  context.persist = (partial) => { context.uiState = { ...context.uiState, ...partial }; };
  context.applyPlayerState = (state) => {
    if (state.stateVersion < context.playerState.stateVersion) return false;
    context.playerState = state;
    return true;
  };
  let version = 1;
  const route = () => phoneHistoryStateFrom(history.state, "test").route;
  function respond(index, result) {
    assert.ok(requests[index], `要求${index}がある`);
    requests[index].resolve(result ?? { ok: true, playerState: { stateVersion: ++version, revision: "test", clientRevision: "test" } });
  }
  // componentの通知順: 利用者の操作 → 開封報告 → 表示。会話アプリの表示は会話の表示通知で届く。
  function displayed(appId, contentId) {
    if (appId === "messages" || appId === "chat") context.handleDisplayedTalkChange(appId, contentId);
    else context.handleDisplayedContentChange(appId, contentId);
  }
  function tapItem(appId, contentId) {
    context.handleAppNavigate(appId, contentId);
    const opened = context.handleContentOpen(appId, contentId);
    displayed(appId, contentId);
    return opened;
  }
  function tapList(appId) {
    context.handleAppNavigate(appId, "");
    displayed(appId, "");
  }
  // 端末の戻る操作。開封の要求が出たら応答を返してから表示を確定させる。
  async function back(result) {
    history.back();
    const before = requests.length;
    const pending = context.restorePhoneHistoryRoute(route(), ++context.phoneHistoryNavigationId);
    if (requests.length > before) respond(before, result);
    await pending;
  }
  return { context, history, requests, refreshes, blocked, respond, route, tapItem, tapList, back };
}

test("一覧始まりのアプリは、ホームから一覧で始まり、一覧と詳細の行き来を順に戻れる", async () => {
  for (const appId of ["notes", "mail", "photos", "phone"]) {
    const h = setup({ lastContentByAppId: { [appId]: "item_last" } });
    const c = h.context;
    c.openApp(c.apps.find((app) => app.id === appId));
    assert.deepEqual(h.route(), { kind: "app", appId }, `${appId}: 前回の項目ではなく一覧から始める`);
    assert.equal(c.focusedContentId, "");
    const x = h.tapItem(appId, "item_x"); h.respond(0); await x;
    h.tapList(appId);
    const y = h.tapItem(appId, "item_y"); h.respond(1); await y;
    assert.deepEqual(
      h.history.entries.map((entry) => entry.route.kind === "home" ? "home" : entry.route.contentId ?? "一覧"),
      ["home", "一覧", "item_x", "一覧", "item_y"]
    );

    await h.back();
    assert.deepEqual(h.route(), { kind: "app", appId });
    assert.equal(c.focusedContentId, "", "一覧の表示を指定する");
    assert.equal(h.requests.length, 2, "一覧へ戻る時は通信しない");
    assert.equal(h.refreshes.length, 0);

    await h.back();
    assert.equal(h.requests.length, 3, "詳細へ戻ると開き直す");
    assert.equal(h.requests[2].input.contentId, "item_x");
    assert.equal(c.focusedContentId, "item_x");
    assert.equal(await c.handleContentOpen(appId, "item_x"), true, "表示側の報告は1回だけ省く");
    assert.equal(h.requests.length, 3);
  }
});

test("同じ項目を一覧を挟んで開き直すたびに開封を送る", async () => {
  const h = setup({ activeAppId: "notes" });
  const first = h.tapItem("notes", "note"); h.respond(0); await first;
  h.tapList("notes");
  const second = h.tapItem("notes", "note"); h.respond(1); await second;
  assert.deepEqual(h.requests.map((request) => request.input.contentId), ["note", "note"]);
});

test("詳細始まりのアプリは前回の項目から始め、使えない前回の項目なら先頭の項目から始める", () => {
  for (const [appId, last, expected] of [
    ["messages", "thread_b", "thread_b"],
    ["messages", "thread_broken", "thread_a"],
    ["messages", "thread_gone", "thread_a"],
    ["chat", "", "room_a"],
    ["browser", "second", "second"],
    ["browser", "", "first"]
  ]) {
    const h = setup({ lastContentByAppId: last ? { [appId]: last } : {} });
    h.context.openApp(h.context.apps.find((app) => app.id === appId));
    assert.equal(h.context.focusedContentId, expected, `${appId}/${last || "前回なし"}`);
    assert.equal(h.route().contentId, expected);
  }
});

test("詳細始まりのアプリで先頭の項目を開けなければ、一覧から始める", () => {
  const h = setup();
  const original = deviceState.messages;
  h.context.deviceState = { ...deviceState, messages: [original[2], original[0]] };
  h.context.openApp(h.context.apps.find((app) => app.id === "messages"));
  assert.equal(h.context.focusedContentId, "");
  assert.deepEqual(h.route(), { kind: "app", appId: "messages" });
});

test("会話の表示が補正されると、段を増やさずに表示中の会話へ合わせる", () => {
  const h = setup({ activeAppId: "messages", focusedContentId: "attachment_in_thread_b" });
  h.context.handleDisplayedTalkChange("messages", "thread_b");
  assert.deepEqual(h.route(), { kind: "app", appId: "messages", contentId: "thread_b" });
  assert.equal(h.history.entries.length, 2);
});

for (const appId of ["messages", "chat"]) {
  const [itemA, itemB] = appId === "messages" ? ["thread_a", "thread_b"] : ["room_a", "room_b"];

  test(`${appId}: 会話の開封待ちに添付を開いても、表示していた会話へ戻る`, async () => {
    const h = setup({ activeAppId: appId, focusedContentId: itemA });
    const c = h.context;
    h.tapList(appId);
    const selected = h.tapItem(appId, itemB);
    const photo = c.openAppContent(c.apps.find((app) => app.id === "photos"), "photo");
    h.respond(0); await selected;
    h.respond(1); assert.equal(await photo, true);
    c.showTalkBackLink(appId, "photos");
    assert.equal(phoneHistoryStateFrom(h.history.state).previousRoute.contentId, itemB);
    c.openTalkBackLink();
    const pending = c.restorePhoneHistoryRoute(h.route(), ++c.phoneHistoryNavigationId);
    h.respond(2); await pending;
    assert.equal(c.focusedContentId, itemB);
    assert.deepEqual(h.requests.map((request) => request.input.contentId), [itemB, "photo", itemB]);
  });

  for (const first of [0, 1]) {
    test(`${appId}: B→A→Bで同一要求が省略されても、応答順(${first}が先)に関係なく履歴はB`, async () => {
      const h = setup({ activeAppId: appId, focusedContentId: itemA });
      h.tapList(appId);
      const b = h.tapItem(appId, itemB);
      h.tapList(appId);
      const a = h.tapItem(appId, itemA);
      h.tapList(appId);
      assert.equal(await h.tapItem(appId, itemB), false, "処理中の同一要求は省略する");
      assert.equal(h.requests.length, 2);
      h.respond(first); await turn();
      h.respond(1 - first); await Promise.all([a, b]);
      assert.deepEqual(h.route(), { kind: "app", appId, contentId: itemB });
    });
  }
}

test("後から開けなくなった項目の段へ戻ると、一覧詳細アプリは一覧へ、1画面アプリはホームへ退避する", async () => {
  for (const [appId, expected] of [["notes", { kind: "app", appId: "notes" }], ["radio", { kind: "home" }]]) {
    const h = setup({ activeAppId: appId, focusedContentId: "gone" });
    h.context.focusAppContent(appId, "other");
    await h.back({ ok: false, status: 409, error: "not_available" });
    assert.deepEqual(h.route(), expected, appId);
    assert.equal(h.context.activeAppId, expected.kind === "home" ? null : appId);
    if (expected.kind === "app") assert.equal(h.context.focusedContentId, "");
  }
});

test("表示中の項目がcondで消えて一覧へ戻ったら、段を増やさず一覧に置き換える", () => {
  const h = setup({ activeAppId: "mail" });
  h.tapItem("mail", "mail_x");
  const entries = h.history.entries.length;
  h.context.handleDisplayedContentChange("mail", "");
  assert.deepEqual(h.route(), { kind: "app", appId: "mail" });
  assert.equal(h.history.entries.length, entries);
});

test("外からの遷移を待つ間にアプリ内で操作したら、利用者の最後の操作を優先する", async () => {
  const h = setup({ activeAppId: "notes" });
  const c = h.context;
  const external = c.openAppContent(c.apps.find((app) => app.id === "notes"), "note_external");
  const tapped = h.tapItem("notes", "note_tapped");
  h.respond(0); assert.equal(await external, false);
  h.respond(1); await tapped;
  assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_tapped" });
});

test("戻る復元待ちに外からCを開いたら、応答順に関係なく最後のCを表示する", async () => {
  for (const first of [0, 1]) {
    const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
    const c = h.context;
    c.focusAppContent("notes", "note_b");
    h.history.back();
    // 戻る操作の時点でパネルを閉じ、復元完了時には処理中のCを取り消さない。
    c.requestSearchAgentClose();
    const restored = c.restorePhoneHistoryRoute(h.route(), ++c.phoneHistoryNavigationId);
    const opened = c.openAppContent(c.apps.find((app) => app.id === "notes"), "note_c");
    h.respond(first); await turn();
    h.respond(1 - first);
    const [, accepted] = await Promise.all([restored, opened]);
    assert.equal(accepted, true, "応答順 " + first);
    assert.equal(c.focusedContentId, "note_c");
    assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_c" });
  }
});

test("戻る復元待ちの外部Cが拒否されたら、応答順に関係なくAを復元する", async () => {
  for (const first of [0, 1]) {
    const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
    const c = h.context;
    c.focusAppContent("notes", "note_b");
    h.history.back();
    c.requestSearchAgentClose();
    const restored = c.restorePhoneHistoryRoute(h.route(), ++c.phoneHistoryNavigationId);
    const opened = c.openAppContent(c.apps.find((app) => app.id === "notes"), "note_c");
    const denied = { ok: false, status: 422, error: "denied" };
    h.respond(first, first === 1 ? denied : undefined); await turn();
    h.respond(1 - first, first === 0 ? denied : undefined);
    const [, accepted] = await Promise.all([restored, opened]);
    assert.equal(accepted, false, "応答順 " + first);
    assert.equal(c.focusedContentId, "note_a");
    assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_a" });
  }
});

test("ホームへ戻る更新待ちに外からCを開いたら、応答順に関係なく最後のCを表示する", async () => {
  for (const first of [0, 1]) {
    const h = setup({ activeAppId: "notes", focusedContentId: "note_b" });
    const c = h.context;
    let resolveHome;
    c.refreshPlayerStateWithRetry = () => new Promise((resolve) => { resolveHome = resolve; });
    h.history.back();
    c.requestSearchAgentClose();
    const restored = c.restorePhoneHistoryRoute(h.route(), ++c.phoneHistoryNavigationId);
    const opened = c.openAppContent(c.apps.find((app) => app.id === "notes"), "note_c");
    if (first === 0) {
      resolveHome(true); await turn();
      h.respond(0);
    } else {
      h.respond(0); await turn();
      resolveHome(true);
    }
    const [, accepted] = await Promise.all([restored, opened]);
    assert.equal(accepted, true, "応答順 " + first);
    assert.equal(c.activeAppId, "notes");
    assert.equal(c.focusedContentId, "note_c");
    assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_c" });
  }
});

test("復元先のアプリが使えずホームへ退避しても、処理中の別アプリCを取り消さない", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.focusAppContent("notes", "note_b");
  h.history.back();
  c.requestSearchAgentClose();
  const restored = c.restorePhoneHistoryRoute(h.route(), ++c.phoneHistoryNavigationId);
  const opened = c.openAppContent(c.apps.find((app) => app.id === "photos"), "photo_c");
  c.apps = c.apps.map((app) => app.id === "notes" ? { ...app, available: false } : app);
  h.respond(0, { ok: false, status: 409, error: "not_available" });
  await restored;
  assert.equal(c.activeAppId, null);
  assert.deepEqual(h.route(), { kind: "home" });
  h.respond(1);
  assert.equal(await opened, true);
  assert.equal(c.activeAppId, "photos");
  assert.equal(c.focusedContentId, "photo_c");
  assert.deepEqual(h.route(), { kind: "app", appId: "photos", contentId: "photo_c" });
});

test("外からの同じ項目への処理中の要求を省いても、最初の要求の遷移を取り消さない", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  const app = c.apps.find((item) => item.id === "notes");
  const first = c.openAppContent(app, "note_c");
  const navigationId = c.phoneHistoryNavigationId;
  const requestId = c.contentNavigationRequestId;

  assert.equal(await c.openAppContent(app, "note_c"), false);
  assert.equal(c.phoneHistoryNavigationId, navigationId);
  assert.equal(c.contentNavigationRequestId, requestId);
  assert.equal(h.requests.length, 1);
  h.respond(0);
  assert.equal(await first, true);
  assert.equal(c.focusedContentId, "note_c");
  assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_c" });
});

test("同一開封の完了を待つ戻る復元は、取消後に待機が終わっても追加開封を送らない", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  const original = c.handleContentOpen("notes", "note_a");
  c.focusAppContent("notes", "note_b");
  h.history.back();
  let releaseWait;
  c.waitMs = () => new Promise((resolve) => { releaseWait = resolve; });
  c.requestSearchAgentClose();
  const restored = c.restorePhoneHistoryRoute(h.route(), ++c.phoneHistoryNavigationId);
  assert.equal(typeof releaseWait, "function", "先行するAの開封を待っている");
  const tapped = h.tapItem("notes", "note_c");

  h.respond(0); await original;
  releaseWait(); await turn();
  // 修正前の不要な要求も応答させ、未完了Promiseを残さずに要求列を検証する。
  if (h.requests.length > 2) h.respond(2);
  h.respond(1);
  await Promise.all([restored, tapped]);
  assert.deepEqual(h.requests.map((request) => request.input.contentId), ["note_a", "note_c"]);
  assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_c" });
});

test("戻る復元の再試行待ちを取り消したら、待機後も追加開封を送らない", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.focusAppContent("notes", "note_b");
  h.history.back();
  const waits = [];
  c.waitMs = (ms) => new Promise((resolve) => waits.push({ ms, resolve }));
  c.requestSearchAgentClose();
  const restored = c.restorePhoneHistoryRoute(h.route(), ++c.phoneHistoryNavigationId);
  h.respond(0, { ok: false, status: 503, error: "temporary", retryable: true });
  await turn();
  assert.equal(waits.length, 1);
  assert.equal(waits[0].ms, 1000, "既存の初回再試行間隔を維持する");
  const tapped = h.tapItem("notes", "note_c");

  waits[0].resolve(); await turn();
  if (h.requests.length > 2) h.respond(2);
  h.respond(1);
  await Promise.all([restored, tapped]);
  assert.deepEqual(h.requests.map((request) => request.input.contentId), ["note_a", "note_c"]);
  assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_c" });
});

test("1画面アプリは表示中の項目の切り替えで段を置き換え、応答を待たない", () => {
  const h = setup({ activeAppId: "radio", focusedContentId: "radio_a" });
  h.context.handleSingleScreenContentOpen("radio", "radio_b");
  assert.deepEqual(h.route(), { kind: "app", appId: "radio", contentId: "radio_b" });
  assert.equal(h.history.entries.length, 2);
  assert.equal(h.requests.length, 1);
});

test("破損項目の選択は、ノイズと案内だけを出して履歴を変えない", () => {
  const h = setup({ activeAppId: "photos" });
  const entries = structuredClone(h.history.entries);
  h.context.handleBlockedContentTap("photos", "photo_broken");
  assert.deepEqual(h.blocked, ["noise", "photos:photo_broken"]);
  assert.deepEqual(h.history.entries, entries);
});

test("ブラウザーはタブ内のページ移動を積み、同じタブ内へ戻る時は開き直さない", async () => {
  const h = setup({ activeAppId: "browser" });
  const c = h.context;
  const opened = h.tapItem("browser", "first"); h.respond(0); await opened;
  assert.deepEqual(h.route().page, { urls: ["/first.html"], index: 0 });
  c.handleBrowserPageNavigate("first", { urls: ["/first.html", "/first-next.html"], index: 1 }, "push");
  assert.deepEqual(h.route(), { kind: "app", appId: "browser", contentId: "first", page: { urls: ["/first.html", "/first-next.html"], index: 1 } });
  await h.back();
  assert.deepEqual(plain(c.browserPages.first), { urls: ["/first.html"], index: 0 }, "当時のページ履歴を戻す");
  assert.equal(h.requests.length, 1, "同じタブ内のページ移動は開封しない");

  const entries = h.history.entries.length;
  c.handleBrowserPageNavigate("first", { urls: ["/first-moved.html"], index: 0 }, "replace");
  assert.equal(h.history.entries.length, entries, "読み込み結果の補正は段を増やさない");
  assert.deepEqual(h.route().page, { urls: ["/first-moved.html"], index: 0 });
});

test("ブラウザーの別タブの段へ戻ると開き直し、その段のページ履歴を表示する", async () => {
  const h = setup({ activeAppId: "browser" });
  const c = h.context;
  const first = h.tapItem("browser", "first"); h.respond(0); await first;
  c.handleBrowserPageNavigate("first", { urls: ["/first.html", "/first-next.html"], index: 1 }, "push");
  h.tapList("browser");
  const second = h.tapItem("browser", "second"); h.respond(1); await second;
  c.handleBrowserPageNavigate("first", { urls: ["/first.html"], index: 0 }, "replace");
  await h.back();
  await h.back();
  assert.equal(h.requests.at(-1).input.contentId, "first");
  assert.equal(c.focusedContentId, "first");
  assert.deepEqual(plain(c.browserPages.first), { urls: ["/first.html", "/first-next.html"], index: 1 });
});

test("外からブラウザーのタブを開くと最初のページへ移り、前に見ていたページは戻るボタンで戻れる", async () => {
  const h = setup({ activeAppId: "notes" });
  const c = h.context;
  c.browserPages = { first: { urls: ["/first.html", "/first-next.html"], index: 1 } };
  const opened = c.openAppContent(c.apps.find((app) => app.id === "browser"), "first");
  h.respond(0); assert.equal(await opened, true);
  assert.deepEqual(plain(c.browserPages.first), { urls: ["/first.html", "/first-next.html", "/first.html"], index: 2 });
  assert.deepEqual(h.route().page, plain(c.browserPages.first));
});

test("検索AIの開閉だけを戻る・進むで復元するときは、ページを開き直さない", async () => {
  const h = setup({ activeAppId: "messages", focusedContentId: "thread_a" });
  const c = h.context;
  c.scrollPositions = [{ path: [0], top: 240, left: 0 }];
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 125, visibleMessageCount: 80 });
  assert.equal(h.route().searchAgentOpen, true);
  const focusRequests = c.focusedContentRequestId;

  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  await turn();
  assert.equal(c.searchAgentRestoreRequest.open, false);
  assert.deepEqual(c.scrollPositions, [{ path: [0], top: 240, left: 0 }]);

  h.history.go(1);
  c.handlePhoneHistoryPop({ state: h.history.state });
  await turn();
  assert.deepEqual(plain(c.searchAgentRestoreRequest), {
    id: 2, open: true, scrollTop: 125, visibleMessageCount: 80
  });
  assert.equal(c.focusedContentRequestId, focusRequests);
  assert.equal(h.requests.length, 0);
  assert.equal(h.refreshes.length, 0);
});

for (const activeAppId of [null, "notes"]) {
  test(`${activeAppId ?? "ホーム"}の検索AIは一段戻って閉じ、進むで位置ごと再表示できる`, async () => {
    const history = new AsyncHistory();
    history.entries = [{ external: true }, null];
    history.index = 1;
    const h = setup({ history, activeAppId, focusedContentId: activeAppId ? "note_a" : "" });
    const c = h.context;
    c.handleSearchAgentOpenChange(true, "user");
    c.scrollPositions = [{ path: [0], top: 340, left: 0 }];
    c.handleSearchAgentScrollChange({ scrollTop: 125, visibleMessageCount: 80 });
    const openedIndex = history.index;
    const entryCount = history.entries.length;
    const writes = [];
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (value) => { writes.push("push"); push(value); };
    history.replaceState = (value) => { writes.push("replace"); replace(value); };

    c.handleSearchAgentOpenChange(false, "user");
    assert.deepEqual(history.travels, [-1]);
    history.pop(c);
    assert.equal(history.index, openedIndex - 1);
    assert.equal(history.entries.length, entryCount, "開状態は進む先に残す");
    assert.deepEqual(writes, [], "閉じた後に履歴を積み直したり置換したりしない");
    assert.equal(c.searchAgentRestoreRequest, null, "閉じるための内部popでは画面を復元しない");
    assert.equal(c.activeAppId, activeAppId);
    assert.deepEqual(history.entries[0], { external: true });
    assert.deepEqual(plain(currentPhoneHistoryState(history, "test").view.appScroll), [{ path: [0], top: 340, left: 0 }]);

    history.go(1);
    history.pop(c);
    await turn();
    assert.equal(c.searchAgentRestoreRequest.open, true);
    assert.equal(c.searchAgentRestoreRequest.scrollTop, 125);
    assert.equal(c.searchAgentRestoreRequest.visibleMessageCount, 80);
    assert.deepEqual(c.scrollPositions, [{ path: [0], top: 340, left: 0 }]);
    assert.equal(h.requests.length, 0, "同じページを開封し直さない");

    c.handleSearchAgentOpenChange(true, "system");
    c.handleSearchAgentOpenChange(false, "user");
    history.pop(c);
    c.focusAppContent("mail", "mail_b");
    assert.equal(history.index, history.entries.length - 1);
    assert.equal(history.entries.some((state) => state.route?.searchAgentOpen), false,
      "閉じた後に新しい画面を開くと、古い進む先を破棄する");
  });
}

test("ホームでの着信は一段戻って検索AIを閉じ、端末外へ出ず進むで再表示できる", async () => {
  const history = new AsyncHistory();
  history.entries = [{ external: true }, null];
  history.index = 1;
  const h = setup({ history });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");

  startIncomingCall(c);
  assert.equal(c.searchAgentOpen, false);
  assert.deepEqual(history.travels, [-1]);
  assert.deepEqual(currentPhoneHistoryState(history, "test").route, { kind: "home" });
  c.completeIncomingCall("call");
  history.pop(c);
  assert.deepEqual(h.route(), { kind: "home" });
  assert.equal(history.index, 1, "着信による閉じでは端末の根元に留まる");
  assert.deepEqual(history.entries[0], { external: true });
  assert.deepEqual(plain(c.locallyCompletedIncomingCallIds), ["call"]);

  c.activeIncomingCall = null;
  history.go(1);
  history.pop(c);
  await turn();
  assert.equal(c.searchAgentRestoreRequest.open, true, "進むで開状態へ戻る");
  history.back();
  history.pop(c);
  await turn();
  assert.equal(c.searchAgentRestoreRequest.open, false);
  history.back();
  history.pop(c);
  assert.equal(history.index, 0, "利用者の戻るでは端末外へ退出できる");
});

for (const completeFirst of [false, true]) {
  test(`アプリでの着信は内部popで画面を変えず、通話完了${completeFirst ? "先行" : "後行"}でも閉じた画面へ戻れる`, async () => {
    const h = setup({ activeAppId: "notes", focusedContentId: "note_a", history: new AsyncHistory() });
    const c = h.context;
    c.scrollPositions = [{ path: [0], top: 410, left: 0 }];
    c.handleSearchAgentOpenChange(true, "user");
    c.handleSearchAgentScrollChange({ scrollTop: 125, visibleMessageCount: 80 });

    startIncomingCall(c);
    assert.deepEqual(h.history.travels, [-1]);
    assert.equal(currentPhoneHistoryState(h.history, "test").route.searchAgentOpen, undefined);
    if (completeFirst) c.completeIncomingCall("call");
    h.history.pop(c);
    if (!completeFirst) {
      assert.equal(c.activeAppId, "notes", "着信中の内部popはホームへの退避を起こさない");
      c.completeIncomingCall("call");
    }
    c.activeIncomingCall = null;
    assert.equal(c.activeAppId, null);
    assert.deepEqual(h.route(), { kind: "home" });
    assert.deepEqual(h.history.entries.map((state) => state.route), [
      { kind: "home" }, { kind: "app", appId: "notes", contentId: "note_a" }, { kind: "home" }
    ]);
    assert.deepEqual(h.history.travels, []);

    h.history.back();
    h.history.pop(c);
    h.respond(0);
    await turn();
    assert.equal(c.activeAppId, "notes");
    assert.equal(c.focusedContentId, "note_a");
    assert.equal(c.searchAgentRestoreRequest.open, false);
    assert.deepEqual(c.scrollPositions, [{ path: [0], top: 410, left: 0 }]);
    assert.deepEqual(plain(currentPhoneHistoryState(h.history, "test").view.searchAgent), {
      scrollTop: 125, visibleMessageCount: 80
    });
  });
}

test("同じ画面のパネル復元待ちに着信した場合も履歴を閉じ、古い復元を取り消す", async () => {
  const h = setup({ history: new AsyncHistory() });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  const openState = currentPhoneHistoryState(h.history, "test");
  const navigationId = c.phoneHistoryNavigationId;
  c.searchAgentOpen = false;
  c.phoneHistoryViewRestoring = true;
  const restoring = c.restorePhoneHistoryView(openState, navigationId, c.searchAgentCloseRequestId);

  startIncomingCall(c);
  await restoring;
  assert.equal(c.phoneHistoryNavigationId, navigationId + 1);
  assert.equal(c.phoneHistoryViewRestoring, false);
  assert.equal(c.searchAgentRestoreRequest, null);
  assert.equal(c.searchAgentOpen, false);
  h.history.pop(c);
  assert.deepEqual(h.route(), { kind: "home" });
});

test("閉じたパネルへの着信では履歴を増やさず、通常の強制閉じと別画面の履歴には干渉しない", () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a", history: new AsyncHistory() });
  const c = h.context;
  const closedEntries = plain(h.history.entries);
  startIncomingCall(c);
  assert.deepEqual(h.history.entries, closedEntries);
  assert.deepEqual(h.history.travels, []);

  c.handleSearchAgentOpenChange(true, "user");
  const openedEntries = plain(h.history.entries);
  c.requestSearchAgentClose();
  c.handleSearchAgentOpenChange(false, "system");
  assert.deepEqual(h.history.entries, openedEntries, "通常の強制閉じは遷移元の開状態を残す");
  assert.deepEqual(h.history.travels, []);

  const differentRoute = { kind: "app", appId: "mail", contentId: "mail_b", searchAgentOpen: true };
  pushPhoneHistoryRoute(h.history, "test", differentRoute);
  c.requestSearchAgentClose({ recordHistory: true });
  assert.deepEqual(h.route(), differentRoute, "別ページへの復元先を現在の画面で上書きしない");
  assert.deepEqual(h.history.travels, []);
});

test("検索結果の別ページから戻ると、元ページと検索AI双方の位置を復元する", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.scrollPositions = [{ path: [0, 1], top: 360, left: 0 }];
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 72, visibleMessageCount: 120 });
  c.focusAppContent("mail", "mail_b");
  c.handleSearchAgentOpenChange(false, "system");
  assert.equal(h.history.entries.length, 4, "ページ移動時の強制閉じで段を増やさない");
  c.scrollPositions = [{ path: [0], top: 10, left: 0 }];

  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  h.respond(0);
  await turn();
  assert.equal(c.activeAppId, "notes");
  assert.equal(c.focusedContentId, "note_a");
  assert.deepEqual(c.scrollPositions, [{ path: [0, 1], top: 360, left: 0 }]);
  assert.deepEqual(plain(c.searchAgentRestoreRequest), {
    id: 1, open: true, scrollTop: 72, visibleMessageCount: 120
  });
});

test("復元前の検索AIから届く閉じ通知で、復元先のスクロール位置を上書きしない", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 180, visibleMessageCount: 80 });
  c.focusAppContent("mail", "mail_b");
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  c.handleSearchAgentScrollChange({ scrollTop: 0, visibleMessageCount: 40 });
  c.saveCurrentPhoneHistoryView();
  assert.equal(currentPhoneHistoryState(h.history, "test").view.searchAgent.scrollTop, 180);
  h.respond(0);
  await turn();
  assert.equal(c.searchAgentRestoreRequest.scrollTop, 180);
});

test("アプリ内で選んだ項目の検索AIを戻すときも、実表示を保って開閉だけを復元する", async () => {
  const h = setup({ activeAppId: "notes" });
  const c = h.context;
  const opened = h.tapItem("notes", "note_a"); h.respond(0); await opened;
  assert.equal(c.focusedContentId, "", "外部からのfocus要求は一覧のまま");
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 90, visibleMessageCount: 80 });
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  await turn();
  assert.equal(h.requests.length, 1, "検索AIの復元で項目を開き直さない");
  assert.equal(c.focusedContentRequestId, 0);
  assert.equal(c.searchAgentRestoreRequest.open, false);
});

test("閉→開→閉を繰り返した後の別ページからは、最新の閉じた画面位置へ戻る", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  for (const top of [100, 260, 420]) {
    c.scrollPositions = [{ path: [0], top, left: 0 }];
    c.handleSearchAgentOpenChange(true, "user");
    c.handleSearchAgentOpenChange(false, "user");
    assert.equal(h.history.index, 1, "閉じた元の画面へ一段戻る");
    assert.equal(h.history.entries.length, 3, "進む先に一つだけ開状態を保ち、開閉の往復を蓄積しない");
  }
  c.focusAppContent("mail", "mail_b");
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  h.respond(0);
  await turn();
  assert.deepEqual(c.scrollPositions, [{ path: [0], top: 420, left: 0 }]);
  assert.equal(c.searchAgentRestoreRequest.open, false);
});

test("別ページへの復元待ちに検索AIを開いた場合は、現在見えているページの履歴にする", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.focusAppContent("notes", "note_b");
  c.handleDisplayedContentChange("notes", "note_b");
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  c.scrollPositions = [{ path: [0], top: 510, left: 0 }];
  c.handleSearchAgentOpenChange(true, "user");
  h.respond(0);
  await turn();
  assert.equal(c.focusedContentId, "note_b");
  assert.deepEqual(h.route(), { kind: "app", appId: "notes", contentId: "note_b", searchAgentOpen: true });
  assert.deepEqual(plain(currentPhoneHistoryState(h.history, "test").view.appScroll), [{ path: [0], top: 510, left: 0 }]);
});

test("復元待ち中の強制閉じでは検索AIを開き直さず、古い閉じ通知も次ページへ保存しない", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  c.focusAppContent("mail", "mail_b");
  c.handleSearchAgentScrollChange({ scrollTop: 999, visibleMessageCount: 40 });
  c.handleSearchAgentOpenChange(false, "system");
  assert.equal(currentPhoneHistoryState(h.history, "test").view?.searchAgent, undefined);
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  c.requestSearchAgentClose();
  h.respond(0);
  await turn();
  assert.equal(c.searchAgentRestoreRequest.open, false);
});

test("検索AIを開いている間のブラウザURL補正は開閉状態を保持する", () => {
  const h = setup({ activeAppId: "browser", focusedContentId: "first" });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  c.handleBrowserPageNavigate("first", { urls: ["/first-moved.html"], index: 0 }, "replace");
  assert.equal(h.route().searchAgentOpen, true);
  assert.deepEqual(h.route().page, { urls: ["/first-moved.html"], index: 0 });
});

test("適用済みの検索AI復元要求を破棄し、再マウントで古い開状態を再適用させない", () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.phoneHistoryViewRestoring = true;
  c.searchAgentRestoreRequest = { id: 1, open: true };
  c.handleSearchAgentOpenChange(true, "system");
  assert.equal(c.searchAgentRestoreRequest, null);
  assert.equal(h.history.entries.length, 2, "復元完了通知で履歴を増やさない");
  c.phoneHistoryViewRestoring = false;
  c.handleSearchAgentOpenChange(false, "system");
  assert.equal(c.searchAgentOpen, false);
  assert.equal(c.searchAgentRestoreRequest, null);
});

test("会話一覧で検索AIを開いて戻る場合も、以前の会話を開き直さない", async () => {
  for (const appId of ["messages", "chat"]) {
    const h = setup({ activeAppId: appId, focusedContentId: appId === "messages" ? "thread_a" : "room_a" });
    const c = h.context;
    h.tapList(appId);
    c.handleSearchAgentOpenChange(true, "user");
    assert.deepEqual(h.route(), { kind: "app", appId, searchAgentOpen: true });
    h.history.back();
    c.handlePhoneHistoryPop({ state: h.history.state });
    await turn();
    assert.equal(c.searchAgentRestoreRequest.open, false);
    assert.equal(h.requests.length, 0);
    assert.equal(c.focusedContentRequestId, 0);
  }
});

test("native backで出発画面の離脱位置だけを保存し、forwardで最新位置を復元する", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.scrollPositions = [{ path: [0], top: 150, left: 0 }];
  c.focusAppContent("mail", "mail_b");
  c.scrollPositions = [{ path: [0], top: 720, left: 0 }];
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  h.respond(0);
  await turn();
  assert.deepEqual(c.scrollPositions, [{ path: [0], top: 150, left: 0 }]);

  h.history.go(1);
  c.handlePhoneHistoryPop({ state: h.history.state });
  h.respond(1);
  await turn();
  assert.deepEqual(c.scrollPositions, [{ path: [0], top: 720, left: 0 }]);
});

test("戻るリンクはpopを待つ前に出発位置を保存し、forwardで元の表示へ戻れる", async () => {
  const h = setup({ activeAppId: "messages", focusedContentId: "thread_a", history: new AsyncHistory() });
  const c = h.context;
  c.focusAppContent("notes", "note_a");
  c.scrollPositions = [{ path: [0], top: 530, left: 0 }];
  c.showTalkBackLink("messages", "notes");
  c.openTalkBackLink();
  c.scrollPositions = [{ path: [0], top: 999, left: 0 }];
  h.history.pop(c);
  h.respond(0);
  await turn();
  h.history.go(1);
  h.history.pop(c);
  h.respond(1);
  await turn();
  assert.deepEqual(c.scrollPositions, [{ path: [0], top: 530, left: 0 }]);
});

test("検索の位置通知は走査せず最後の値だけを持ち、閉じる時に保存する", () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  let captures = 0;
  c.capturePhoneHistoryScroll = () => { captures += 1; return []; };
  for (let top = 1; top <= 1000; top += 1) c.handleSearchAgentScrollChange({ scrollTop: top, visibleMessageCount: 80 });
  assert.equal(captures, 0);
  assert.equal(currentPhoneHistoryState(h.history, "test").view?.searchAgent, undefined);
  c.handleSearchAgentOpenChange(false, "user");
  assert.equal(captures, 1);
  assert.deepEqual(plain(currentPhoneHistoryState(h.history, "test").view.searchAgent), {
    scrollTop: 1000, visibleMessageCount: 80
  });
  assert.equal(c.searchAgentScrollPosition, undefined);
});

test("modalによる検索の破棄は最後の通知を保存し、端末DOM全体の破棄では0で上書きしない", () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 456, visibleMessageCount: 120 });
  c.appModalOpen = true;
  c.handleSearchAgentOpenChange(false, "system");
  assert.deepEqual(plain(currentPhoneHistoryState(h.history, "test").view.searchAgent), {
    scrollTop: 456, visibleMessageCount: 120
  });
  c.searchAgentOpen = true;
  c.phoneHistorySurface.isConnected = false;
  c.scrollPositions = [{ path: [0], top: 0, left: 0 }];
  c.handleSearchAgentOpenChange(false, "system");
  assert.deepEqual(plain(currentPhoneHistoryState(h.history, "test").view.searchAgent), {
    scrollTop: 456, visibleMessageCount: 120
  });
});

test("systemで検索を閉じた後の背景ページの離脱位置も、forwardで復元する", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.scrollPositions = [{ path: [0], top: 150, left: 0 }];
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 456, visibleMessageCount: 120 });
  c.handleSearchAgentOpenChange(false, "system");
  c.scrollPositions = [{ path: [0], top: 900, left: 0 }];
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  await turn();
  h.history.go(1);
  c.handlePhoneHistoryPop({ state: h.history.state });
  await turn();
  assert.deepEqual(c.scrollPositions, [{ path: [0], top: 900, left: 0 }]);
  assert.equal(c.searchAgentRestoreRequest.scrollTop, 456);
  assert.equal(c.searchAgentRestoreRequest.visibleMessageCount, 120);
});

test("scope切替と検索の新規開閉で旧slotを引き継がず、復元中は既存viewを守る", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 456, visibleMessageCount: 120 });
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  c.handleSearchAgentScrollChange({ scrollTop: 0, visibleMessageCount: 40 });
  await turn();
  assert.equal(c.searchAgentScrollPosition, undefined);
  h.history.go(1);
  c.handlePhoneHistoryPop({ state: h.history.state });
  await turn();
  assert.equal(c.searchAgentRestoreRequest.scrollTop, 456);
  assert.equal(c.searchAgentRestoreRequest.visibleMessageCount, 120);
  c.handleSearchAgentOpenChange(true, "system");
  c.saveCurrentPhoneHistoryView();
  assert.equal(currentPhoneHistoryState(h.history, "test").view.searchAgent.scrollTop, 456);

  c.resetPhoneHistoryBoundary({ kind: "home" });
  assert.equal(c.searchAgentScrollPosition, undefined);
  assert.equal(currentPhoneHistoryState(h.history, "next-scope").view, undefined);
  c.activeAppId = null;
  c.searchAgentOpen = false;
  c.handleSearchAgentOpenChange(true, "user");
  assert.equal(currentPhoneHistoryState(h.history, "next-scope").view?.searchAgent, undefined);
});

test("scope切替後に旧検索のsystem閉じが届いても、新しい履歴へ旧DOM位置を保存しない", () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  c.scrollPositions = [{ path: [0], top: 900, left: 0 }];
  c.handleSearchAgentScrollChange({ scrollTop: 456, visibleMessageCount: 120 });
  c.resetPhoneHistoryBoundary({ kind: "home" });
  // 境界変更後も接続中の旧パネルから、閉じる直前の位置通知が届き得る。
  c.handleSearchAgentScrollChange({ scrollTop: 456, visibleMessageCount: 120 });
  c.handleSearchAgentOpenChange(false, "system");
  assert.equal(currentPhoneHistoryState(h.history, "next-scope").view, undefined);
});

test("閉じるための内部popでは表示中の新しい検索slotを消さない", () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a", history: new AsyncHistory() });
  const c = h.context;
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentOpenChange(false, "user");
  c.handleSearchAgentOpenChange(true, "user");
  c.handleSearchAgentScrollChange({ scrollTop: 321, visibleMessageCount: 80 });
  h.history.pop(c);
  assert.deepEqual(plain(c.searchAgentScrollPosition), { scrollTop: 321, visibleMessageCount: 80 });
  c.focusAppContent("mail", "mail_b");
  h.history.back();
  h.history.pop(c);
  assert.deepEqual(plain(currentPhoneHistoryState(h.history, "test").view.searchAgent), {
    scrollTop: 321, visibleMessageCount: 80
  });
});

test("連続popの復元待ちには旧DOMを途中entryへ保存しない", async () => {
  const h = setup({ activeAppId: "notes", focusedContentId: "note_a" });
  const c = h.context;
  c.scrollPositions = [{ path: [0], top: 150, left: 0 }];
  c.focusAppContent("mail", "mail_b");
  c.scrollPositions = [{ path: [0], top: 450, left: 0 }];
  c.focusAppContent("photos", "photo_c");
  c.scrollPositions = [{ path: [0], top: 700, left: 0 }];
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  let captures = 0;
  c.capturePhoneHistoryScroll = () => { captures += 1; return c.scrollPositions; };
  h.history.back();
  c.handlePhoneHistoryPop({ state: h.history.state });
  assert.equal(captures, 0);
  h.respond(0); h.respond(1);
  await turn();
  h.history.go(1);
  c.handlePhoneHistoryPop({ state: h.history.state });
  h.respond(2);
  await turn();
  assert.deepEqual(c.scrollPositions, [{ path: [0], top: 450, left: 0 }]);
});

function searchHistoryHarness(app, list) {
  // SearchAgentの通知→Appの離脱保存→復元要求→SearchAgentの位置適用を実関数でつなぐ。
  return componentFunctionHarness(new URL("../src/client/system/SearchAgent.svelte", import.meta.url), [
    "reportScrollPosition", "isMessageListNearBottom", "restoreExpanded", "closePanel"
  ], {
    messageListElement: list, visibleMessageCount: 120, expanded: true, destroyed: false,
    panelViewRequestId: 0, restoringScrollRequestId: undefined, openedSurfaceMessageKey: "",
    surfaceBubbleVisible: false, surfaceMessageKey: "", expandedFromVisible: false, agentPeeking: true,
    SEARCH_HISTORY_PAGE_SIZE: 40, tick: () => Promise.resolve(), dismissSurfaceMessage() {},
    onScrollChange: (position) => app.handleSearchAgentScrollChange(position),
    onOpenChange: (open, source) => app.handleSearchAgentOpenChange(open, source)
  });
}

function searchMessageList(height, top) {
  let position = top;
  return {
    scrollHeight: height, clientHeight: 400, isConnected: true,
    get scrollTop() { return position; },
    set scrollTop(value) { position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
  };
}

for (const departure of ["別ページからBack", "閉じた後にForward"]) {
  test(`検索AIは${departure}で、不在中の新着を末尾へ表示し、上読み位置と表示件数を保つ`, async () => {
    for (const [label, oldTop, followsBottom] of [
      ["末尾", 1200, true], ["末尾から48px", 1152, true],
      ["末尾から49px", 1151, false], ["途中", 400, false], ["先頭", 0, false]
    ]) {
      const h = setup({ activeAppId: "notes", focusedContentId: "note_a", history: new AsyncHistory() });
      const c = h.context;
      c.handleSearchAgentOpenChange(true, "user");
      const search = searchHistoryHarness(c, searchMessageList(1600, oldTop));
      search.reportScrollPosition();
      if (departure === "別ページからBack") {
        c.focusAppContent("mail", "mail_b");
        h.history.back();
        h.history.pop(c);
        h.respond(0);
      } else {
        search.closePanel("user");
        h.history.pop(c);
        h.history.go(1);
        h.history.pop(c);
      }
      await turn();
      const request = c.searchAgentRestoreRequest;
      assert.equal(request.open, true, label);
      assert.equal(request.visibleMessageCount, 120, label);
      assert.equal(Object.hasOwn(request, "scrollTop"), !followsBottom, label);
      if (!followsBottom) assert.equal(request.scrollTop, oldTop, label);

      // 不在中に300pxの新着が増えた復元先を用意する。
      const returnedList = searchMessageList(1900, 0);
      search.messageListElement = returnedList;
      await search.restoreExpanded(request);
      assert.equal(returnedList.scrollTop, followsBottom ? 1500 : oldTop, label);
      assert.equal(search.visibleMessageCount, 120, label);
    }
  });
}
