import assert from "node:assert/strict";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";
import { phoneHistoryStateFrom, pushPhoneHistoryRoute, replacePhoneHistoryRoute, goBackInPhoneHistory } from "../src/client/system/phoneHistory.ts";

const appUrl = new URL("../src/client/App.svelte", import.meta.url);
const turn = () => new Promise(setImmediate);

class History {
  entries = [null];
  index = 0;
  get state() { return this.entries[this.index]; }
  replaceState(value) { this.entries[this.index] = structuredClone(value); }
  pushState(value) { this.entries.splice(++this.index); this.entries.push(structuredClone(value)); }
  back() { this.index -= 1; }
}

function setup(appId, initialContentId = "thread_a") {
  const history = new History();
  replacePhoneHistoryRoute(history, "test", { kind: "home" });
  pushPhoneHistoryRoute(history, "test", { kind: "app", appId, ...(initialContentId ? { contentId: initialContentId } : {}) });
  const requests = [], readSyncs = [], mediaSyncs = [];
  const context = componentFunctionHarness(appUrl, [
    "handleContentOpen", "rememberAppContent", "contentOpenKey", "syncPhoneHistoryContent", "handleDisplayedTalkChange",
    "replaceCurrentPhoneRoute", "pushCurrentPhoneRoute", "focusAppContent", "focusOpenedContent", "requestSearchAgentClose",
    "suppressNextContentOpenReport", "openContentFromExplicitNavigation", "openAppContent", "captureContentNavigation",
    "showTalkBackLink", "openTalkBackLink", "restorePhoneHistoryRoute", "openPhoneHistoryContent", "beginAppSession", "openApp",
    "clearPhoneRoute", "fallbackPhoneHistoryToHome", "PROGRESSION_RETRY_DELAYS_MS"
  ], {
    window: { history }, phoneHistoryStateFrom, pushPhoneHistoryRoute, replacePhoneHistoryRoute, goBackInPhoneHistory,
    qaMode: false, phoneHistoryReady: true, phoneHistoryScope: "test", phoneHistoryNavigationId: 0,
    contentNavigationRequestId: 0, searchAgentCloseRequestId: 0,
    uiState: { sessionToken: "session", locked: false, lastContentByAppId: { [appId]: initialContentId } },
    playerState: { stateVersion: 1, revision: "test", clientRevision: "test" }, globalErrorVisible: false,
    activeAppId: appId, focusedContentId: initialContentId, focusedContentRequestId: 0, focusedTalkHistoryRepairId: "",
    displayedTalkTarget: initialContentId ? { appId, contentId: initialContentId } : null,
    shadeOpen: false, transientAssistantMessage: undefined, temporaryTalkBackLink: null, notificationToast: null, appModalOpen: false,
    apps: [{ id: appId, available: true }, { id: "photos", available: true }],
    inFlightContentOpenKeys: [], inFlightMediaObservedKeys: [], suppressedContentOpenKeys: [],
    pendingTalkReadCursorPayload: () => [{ talkId: "thread_b", messageId: "last_read" }],
    clearSyncedTalkReadCursors(cursors) { readSyncs.push(cursors); },
    queueAlbumMediaAddedAssistant(...args) { mediaSyncs.push(args); },
    enqueuePresentation() {}, applyErrorPlayerState() {}, trackEvent() {}, refreshPlayerStateWithRetry: async () => true,
    showGlobalError() { context.globalErrorVisible = true; }, waitMs: () => Promise.resolve(),
    recordContentOpened(_token, input, cursors) {
      return new Promise(resolve => requests.push({ input, cursors, resolve }));
    }
  });
  context.persist = partial => { context.uiState = { ...context.uiState, ...partial }; };
  context.applyPlayerState = state => {
    if (state.stateVersion < context.playerState.stateVersion) return false;
    context.playerState = state;
    return true;
  };
  let version = 1;
  function respond(index, result) {
    assert.ok(requests[index]);
    requests[index].resolve(result ?? { ok: true, playerState: { stateVersion: ++version, revision: "test", clientRevision: "test" } });
  }
  function select(contentId) {
    // 両会話componentの順序と同じく、開封報告の直後に表示済み会話を通知する。
    const pending = context.handleContentOpen(appId, contentId, { mediaContentIds: ["photo"] });
    context.handleDisplayedTalkChange(appId, contentId);
    return pending;
  }
  async function restore(back = "link", result) {
    context.showTalkBackLink(appId, "photos");
    if (back === "link") context.openTalkBackLink(); else history.back();
    const route = phoneHistoryStateFrom(history.state, "test").route;
    const before = requests.length;
    const pending = context.restorePhoneHistoryRoute(route, ++context.phoneHistoryNavigationId);
    if (requests.length > before) respond(before, result);
    await pending;
  }
  return { context, history, requests, readSyncs, mediaSyncs, respond, select, restore,
    route: () => phoneHistoryStateFrom(history.state, "test").route };
}

