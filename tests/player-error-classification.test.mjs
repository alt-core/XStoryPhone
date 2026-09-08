import assert from "node:assert/strict";
import test from "node:test";
import { isBrowserPlayerStorageError } from "../src/client/system/browserPlayerStorage.ts";
import { localPlayerMemoryKey, playerSessionChanged } from "../src/client/system/playerSession.ts";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

const appUrl = new URL("../src/client/App.svelte", import.meta.url);
const lockUrl = new URL("../src/client/system/LockScreen.svelte", import.meta.url);

function failure(error, status, playerState = { stateVersion: 2 }) {
  return { ok: false, error, ...(status === undefined ? {} : { status }), ...(playerState ? { playerState } : {}) };
}

function classificationHarness(overrides = {}) {
  const effects = [];
  const cached = [];
  const context = componentFunctionHarness(appUrl, [
    "isUnauthorizedFailure", "isBrowserProgressSizeFailure", "showBrowserProgressSizeError",
    "applyErrorPlayerState", "clearUnauthorizedPlayerUi", "applyPlayerState", "showGlobalError",
    "refreshPlayerState", "entryError", "openBrowserSession", "startPlayerPasscodeSession",
    "unlockDevice", "applyStartedSession"
  ], {
    playerMode: "browser", deviceLockMethod: "none", initialDeviceLocked: true,
    playerOperationGeneration: 0, playerState: { stateVersion: 1 },
    uiState: {
      sessionToken: "session", locked: false,
      lastContentByAppId: { notes: "note" },
      localTalkReadCursors: { talk: 4 }, pendingTalkReadCursors: { talk: 5 }
    },
    localQaMode: false, CLIENT_RUNTIME_REVISION: "", FORCE_RELOAD_STORAGE_KEY: "reload",
    safeSessionStorage: { removeItem() {} },
    isBrowserPlayerStorageError, localPlayerMemoryKey, playerSessionChanged,
    globalErrorVisible: false, globalErrorSupportCode: "AP-CLIENT", globalErrorMessage: "",
    lastPlayerStateRefreshRequestedAt: 0, pendingPlayerPasscode: "", pendingNotificationOpen: null,
    displayedTalkTarget: null, locallySuppressedNotificationIds: [],
    cachePlayerState(state) { cached.push(state); },
    clearPlayerStateCache() { effects.push("clear-cache"); },
    clearTranscriptStorage() { effects.push("clear-transcript"); },
    clearTalkDelaySeenMessagesForMemoryKey(key) { effects.push(`clear-delay:${key}`); },
    clearRuntimeState() { effects.push("clear-runtime"); },
    clearStartConfirmationForReset() { effects.push("clear-start"); },
    persist(value) { context.uiState = { ...context.uiState, ...value }; },
    stopBackgroundMediaPlayback() {}, cancelPresentations() {}, resetPhoneHistoryBoundary() {},
    enqueuePresentation() {}, trackEvent(event) { effects.push(event.name); },
    console: { error() {}, warn() {} },
    loadBrowserPlayerMarker: () => undefined,
    async loadPlayerState() { assert.fail("想定外の状態取得です"); },
    async startSession() { assert.fail("想定外の新規開始です"); },
    async verifyDevicePin() { assert.fail("想定外のPIN検証です"); },
    ...overrides
  });
  return { context, effects, cached };
}

function lockHarness(onUnlock, unlockMethod = "player-passcode") {
  return componentFunctionHarness(lockUrl, ["errorLabel", "submitCode"], {
    onUnlock, unlockMethod, digits: "12345678", busy: false, pressedKey: "8", pulse: false, errorMessage: ""
  });
}

test("認証解除は実401と内部のstatusなしだけに限定し、422の更新済み状態とUIを保持する", () => {
  for (const playerMode of ["browser", "server"]) {
    for (const status of [undefined, 401, 422, 500]) {
      const { context, effects, cached } = classificationHarness({ playerMode });
      const result = failure("unauthorized", status);
      context.applyErrorPlayerState(result);
      const unauthorized = status === undefined || status === 401;
      assert.equal(context.isUnauthorizedFailure(result), unauthorized);
      assert.equal(context.playerOperationGeneration, unauthorized ? 1 : 0);
      assert.equal(context.uiState.sessionToken, unauthorized ? undefined : "session");
      assert.equal(context.uiState.locked, unauthorized);
      assert.equal(context.uiState.lastContentByAppId.notes, unauthorized ? undefined : "note");
      assert.equal(context.uiState.localTalkReadCursors.talk, unauthorized ? undefined : 4);
      assert.equal(context.uiState.pendingTalkReadCursors.talk, unauthorized ? undefined : 5);
      assert.equal(context.playerState, unauthorized ? null : result.playerState);
      assert.deepEqual(cached, unauthorized ? [] : [result.playerState]);
      assert.equal(effects.includes("clear-cache"), unauthorized);
      assert.equal(effects.includes("clear-runtime"), unauthorized);
      assert.equal(effects.includes("clear-transcript"), unauthorized && playerMode === "server");
      assert.equal(effects.includes("clear-start"), unauthorized && playerMode === "browser");
      assert.equal(context.globalErrorVisible, false);
    }
  }
});

test("進行容量エラーの全画面表示は理由と実500の組み合わせだけを受け入れる", () => {
  for (const error of ["browser_progress_too_large", "request_rejected"]) {
    for (const status of [undefined, 422, 500, 503]) {
      const { context, effects, cached } = classificationHarness();
      const result = failure(error, status);
      context.applyErrorPlayerState(result);
      const tooLarge = error === "browser_progress_too_large" && status === 500;
      assert.equal(context.isBrowserProgressSizeFailure(result), tooLarge);
      assert.equal(context.globalErrorVisible, tooLarge);
      assert.equal(context.globalErrorSupportCode, tooLarge ? "AP-PROGRESS-SIZE" : "AP-CLIENT");
      assert.equal(context.uiState.sessionToken, "session");
      assert.equal(context.playerState, result.playerState);
      assert.deepEqual(cached, [result.playerState]);
      assert.deepEqual(effects, []);
    }
  }
});

