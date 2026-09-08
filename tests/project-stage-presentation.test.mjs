import assert from "node:assert/strict";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

const turn = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function presentationHarness(playPresentationEffect) {
  return componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["enqueuePresentation", "cancelPresentations"], {
    presentationGeneration: 0, presentationQueue: Promise.resolve(),
    presentationSequenceResolve: null, pendingPresentationSequenceCount: 0, pendingPresentationCount: 0,
    outOfGameVisible: false, activeIncomingCall: null,
    playPresentationEffect, showGameOver() {}, showAllClear() {}, showGlobalError() {},
    clearTransientPresentationEffects() {}, window: { clearTimeout() {} },
    gameOverOverlayTimer: undefined, allClearOverlayTimer: undefined,
    temporaryTalkMessages: [], gameOverVisible: false, gameOverReturning: false, gameOverTalk: null,
    gameOverReasonMessage: "", allClearVisible: false, allClearReturning: false, allClearTarget: null, allClearAutoplay: false
  });
}

test("Stageへ単発演出の開始待ちと直列再生中を連続して占有中と伝える", async () => {
  const first = deferred();
  const second = deferred();
  const h = presentationHarness((effect) => effect.id === "first" ? first.promise : second.promise);
  h.enqueuePresentation(undefined);
  h.enqueuePresentation({ effects: [] });
  assert.equal(h.pendingPresentationCount, 0);
  h.enqueuePresentation({ effects: [{ id: "first" }] });
  assert.equal(h.pendingPresentationCount, 1, "再生開始のmicrotaskより前から占有する");
  h.enqueuePresentation({ effects: [{ id: "second" }] });
  assert.equal(h.pendingPresentationCount, 2);
  await turn();
  first.resolve();
  await turn();
  assert.equal(h.pendingPresentationCount, 1, "次の演出へ切り替わる間もhomeにならない");
  second.resolve();
  await h.presentationQueue;
  assert.equal(h.pendingPresentationCount, 0);
});

test("演出cancel後の古い完了は新しい待機件数を減らさない", async () => {
  const old = deferred();
  const fresh = deferred();
  const h = presentationHarness((effect) => effect.id === "old" ? old.promise : fresh.promise);
  h.enqueuePresentation({ effects: [{ id: "old" }] });
  const oldQueue = h.presentationQueue;
  await turn();
  h.cancelPresentations();
  assert.equal(h.pendingPresentationCount, 0);
  h.enqueuePresentation({ effects: [{ id: "new" }] });
  old.resolve();
  await oldQueue;
  assert.equal(h.pendingPresentationCount, 1);
  fresh.resolve();
  await h.presentationQueue;
  assert.equal(h.pendingPresentationCount, 0);
});

test("終了演出の表示待ちと失敗時の画面切替まで占有を維持する", async () => {
  const h = presentationHarness(async () => {});
  h.enqueuePresentation({ effects: [], sequence: { type: "game_over" } });
  await turn();
  assert.equal(h.pendingPresentationCount, 1);
  assert.equal(h.pendingPresentationSequenceCount, 1);
  h.presentationSequenceResolve();
  await h.presentationQueue;
  assert.equal(h.pendingPresentationCount, 0);

  let countAtError = 0;
  h.playPresentationEffect = async () => { throw new Error("再生失敗"); };
  h.showGlobalError = () => { countAtError = h.pendingPresentationCount; };
  h.enqueuePresentation({ effects: [{}] });
  await h.presentationQueue;
  assert.equal(countAtError, 1);
  assert.equal(h.pendingPresentationCount, 0);
});