for (const appId of ["messages", "chat"]) {
  for (const back of ["link", "browser"]) {
    test(`${appId}: 会話開封待ちに添付を開いても${back}で表示していた会話へ戻る`, async () => {
      const h = setup(appId), c = h.context;
      const selected = h.select("thread_b");
      const photo = c.openAppContent(c.apps[1], "photo");
      h.respond(0); await selected;
      h.respond(1); assert.equal(await photo, true);
      assert.equal(phoneHistoryStateFrom(h.history.state).previousRoute.contentId, "thread_b");
      await h.restore(back);
      assert.equal(c.focusedContentId, "thread_b");
      assert.equal(c.uiState.lastContentByAppId[appId], "thread_b");
      assert.deepEqual(h.requests.map(request => request.input.contentId), ["thread_b", "photo", "thread_b"]);
      assert.deepEqual([...h.requests[0].input.mediaContentIds], ["photo"]);
      assert.equal(h.readSyncs.length, 3);
      assert.equal(h.mediaSyncs.length, 3);
    });
  }

  for (const first of [0, 1]) {
    test(`${appId}: B→A→Bで同一要求が省略されても履歴はB（先に返る応答${first}）`, async () => {
      const h = setup(appId), c = h.context;
      const b = h.select("thread_b"), a = h.select("thread_a");
      assert.equal(await h.select("thread_b"), false);
      assert.equal(h.requests.length, 2);
      h.respond(first); await turn();
      assert.equal(h.route().contentId, "thread_b");
      h.respond(1 - first); await Promise.all([a, b]);
      assert.equal(h.route().contentId, "thread_b");
      const photo = c.openAppContent(c.apps[1], "photo");
      h.respond(2); await photo;
      await h.restore();
      assert.equal(c.focusedContentId, "thread_b");
    });
  }

  test(`${appId}: IDなしのアプリ起動でも表示通知から履歴が決まり、ホーム再起動も変えない`, async () => {
    const h = setup(appId, ""), c = h.context;
    const selected = h.select("thread_b");
    assert.equal(h.route().contentId, "thread_b");
    h.respond(0); await selected;
    c.clearPhoneRoute(); c.pushCurrentPhoneRoute({ kind: "home" });
    c.openApp(c.apps[0]);
    assert.equal(c.focusedContentId, "thread_b");
    assert.equal(h.route().contentId, "thread_b");
  });

  test(`${appId}: 未表示の明示遷移は受理前に履歴を書かず、受理後も直前の会話を保存する`, async () => {
    const h = setup(appId), c = h.context;
    const rejected = c.openAppContent(c.apps[0], "thread_b");
    assert.equal(h.route().contentId, "thread_a");
    h.respond(0, { ok: false, status: 422, error: "denied" });
    assert.equal(await rejected, false);
    assert.equal(h.route().contentId, "thread_a");
    const accepted = c.openAppContent(c.apps[0], "thread_b");
    h.respond(1); assert.equal(await accepted, true);
    assert.equal(h.route().contentId, "thread_b");
    assert.equal(phoneHistoryStateFrom(h.history.state).previousRoute.contentId, "thread_a");
  });

  test(`${appId}: 表示済みでもhookが拒否する会話は、履歴復元時に再判定してホームへ退避する`, async () => {
    const h = setup(appId), c = h.context;
    const selected = h.select("thread_b");
    h.respond(0, { ok: false, status: 422, error: "denied" });
    assert.equal(await selected, false);
    const photo = c.openAppContent(c.apps[1], "photo");
    h.respond(1); await photo;
    await h.restore("link", { ok: false, status: 422, error: "denied" });
    assert.equal(h.requests.at(-1).input.contentId, "thread_b", "表示していた会話を再判定する");
    assert.equal(c.activeAppId, null);
    assert.equal(c.focusedContentId, "");
    assert.equal(h.route().kind, "home");
  });

  test(`${appId}: 通信失敗でも別会話の履歴にせず、既存の限定再試行後に明示エラーとなる`, async () => {
    const h = setup(appId), c = h.context;
    const selected = h.select("thread_b");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      h.respond(attempt, { ok: false, status: 503, error: "temporary", retryable: true });
      await turn();
    }
    assert.equal(await selected, false);
    assert.equal(c.globalErrorVisible, true);
    assert.equal(h.route().contentId, "thread_b");
    assert.equal(h.requests.length, 3);
  });

  test(`${appId}: 移動後に届く古い開封応答はアルバムと過去の会話履歴を書き換えない`, async () => {
    const h = setup(appId), c = h.context;
    const selected = h.select("thread_b");
    const photo = c.openAppContent(c.apps[1], "photo");
    h.respond(1, { ok: true, playerState: { stateVersion: 3, revision: "test", clientRevision: "test" } });
    await photo;
    const saved = structuredClone(h.history.entries);
    h.respond(0, { ok: true, playerState: { stateVersion: 2, revision: "test", clientRevision: "test" } });
    assert.equal(await selected, true);
    assert.equal(c.activeAppId, "photos");
    assert.equal(c.focusedContentId, "photo");
    assert.deepEqual(h.history.entries, saved);
    assert.equal(phoneHistoryStateFrom(h.history.state).previousRoute.contentId, "thread_b");
  });

  test(`${appId}: 会話一覧を開いても戻り先を失わず、先行応答で別会話へ巻き戻らない`, async () => {
    const h = setup(appId), c = h.context;
    const a = h.select("thread_a"), b = h.select("thread_b");
    c.handleDisplayedTalkChange(appId, "");
    h.respond(1); await b;
    h.respond(0); await a;
    assert.equal(c.displayedTalkTarget, null);
    assert.equal(h.route().contentId, "thread_b");
    assert.equal(h.history.entries.length, 2, "アプリ内の選択で新しい履歴を積まない");
  });
}
