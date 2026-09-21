import assert from "node:assert/strict";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

const appUrl = new URL("../src/client/App.svelte", import.meta.url);
const reservedReasons = ["unauthorized", "browser_progress_too_large", "conflict", "llm_unavailable", "invalid_response"];

function failureHarness(names, response) {
  const states = [];
  const globalErrors = [];
  const presentations = [];
  const pendingSends = [];
  const focused = [];
  let attempts = 0;
  let cleared = 0;
  let homeFallbacks = 0;
  const request = async () => {
    attempts += 1;
    return typeof response === "function" ? response(attempts) : response;
  };
  const context = componentFunctionHarness(appUrl, [
    "applyErrorPlayerState", "showBrowserProgressSizeError", "isUnauthorizedFailure", "requiresPlayerEntry", "isBrowserProgressSizeFailure",
    ...names
  ], {
    uiState: { sessionToken: "session", locked: false }, playerState: { stateVersion: 1 },
    playerOperationGeneration: 0, globalErrorVisible: false, qaMode: false,
    backgroundScenarioEventQueue: Promise.resolve(),
    phoneHistoryNavigationId: 1, inFlightContentOpenKeys: [], suppressedContentOpenKeys: [],
    searchAgentTalkView: { talkId: "search", canPost: true, label: "検索AI", messages: [] },
    currentCanPost: () => true, currentTurnKey: () => "turn", recentMessagesForTalk: () => [],
    pendingTalkReadCursorPayload: () => [], clearSyncedTalkReadCursors() {},
    startPendingTalkSend(...args) { pendingSends.push(["開始", ...args]); },
    finishPendingTalkSend(...args) { pendingSends.push(["終了", ...args]); },
    sendTalkMessage: request, submitRadioForm: request, recordScenarioEvent: request, recordContentOpened: request,
    rememberAppContent() {}, syncPhoneHistoryContent() {}, queueAlbumMediaAddedAssistant() {},
    waitMs: () => Promise.resolve(),
    enqueuePresentation(...args) { presentations.push(args); },
    focusOpenedContent(...args) { focused.push(args); },
    fallbackPhoneHistoryToHome() { homeFallbacks += 1; }
  });
  // 認証・容量・失敗状態の分類は実関数を使い、破棄や画面描画の境界だけを観測する。
  context.applyPlayerState = (state) => {
    states.push(state);
    context.playerState = state;
    return true;
  };
  context.clearUnauthorizedPlayerUi = () => {
    cleared += 1;
    context.uiState.sessionToken = undefined;
  };
  context.showGlobalError = (reason, options) => {
    globalErrors.push({ reason, supportCode: options.supportCode });
    context.globalErrorVisible = true;
  };
  return {
    context, states, globalErrors, presentations, pendingSends, focused,
    get attempts() { return attempts; }, get cleared() { return cleared; }, get homeFallbacks() { return homeFallbacks; }
  };
}

const sendOperations = [
  { label: "SMS", names: ["handleTalkSend"], run: (context) => context.handleTalkSend("sms", "talk", "本文", "送信不可") },
  { label: "chat", names: ["handleTalkSend"], run: (context) => context.handleTalkSend("chat", "talk", "本文", "送信不可") },
  { label: "検索", names: ["handleSearchAgentSend"], run: (context) => context.handleSearchAgentSend("本文") },
  { label: "ラジオ投稿", names: ["handleSubmitRadioForm", "radioFormSubmitErrorMessage"], run: (context) => context.handleSubmitRadioForm("form", { body: "本文" }) }
];

for (const operation of sendOperations) {
  test(`${operation.label}の422予約語拒否は状態を反映し、認証解除・全画面エラー・再送をしない`, async () => {
    for (const error of ["wrong_password", ...reservedReasons]) {
      const playerState = { stateVersion: 2 };
      const h = failureHarness(operation.names, { ok: false, status: 422, error, playerState });
      const result = await operation.run(h.context);
      assert.equal(result.ok, false);
      assert.equal(result.error, operation.label === "ラジオ投稿" ? error : "送信に失敗しました。");
      assert.deepEqual(h.states, [playerState]);
      assert.equal(h.attempts, 1);
      assert.equal(h.cleared, 0);
      assert.equal(h.context.uiState.sessionToken, "session");
      assert.deepEqual(h.globalErrors, []);
      assert.deepEqual(h.presentations, []);
      if (operation.label === "SMS" || operation.label === "chat") {
        assert.deepEqual(h.pendingSends.map(([phase]) => phase), ["開始", "終了"]);
      }
    }
  });

  test(`${operation.label}の実503 LLM障害は既存の表示先を維持する`, async () => {
    const h = failureHarness(operation.names, { ok: false, status: 503, error: "llm_unavailable", retryable: true });
    const result = await operation.run(h.context);
    assert.equal(result.ok, false);
    assert.equal(h.attempts, 1, "送信処理に新しい再試行は追加しない");
    assert.equal(h.cleared, 0);
    assert.deepEqual(h.globalErrors, operation.label === "ラジオ投稿"
      ? [] : [{ reason: "llm_unavailable", supportCode: "AP-LLM" }]);
    if (operation.label === "ラジオ投稿") {
      assert.equal(result.error, "llm_unavailable");
      assert.equal(result.message, "投稿の送信に失敗しました。");
    }
  });
}

