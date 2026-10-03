import assert from "node:assert/strict";
import test from "node:test";
import { browserPagesModule } from "./helpers/browser-app-harness.mjs";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";
import {
  goBackInPhoneHistory,
  phoneHistoryStateFrom,
  pushPhoneHistoryRoute,
  replacePhoneHistoryRoute,
  samePhoneHistoryRoute
} from "../src/client/system/phoneHistory.ts";

const appUrl = new URL("../src/client/App.svelte", import.meta.url);
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
function setup({ activeAppId = null, focusedContentId = "", lastContentByAppId = {} } = {}) {
  const history = new History();
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
    "beginAppSession", "openApp", "appStartContentId", "clearPhoneRoute", "fallbackPhoneHistoryToHome", "fallbackPhoneHistoryToApp",
    "currentHistoryRoute", "appRoute", "isListDetailApp", "browserTabFor", "setBrowserPage",
    "PROGRESSION_RETRY_DELAYS_MS", "LIST_START_APP_IDS", "DETAIL_START_APP_IDS"
  ], {
    window: { history }, phoneHistoryStateFrom, pushPhoneHistoryRoute, replacePhoneHistoryRoute, goBackInPhoneHistory,
    samePhoneHistoryRoute, ...browserPages,
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
