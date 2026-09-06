import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/client/system/audioEngine.ts", import.meta.url), "utf8");

function audioHarness() {
  const howls = [];
  const frames = new Map();
  let serial = 0;
  let frameSerial = 0;
  class FakeHowl {
    constructor() {
      this.events = new Map();
      this.position = 0;
      this.stopCount = 0;
      howls.push(this);
    }
    state() { return "loaded"; }
    duration() { return 2; }
    once(name, callback) { return this.on(name, callback); }
    on(name, callback) {
      this.events.set(name, [...(this.events.get(name) ?? []), callback]);
      return this;
    }
    off(name, callback) {
      this.events.set(name, (this.events.get(name) ?? []).filter((entry) => entry !== callback));
      return this;
    }
    play() { return this.soundId = ++serial; }
    loop() {}
    playing() { return true; }
    seek() { return this.position; }
    stop() { this.stopCount += 1; }
    end() {
      this.position = 2;
      for (const callback of [...(this.events.get("end") ?? [])]) callback(this.soundId);
    }
  }
  const sandbox = {
    exports: {}, console,
    require(name) {
      assert.equal(name, "howler");
      return { Howl: FakeHowl, Howler: { ctx: null, noAudio: false, html5PoolSize: 10 } };
    },
    window: {
      setTimeout,
      requestAnimationFrame(callback) { frames.set(++frameSerial, callback); return frameSerial; },
      cancelAnimationFrame(id) { frames.delete(id); }
    },
    document: { hidden: true, addEventListener() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, sandbox);
  return {
    api: sandbox.exports, howls, frames,
    tick() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    }
  };
}

test("描画tickerが進まなくても音源末尾の到達cueを順番に通知してから完了する", async () => {
  const { api, howls, frames } = audioHarness();
  const events = [];
  await api.playAudio({
    id: "old", segments: [{ url: "/one.wav" }],
    cues: [{ index: 1, atMs: 1000 }, { index: 2, atMs: 2000 }, { index: 3, atMs: 2001 }],
    onCue(cue) { events.push(`cue${cue.index}`); }, onEnded() { events.push("完了"); }
  });
  howls[0].end();
  assert.deepEqual(events, ["cue1", "cue2", "完了"]);
  assert.equal(api.isAudioPlaybackActive(), false);
  assert.equal(frames.size, 0);
});

for (const when of ["ticker", "末尾"]) {
  for (const behavior of ["停止", "置換"]) {
    test(`${when}の最初のcueで${behavior}したら旧cue・完了・tickerを残さない`, async () => {
      const { api, howls, frames, tick } = audioHarness();
      const events = [];
      let replacement;
      await api.playAudio({
        id: "old", segments: [{ url: "/one.wav" }],
        cues: [{ index: 1, atMs: 1000 }, { index: 2, atMs: 1800 }],
        onCue(cue) {
          events.push(`cue${cue.index}`);
          if (cue.index !== 1) return;
          if (behavior === "停止") api.stopAudioPlayback();
          else replacement = api.playAudio({ id: "new", segments: [{ url: "/new.wav" }] });
        },
        onEnded() { events.push("完了"); }, onStop() { events.push("停止"); }
      });
      if (when === "ticker") {
        howls[0].position = 2;
        tick();
      } else howls[0].end();
      if (replacement) await replacement;
      howls[0].end();
      assert.deepEqual(events, ["cue1", "停止"]);
      assert.equal(api.isAudioPlaybackActive("new"), behavior === "置換");
      assert.equal(frames.size, behavior === "置換" ? 1 : 0);
      if (behavior === "置換") assert.equal(howls[1].stopCount, 0);
    });
  }
}

test("複数segmentの境界cueとticker通知済みcueは旧endの重複でも一度だけ届く", async () => {
  const { api, howls, tick } = audioHarness();
  const events = [];
  await api.playAudio({
    id: "multiple", segments: [{ url: "/one.wav" }, { url: "/two.wav" }],
    cues: [{ index: 1, atMs: 1000 }, { index: 2, atMs: 2000 }, { index: 3, atMs: 4000 }],
    onCue(cue) { events.push(`cue${cue.index}`); }, onEnded() { events.push("完了"); }
  });
  howls[0].position = 1;
  tick();
  assert.deepEqual(events, ["cue1"]);
  const staleEnd = [...howls[0].events.get("end")];
  howls[0].end();
  staleEnd.forEach((callback) => callback(howls[0].soundId));
  assert.deepEqual(events, ["cue1", "cue2"]);
  howls[1].end();
  assert.deepEqual(events, ["cue1", "cue2", "cue3", "完了"]);
});

test("最後のcueで新再生を始めても旧完了は新再生を停止しない", async () => {
  const { api, howls } = audioHarness();
  let replacement;
  let ended = false;
  await api.playAudio({
    id: "old", segments: [{ url: "/one.wav" }], cues: [{ index: 1, atMs: 2000 }],
    onCue() { replacement = api.playAudio({ id: "new", segments: [{ url: "/new.wav" }] }); },
    onEnded() { ended = true; }
  });
  howls[0].end();
  await replacement;
  assert.equal(ended, false);
  assert.equal(api.isAudioPlaybackActive("new"), true);
});
