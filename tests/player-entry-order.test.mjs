import assert from "node:assert/strict";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

function entryHarness() {
  const calls = [];
  const context = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), [
    "authenticatePlayerPasscode", "entryFailure", "entryError", "openBrowserSession", "unlockDevice"
  ], {
    deviceLockMethod: "fixed-pin", playerMode: "browser", localQaMode: false,
    pendingPlayerPasscode: "", accessCodeEntryError: "", uiState: { locked: true },
    verifyAccessCode: async () => ({ ok: false, error: "invalid_access_code", status: 400 }),
    verifyDevicePin: async () => ({ ok: true }), loadBrowserPlayerMarker: () => null,
    loadPlayerState: async () => assert.fail("開始前に進行を取得しない"),
    startSession: async code => { calls.push(code); return { ok: true, sessionToken: "browser", playerState: {} }; },
    isBrowserProgressSizeFailure: () => false, applyErrorPlayerState() {},
    applyStartedSession() {}, trackEvent() {},
    persist() { assert.fail("ロック済みなので書き込まない"); }
  });
  context.applyStartedSession = result => { context.uiState.sessionToken = result.sessionToken; };
  return { context, calls };
}

test("誤ったコードではPINへ進まず、正しいコードでもPIN前にプレイを開始しない", async () => {
  const { context, calls } = entryHarness();
  assert.equal((await context.authenticatePlayerPasscode("12345678")).ok, false);
  assert.equal(context.pendingPlayerPasscode, "");
  assert.deepEqual(calls, []);
  context.verifyAccessCode = async () => ({ ok: true });
  assert.equal((await context.authenticatePlayerPasscode("12345678")).ok, true);
  assert.equal(context.pendingPlayerPasscode, "12345678");
  assert.deepEqual(calls, []);
  assert.equal((await context.unlockDevice("0042")).ok, true);
  assert.deepEqual(calls, ["12345678"]);
  assert.equal(context.pendingPlayerPasscode, "");
});

test("PINの誤りはPINへ留め、事前確認後のコード無効化ではコード画面へ戻す", async () => {
  const { context } = entryHarness();
  context.pendingPlayerPasscode = "12345678";
  context.verifyDevicePin = async () => ({ ok: false, error: "invalid", status: 400 });
  assert.equal((await context.unlockDevice("9999")).ok, false);
  assert.equal(context.pendingPlayerPasscode, "12345678");
  context.verifyDevicePin = async () => ({ ok: true });
  context.startSession = async () => ({ ok: false, error: "access_code_disabled", status: 403 });
  assert.equal((await context.unlockDevice("0042")).ok, false);
  assert.equal(context.pendingPlayerPasscode, "");
  assert.equal(context.accessCodeEntryError, "access_code_disabled");
  context.pendingPlayerPasscode = "12345678";
  context.startSession = async () => ({ ok: false, error: "access_code_disabled", status: 422 });
  await context.unlockDevice("0042");
  assert.equal(context.pendingPlayerPasscode, "12345678", "hookの任意拒否理由とコードの認証失敗を混同しない");
});
