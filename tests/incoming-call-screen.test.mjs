import assert from "node:assert/strict";
import test from "node:test";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const screenUrl = new URL("../src/client/system/IncomingCallScreen.svelte", import.meta.url);
const call = { id: "call", name: "相手", audioUrl: "/call.wav", transcript: [] };

function incomingCall() {
  const events = [];
  const watches = [];
  let callRequest;
  const harness = componentScriptHarness(screenUrl, { call, onComplete(id) { events.push(`complete:${id}`); } }, {
    onMount() {},
    captionAt: () => "",
    async playAudio(request) {
      callRequest = request;
      return true;
    },
    stopAudioPlayback(reason, id) { events.push(`stop:${reason}:${id}`); },
    watchPlaybackStall(onStall) {
      const watch = {
        onStall, positions: [], stopped: false,
        progress(positionMs) { this.positions.push(positionMs); },
        stop() { this.stopped = true; }
      };
      watches.push(watch);
      return watch;
    }
  });
  return { harness, events, watches, request: () => callRequest };
}

test("通話の音声が止まったら再生を止めてリロードを案内し、完了は送らない", async () => {
  const c = incomingCall();
  await c.harness.evaluate("startCall()");
  assert.equal(c.watches.length, 1);
  c.request().onProgress({ currentMs: 1_200, durationMs: 5_000 });
  assert.deepEqual(c.watches[0].positions, [1_200]);
  c.watches[0].onStall();
  assert.ok(c.events.includes("stop:call_audio_stalled:incoming-call:call"));
  assert.equal(c.harness.evaluate("audioErrorVisible"), true);
  assert.equal(c.harness.evaluate("answered"), false);
  assert.equal(c.watches[0].stopped, true);
  assert.equal(c.events.some((event) => event.startsWith("complete:")), false);
});

test("通話の終了・音声エラー・画面の破棄で見張りを外す", async () => {
  for (const finish of ["onEnded", "onError", "destroy"]) {
    const c = incomingCall();
    await c.harness.evaluate("startCall()");
    if (finish === "destroy") c.harness.destroy();
    else c.request()[finish]();
    assert.equal(c.watches[0].stopped, true, finish);
  }
});