const backgroundNames = ["recordBackgroundScenarioEvent", "sendBackgroundScenarioEvent", "PROGRESSION_RETRY_DELAYS_MS"];
const contentNames = ["handleContentOpen", "contentOpenKey", "PROGRESSION_RETRY_DELAYS_MS"];

test("コア到達通知の422予約語拒否は一度でAP-EVENTを出し、無言終了も再送もしない", async () => {
  for (const error of ["wrong_password", ...reservedReasons]) {
    const playerState = { stateVersion: 2 };
    const h = failureHarness(backgroundNames, { ok: false, status: 422, error, playerState });
    const result = await h.context.recordBackgroundScenarioEvent("session", "audio_cue_reached", {});
    assert.equal(result.error, error);
    assert.equal(h.attempts, 1);
    assert.deepEqual(h.states, [playerState]);
    assert.equal(h.cleared, 0);
    assert.deepEqual(h.globalErrors, [{ reason: error, supportCode: "AP-EVENT" }]);
  }
});

test("content開封の422予約語拒否は一度でfalseを返し、履歴開封は通常のホーム復帰になる", async () => {
  for (const historyRestore of [false, true]) {
    for (const error of ["wrong_password", ...reservedReasons]) {
      const playerState = { stateVersion: 2 };
      const names = historyRestore
        ? [...contentNames, "openPhoneHistoryContent", "restorePhoneHistoryRoute"] : contentNames;
      const h = failureHarness(names, { ok: false, status: 422, error, playerState });
      if (historyRestore) {
        await h.context.restorePhoneHistoryRoute({ kind: "app", appId: "notes", contentId: "note" }, 1);
      } else {
        assert.equal(await h.context.handleContentOpen("notes", "note"), false);
      }
      assert.equal(h.attempts, 1);
      assert.deepEqual(h.states, [playerState], "復帰しても受理済みの状態を取り消さない");
      assert.equal(h.cleared, 0);
      assert.equal(h.context.uiState.sessionToken, "session");
      assert.equal(h.context.inFlightContentOpenKeys.length, 0);
      assert.equal(h.homeFallbacks, historyRestore ? 1 : 0);
      assert.deepEqual(h.focused, []);
      assert.deepEqual(h.globalErrors, []);
    }
  }
});

const retryOperations = [
  { label: "背景通知", names: backgroundNames, supportCode: "AP-EVENT", run: (context) => context.recordBackgroundScenarioEvent("session", "audio_cue_reached", {}) },
  { label: "content開封", names: contentNames, supportCode: "AP-STATE", run: (context) => context.handleContentOpen("notes", "note") },
  { label: "履歴開封", names: [...contentNames, "openPhoneHistoryContent", "restorePhoneHistoryRoute"], supportCode: "AP-STATE", run: (context) => context.restorePhoneHistoryRoute({ kind: "app", appId: "notes", contentId: "note" }, 1) }
];

for (const operation of retryOperations) {
  test(`${operation.label}の実409競合・503障害・解析不正は既存の三回上限で停止する`, async () => {
    for (const response of [
      { ok: false, status: 409, error: "conflict" },
      { ok: false, status: 503, error: "llm_unavailable", retryable: true },
      { ok: false, status: 422, error: "invalid_response", retryable: true },
      { ok: false, status: 422, error: "conflict", retryable: true }
    ]) {
      const h = failureHarness(operation.names, response);
      await operation.run(h.context);
      assert.equal(h.attempts, 3, "HTTP分類とは別に明示的なretryableも維持する");
      assert.equal(h.cleared, 0);
      assert.equal(h.globalErrors.length, 1);
      assert.equal(h.globalErrors[0].supportCode, operation.supportCode);
      assert.equal(h.homeFallbacks, 0, "再試行枯渇の全画面エラーをホーム復帰で隠さない");
    }
  });

  test(`${operation.label}は競合以外の409とstatusなしconflictを再送しない`, async () => {
    for (const response of [
      { ok: false, status: 409, error: "incoming_call_active" },
      { ok: false, status: 409, error: "not_available" },
      { ok: false, error: "conflict" }
    ]) {
      const h = failureHarness(operation.names, response);
      await operation.run(h.context);
      assert.equal(h.attempts, 1);
      assert.equal(h.globalErrors.length, operation.label === "背景通知" ? 1 : 0);
    }
  });

  test(`${operation.label}は実409競合の次の成功状態を一度だけ反映できる`, async () => {
    const playerState = { stateVersion: 3 };
    const h = failureHarness(operation.names, (attempt) => attempt === 1
      ? { ok: false, status: 409, error: "conflict", playerState: { stateVersion: 2 } }
      : { ok: true, playerState });
    const result = await operation.run(h.context);
    assert.equal(h.attempts, 2);
    assert.equal(h.states.filter((state) => state === playerState).length, operation.label === "背景通知" ? 0 : 1,
      "背景通知の成功状態は呼出元が適用し、content開封は自身で適用する");
    assert.deepEqual(h.globalErrors, []);
    assert.equal(h.homeFallbacks, 0);
    if (operation.label === "背景通知") assert.equal(result.playerState, playerState);
    if (operation.label === "履歴開封") assert.deepEqual(h.focused, [["notes", "note", false]]);
  });
}
