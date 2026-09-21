import assert from "node:assert/strict";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

const appUrl = new URL("../src/client/App.svelte", import.meta.url);

test("Stage解錠は状態と演出を共通適用し、拒否理由と遅着の破棄を保つ",async()=>{
  const states=[],presentations=[];
  let response={ok:true,state:"unlocked",playerState:{stateVersion:2},presentation:{effects:[]}};
  const context=componentFunctionHarness(appUrl,["requestContentUnlock","unlockProjectContent","applyErrorPlayerState","isUnauthorizedFailure","requiresPlayerEntry"],{
    uiState:{sessionToken:"session"},playerOperationGeneration:0,globalErrorVisible:false,
    async unlockContent(_session,id,password){assert.equal(id,"keypad");assert.equal(password,"0420");return response;},
    applyPlayerState(state){states.push(state);},enqueuePresentation(value){presentations.push(value);},
    showBrowserProgressSizeError(){},clearUnauthorizedPlayerUi(){assert.fail("正常拒否で認証を消さない");}
  });
  assert.equal((await context.unlockProjectContent("keypad","0420")).ok,true);
  assert.deepEqual(states,[response.playerState]);assert.deepEqual(presentations,[response.presentation]);
  for(const [status,error] of [[400,"invalid"],[409,"incoming_call_active"],[422,"unauthorized"]]){
    response={ok:false,status,error,playerState:{stateVersion:3}};
    assert.equal((await context.unlockProjectContent("keypad","0420")).error,error);
    assert.equal(states.at(-1).stateVersion,3);assert.equal(context.globalErrorVisible,false);
  }
  const count=states.length;
  context.unlockContent=async()=>{context.playerOperationGeneration++;return {ok:true,playerState:{stateVersion:4}};};
  assert.equal((await context.unlockProjectContent("keypad","0420")).ok,false);
  assert.equal(states.length,count);
});

function stageHarness(response) {
  const states = [];
  const errors = [];
  let attempts = 0;
  const context = componentFunctionHarness(appUrl, [
    "dispatchProjectScenarioEvent", "recordBackgroundScenarioEvent", "sendBackgroundScenarioEvent",
    "isUnauthorizedFailure", "requiresPlayerEntry", "PROGRESSION_RETRY_DELAYS_MS"
  ], {
    uiState: { sessionToken: "session", locked: false }, playerOperationGeneration: 0,
    backgroundScenarioEventQueue: Promise.resolve(), globalErrorVisible: false,
    async recordScenarioEvent() { attempts += 1; return typeof response === "function" ? response(attempts) : response; },
    applyPlayerState(state) { states.push(state); },
    // 正常拒否がこの経路を通ると、作者の理由が認証失効などと誤認される。
    applyErrorPlayerState(result) { errors.push(result.error); },
    enqueuePresentation() {}, waitMs: () => Promise.resolve()
  });
  context.showGlobalError = (_error, options) => {
    context.globalErrorVisible = true;
    errors.push(options.supportCode);
  };
  return { context, states, errors, get attempts() { return attempts; } };
}

test("Stageの着信中断とhook拒否はstateを適用し、元の理由を返す", async () => {
  for (const [status, error] of [
    [409, "incoming_call_active"], [422, "wrong_password"], [422, "conflict"],
    [422, "unauthorized"], [422, "invalid_response"], [422, "browser_progress_too_large"]
  ]) {
    const playerState = { stateVersion: 2 };
    const h = stageHarness({ ok: false, status, error, playerState, retryable: error === "invalid_response" });
    const result = await h.context.dispatchProjectScenarioEvent("test_action", { input: "test" });
    assert.equal(result.ok, false);
    assert.equal(result.error, error);
    assert.deepEqual(h.states, [playerState]);
    assert.deepEqual(h.errors, []);
    assert.equal(h.attempts, 1);
  }
});

test("正常拒否の後でもStageは同じsessionで再操作できる", async () => {
  for (const [status, error] of [[409, "incoming_call_active"], [422, "unauthorized"]]) {
    const h = stageHarness((attempt) => attempt === 1
      ? { ok: false, status, error, playerState: { stateVersion: 2 } }
      : { ok: true, playerState: { stateVersion: 3 } });
    assert.equal((await h.context.dispatchProjectScenarioEvent("test_action")).error, error);
    assert.equal(h.attempts, 1, "拒否後に自動再送はしない");
    assert.equal((await h.context.dispatchProjectScenarioEvent("test_action")).ok, true);
    assert.equal(h.attempts, 2);
    assert.deepEqual(h.states, [{ stateVersion: 2 }, { stateVersion: 3 }]);
    assert.deepEqual(h.errors, []);
  }
});

test("Stageの設定不備・不正422・再試行枯渇は明示エラーを維持する", async () => {
  for (const response of [
    { ok: false, status: 403, error: "event_not_callable" },
    { ok: false, status: 400, error: "invalid" },
    { ok: false, status: 422, error: "invalid_response", retryable: true },
    { ok: false, status: 503, error: "temporary", retryable: true }
  ]) {
    const h = stageHarness(response);
    const result = await h.context.dispatchProjectScenarioEvent("test_action");
    assert.equal(result.error, "event_unavailable");
    assert.equal(h.context.globalErrorVisible, true);
    assert.equal(h.errors.at(-1), "AP-EVENT");
    assert.equal(h.attempts, response.retryable ? 3 : 1);
  }
});

test("通常の競合は再試行し、コア到達通知の422を黙って捨てない", async () => {
  const h = stageHarness((attempt) => attempt === 1
    ? { ok: false, status: 409, error: "conflict", playerState: { stateVersion: 2 } }
    : { ok: true, playerState: { stateVersion: 3 } });
  assert.equal((await h.context.dispatchProjectScenarioEvent("test_action")).ok, true);
  assert.equal(h.attempts, 2);
  assert.deepEqual(h.errors, ["conflict"]);
  assert.deepEqual(h.states, [{ stateVersion: 3 }]);

  const core = stageHarness({ ok: false, status: 422, error: "denied", playerState: { stateVersion: 2 } });
  await core.context.recordBackgroundScenarioEvent("session", "audio_cue_reached", {});
  assert.equal(core.context.globalErrorVisible, true);
  assert.equal(core.errors.at(-1), "AP-EVENT");
});

test("実際の認証失効と世代変更はStageの正常拒否へ取り違えない", async () => {
  const auth = stageHarness({ ok: false, status: 401, error: "unauthorized" });
  assert.equal((await auth.context.dispatchProjectScenarioEvent("test_action")).error, "unauthorized");
  assert.deepEqual(auth.errors, ["unauthorized"]);

  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const h = stageHarness(() => pending);
  const dispatch = h.context.dispatchProjectScenarioEvent("test_action");
  await new Promise(setImmediate);
  h.context.playerOperationGeneration += 1;
  resolve({ ok: false, status: 422, error: "denied", playerState: { stateVersion: 2 } });
  assert.equal((await dispatch).error, "event_unavailable");
  assert.deepEqual(h.states, []);
});