test("状態更新の早期終了も実認証失効だけに限定し、422認証理由は通常の取得失敗になる", async () => {
  for (const status of [undefined, 401, 422]) {
    const result = failure("unauthorized", status);
    const { context, effects } = classificationHarness({ loadPlayerState: async () => result });
    if (status === 422) {
      await assert.rejects(context.refreshPlayerState("session"), /player_state_refresh_failed:unauthorized/u);
      assert.equal(context.uiState.sessionToken, "session");
      assert.deepEqual(effects, []);
    } else {
      // 失効は、通常の応答の受理条件が成立しなくても認証UIを解除する。
      await context.refreshPlayerState("session", () => false);
      assert.equal(context.uiState.sessionToken, undefined);
      assert.ok(effects.includes("clear-cache"));
    }
    assert.equal(context.globalErrorVisible, false);
  }
});

test("状態更新からの直接容量判定でも422は通常の取得失敗、実500だけが容量画面になる", async () => {
  for (const status of [undefined, 422, 500]) {
    const { context } = classificationHarness({
      loadPlayerState: async () => failure("browser_progress_too_large", status)
    });
    if (status === 500) {
      await context.refreshPlayerState("session");
      assert.equal(context.globalErrorSupportCode, "AP-PROGRESS-SIZE");
      assert.equal(context.globalErrorVisible, true);
    } else {
      await assert.rejects(context.refreshPlayerState("session"), /player_state_refresh_failed:browser_progress_too_large/u);
      assert.equal(context.globalErrorVisible, false);
    }
    assert.equal(context.uiState.sessionToken, "session");
  }
});

test("browser再開時の422認証理由は新規sessionへ進まず、拒否に含まれる状態を保持する", async () => {
  let starts = 0;
  const result = failure("unauthorized", 422);
  const { context, effects } = classificationHarness({
    loadBrowserPlayerMarker: () => "browser-player",
    loadPlayerState: async () => result,
    async startSession() { starts += 1; return { ok: true, sessionToken: "new", playerState: { stateVersion: 3 } }; }
  });
  const opened = await context.openBrowserSession();
  assert.equal(opened.ok, false);
  assert.equal(opened.error, "server_unavailable");
  assert.equal(starts, 0);
  assert.equal(context.uiState.sessionToken, "session");
  assert.equal(context.playerState, result.playerState);
  assert.deepEqual(effects, []);
});

test("開始・PIN・再開の全入口で422容量理由をLockScreenへ誤分類せず、実500は従来表示を保つ", async () => {
  for (const route of ["browser開始", "passcode開始", "PIN検証", "PIN後の状態取得"]) {
    for (const status of [422, 500]) {
      const result = failure("browser_progress_too_large", status);
      const { context } = classificationHarness({
        playerMode: route === "browser開始" ? "browser" : "server",
        deviceLockMethod: "fixed-pin",
        startSession: async () => result,
        verifyDevicePin: async () => route === "PIN検証" ? result : { ok: true },
        loadPlayerState: async () => result
      });
      const lock = lockHarness((code) => route === "browser開始" ? context.openBrowserSession()
        : route === "passcode開始" ? context.startPlayerPasscodeSession(code) : context.unlockDevice(code));
      await lock.submitCode("12345678");
      assert.equal(lock.errorMessage, status === 500 ? "進行データエラー（AP-PROGRESS-SIZE）" : "回線が不安定です", `${route}:${status}`);
      assert.equal(lock.busy, false);
      assert.equal(lock.digits, "");
      assert.equal(lock.pulse, false);
      assert.equal(context.uiState.sessionToken, "session");
      if (status === 422) assert.equal(context.globalErrorVisible, false, route);
    }
  }
});

test("開始失敗のinvalidとrate_limitedはLockScreenの既存文言を維持する", async () => {
  for (const unlockMethod of ["player-passcode", "fixed-pin"]) {
    for (const [error, status] of [["invalid", 403], ["rate_limited", 429]]) {
      const { context } = classificationHarness({ startSession: async () => failure(error, status, null) });
      const lock = lockHarness((code) => context.startPlayerPasscodeSession(code), unlockMethod);
      await lock.submitCode("12345678");
      assert.equal(lock.errorMessage, error === "rate_limited" ? "少し待ってから入力してください"
        : unlockMethod === "fixed-pin" ? "暗証番号を確認してください" : "パスコードを確認してください");
      assert.equal(context.globalErrorVisible, false);
    }
  }
});

test("browserの未保存を示すstatusなし認証失敗は新規開始へ進める", async () => {
  const requests = [];
  const { context, effects } = classificationHarness({
    loadBrowserPlayerMarker: () => "browser-player",
    async loadPlayerState() {
      requests.push("load");
      // 保存が空の場合の合成失敗そのものはplayer-api-browser-storageで検証する。
      return { ok: false, error: "unauthorized" };
    },
    async startSession(code) {
      requests.push(`start:${code}`);
      return { ok: true, sessionToken: "browser-player", playerState: { stateVersion: 2 } };
    }
  });
  const opened = await context.openBrowserSession();
  assert.equal(opened.ok, true);
  assert.deepEqual(requests, ["load", "start:"]);
  assert.equal(context.uiState.sessionToken, "browser-player");
  assert.equal(context.uiState.locked, false);
  assert.equal(context.playerState.stateVersion, 2);
  assert.ok(effects.includes("unlock_device"));
});
