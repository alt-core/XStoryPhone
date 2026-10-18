import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const howlerSource = readFileSync(require.resolve("howler"), "utf8");
const engineSource = readFileSync(new URL("../src/client/system/audioEngine.ts", import.meta.url), "utf8");
const engineScript = ts.transpileModule(engineSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

async function flushMicrotasks() {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function audioHarness(t) {
  const timers = new Map();
  const frames = new Map();
  let timerSerial = 0;
  let frameSerial = 0;
  const schedule = (callback, delay = 0) => {
    timers.set(++timerSerial, { callback, delay });
    return timerSerial;
  };

  // 通信するAudio要素だけを置換し、Howlerのlock・queue・ID再利用は実装そのものを実行する。
  class ControlledAudio {
    constructor() {
      this.events = new Map();
      Object.assign(this, {
        paused: true, ended: false, muted: false, readyState: 0, oncanplaythrough: null,
        duration: 20, currentTime: 0, volume: 1, playbackRate: 1, playCount: 0
      });
    }
    canPlayType() { return "probably"; }
    addEventListener(name, callback) {
      this.events.set(name, [...(this.events.get(name) ?? []), callback]);
    }
    removeEventListener(name, callback) {
      this.events.set(name, (this.events.get(name) ?? []).filter((entry) => entry !== callback));
    }
    ready() {
      this.readyState = 4;
      for (const callback of [...(this.events.get("canplaythrough") ?? [])]) callback();
    }
    load() { schedule(() => this.ready()); }
    play() {
      this.playCount += 1;
      this.paused = false;
      this.ended = false;
      if (!this.src) return Promise.resolve();
      return new Promise((resolve, reject) => {
        this.resolvePlay = resolve;
        this.rejectPlay = () => {
          this.paused = true;
          reject(new Error("テスト用の再生拒否"));
        };
      });
    }
    pause() { this.paused = true; }
  }

  const howlerBox = {
    Audio: ControlledAudio, Promise, console, setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
    navigator: { userAgent: "Chrome", platform: "test", appVersion: "" },
    location: { protocol: "http:" }, document: { addEventListener() {}, removeEventListener() {} }
  };
  howlerBox.window = howlerBox;
  vm.createContext(howlerBox);
  vm.runInContext(howlerSource, howlerBox);
  const { Howl, Howler } = howlerBox;
  const engineBox = {
    exports: {}, console,
    require(name) {
      if (name === "howler") return { Howl, Howler };
      assert.equal(name, "./resourceUrls.ts");
      return { resourceUrl: (url) => url };
    },
    window: {
      setTimeout: schedule,
      requestAnimationFrame(callback) { frames.set(++frameSerial, callback); return frameSerial; },
      cancelAnimationFrame(id) { frames.delete(id); }
    },
    document: { hidden: true, addEventListener() {} }
  };
  vm.createContext(engineBox);
  vm.runInContext(engineScript, engineBox);

  // 0ms通知だけを進める。音源末尾の長いタイマーや実時間には依存しない。
  async function flush() {
    for (let turn = 0; turn < 24; turn += 1) {
      await flushMicrotasks();
      const pending = [...timers].filter(([, entry]) => entry.delay === 0);
      for (const [id, entry] of pending) {
        if (!timers.delete(id)) continue;
        entry.callback();
        await flushMicrotasks();
      }
    }
    assert.equal([...timers.values()].some((entry) => entry.delay === 0), false, "0ms通知が収束する");
  }

  const api = engineBox.exports;
  t.after(() => {
    api.stopAudioPlayback();
    Howler.unload();
    timers.clear();
    frames.clear();
  });
  return {
    api, Howler, frames, flush,
    timerIds(delay) {
      return [...timers].filter(([, entry]) => entry.delay === delay).map(([id]) => id);
    },
    fireTimer(id) {
      const entry = timers.get(id);
      assert.ok(entry, "発火対象のタイマーが残っている");
      timers.delete(id);
      entry.callback();
    },
    async play(request) {
      const result = api.playAudio(request);
      await flush();
      assert.equal(await result, true);
    }
  };
}

const request = (id, url = "/voice.wav") => ({ id, segments: [{ url }], loop: true });
const listeners = (howl) => ({
  play: howl._onplay.length, playerror: howl._onplayerror.length, stop: howl._onstop.length
});
const queueEvents = (howl) => Array.from(howl._queue, (entry) => entry.event);

function assertStopped(howl, sound) {
  assert.equal(howl.playing(sound._id), false, "Howler上も旧IDが停止する");
  assert.equal(sound._node.paused, true, "Audio要素も停止する");
  assert.deepEqual(queueEvents(howl), [], "停止待ちqueueを残さない");
  assert.deepEqual(listeners(howl), { play: 0, playerror: 0, stop: 0 }, "停止用の監視を解放する");
}

function startNextLoop(howl, sound, readyState = 4) {
  sound._node.readyState = readyState;
  sound._node.currentTime = sound._node.duration;
  sound._node.ended = true;
  // HTML5 Audioのループ末尾タイマーが実際に呼ぶHowlerの処理を進める。
  howl._ended(sound);
}

test("実Howler: 通常停止はstop一回で完了し、追加通知や購読を残さない", async (t) => {
  const h = audioHarness(t);
  const events = [];
  await h.play({ ...request("通常再生"), onStop(reason) { events.push(reason); } });
  const howl = h.Howler._howls[0];
  const sound = howl._sounds[0];
  sound._node.resolvePlay();
  await h.flush();
  const originalStop = howl.stop;
  const stoppedIds = [];
  howl.stop = function(id, ...rest) {
    stoppedIds.push(id);
    return originalStop.call(this, id, ...rest);
  };
  h.api.stopAudioPlayback();
  await h.flush();
  assert.deepEqual(stoppedIds, [sound._id]);
  assertStopped(howl, sound);
  assert.deepEqual(events, ["stop"]);
  assert.equal(h.frames.size, 0);
});

for (const condition of ["初回play Promise待ち", "ループplay Promise待ち", "ループcanplaythrough待ち"]) {
  test(`実Howler: ${condition}で停止しても遅れた再生が残らない`, async (t) => {
    const h = audioHarness(t);
    const events = [];
    await h.play({ ...request("旧音声"), onStop(reason) { events.push(reason); } });
    const howl = h.Howler._howls[0];
    const sound = howl._sounds[0];
    if (condition !== "初回play Promise待ち") {
      sound._node.resolvePlay();
      await h.flush();
      startNextLoop(howl, sound, condition === "ループcanplaythrough待ち" ? 2 : 4);
    }
    assert.equal(howl._playLock, true);
    if (condition === "ループcanplaythrough待ち") {
      assert.equal(howl.playing(sound._id), false, "playing=falseでも再生準備は残る");
    }
    h.api.stopAudioPlayback();
    assert.equal(h.api.isAudioPlaybackActive(), false);
    if (condition === "ループcanplaythrough待ち") sound._node.ready();
    sound._node.resolvePlay();
    await h.flush();
    assertStopped(howl, sound);
    assert.deepEqual(events, ["stop"]);
    assert.equal(h.frames.size, 0);
  });
}

test("実Howler: 停止後のplayerrorを解放し、同じURLの新再生を止めない", async (t) => {
  const h = audioHarness(t);
  await h.play(request("旧音声", "/reject.wav"));
  const howl = h.Howler._howls[0];
  const sound = howl._sounds[0];
  const oldId = sound._id;
  h.api.stopAudioPlayback();
  sound._node.rejectPlay();
  await h.flush();
  assertStopped(howl, sound);
  const notifications = [];
  await h.play({
    ...request("新音声", "/reject.wav"), cues: [{ index: 1, atMs: 1 }],
    onCue() { notifications.push("cue"); }, onEnded() { notifications.push("end"); },
    onStop() { notifications.push("stop"); }, onError() { notifications.push("error"); }
  });
  assert.equal(h.Howler._howls.length, 1, "同じHowlキャッシュを再利用する");
  const current = howl._sounds[0];
  assert.equal(current, sound, "同じAudio要素を再利用する");
  assert.notEqual(current._id, oldId);
  current._node.resolvePlay();
  await h.flush();
  assert.equal(howl.playing(current._id), true);
  assert.equal(current._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("新音声"), true);
  assert.deepEqual(notifications, []);
  assert.deepEqual(listeners(howl), { play: 1, playerror: 1, stop: 0 });
});

test("実Howler: playerror通知前に旧Soundが再採番されても監視を残さず新IDを止めない", async (t) => {
  const h = audioHarness(t);
  await h.play(request("旧音声", "/reused.wav"));
  const howl = h.Howler._howls[0];
  const sound = howl._sounds[0];
  const oldId = sound._id;
  h.api.stopAudioPlayback();
  sound._node.rejectPlay();
  await flushMicrotasks();
  assert.equal(sound._ended, true);
  // Howlerのplayerror通知タイマーが発火する前に、同じSoundを新IDで再利用する。
  const next = h.api.playAudio(request("新音声", "/reused.wav"));
  await flushMicrotasks();
  assert.equal(await next, true);
  assert.notEqual(sound._id, oldId);
  await h.flush();
  sound._node.resolvePlay();
  await h.flush();
  assert.equal(howl.playing(sound._id), true);
  assert.equal(sound._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("新音声"), true);
  assert.deepEqual(listeners(howl), { play: 1, playerror: 1, stop: 0 });
});

test("実Howler: 旧ループ末尾の遅延処理が再利用Soundを停止後に再開しない", async (t) => {
  const h = audioHarness(t);
  await h.play(request("旧音声", "/late-loop.wav"));
  const howl = h.Howler._howls[0];
  const sound = howl._sounds[0];
  const oldId = sound._id;
  sound._node.resolvePlay();
  await h.flush();
  startNextLoop(howl, sound);
  const oldTimerId = howl._endTimers[oldId];
  assert.ok(h.timerIds(20000).includes(oldTimerId));
  h.api.stopAudioPlayback();
  sound._node.rejectPlay();
  await flushMicrotasks();

  const notifications = [];
  const next = h.api.playAudio({
    ...request("新音声", "/late-loop.wav"),
    onEnded() { notifications.push("end"); }, onStop() { notifications.push("stop"); }
  });
  await flushMicrotasks();
  assert.equal(await next, true);
  assert.equal(howl._sounds[0], sound);
  assert.notEqual(sound._id, oldId);
  await h.flush();
  sound._node.resolvePlay();
  await h.flush();
  assert.equal(howl.loop(sound._id), true, "新IDのループ設定は通常どおり有効になる");

  // 再採番前の末尾タイマーは、新しい再生位置を見てHowler内に再確認を予約する。
  h.fireTimer(oldTimerId);
  const delayed = h.timerIds(100);
  assert.equal(delayed.length, 1, "Howlerの末尾再確認が残っている");
  const playCount = sound._node.playCount;
  h.api.stopAudioPlayback();
  await h.flush();
  assert.equal(howl.playing(sound._id), false);
  assert.equal(sound._node.paused, true);
  assert.deepEqual(notifications, ["stop"]);

  // stopでは追跡されない旧再確認が届いても、ネイティブplayを再実行させない。
  h.fireTimer(delayed[0]);
  await h.flush();
  assert.equal(howl.playing(sound._id), false);
  assert.equal(sound._node.paused, true);
  assert.equal(sound._node.playCount, playCount);
  assert.equal(h.api.isAudioPlaybackActive(), false);
  assert.deepEqual(notifications, ["stop"]);
});

test("実Howler: 同一Howlの別IDがlockを取っても旧IDだけ停止し、新音声へ誤通知しない", async (t) => {
  const h = audioHarness(t);
  await h.play(request("準備A", "/shared.wav"));
  const howl = h.Howler._howls[0];
  const spare = howl._sounds[0];
  await h.play(request("旧音声B", "/shared.wav"));
  const old = howl._sounds.find((entry) => entry !== spare);
  spare._node.resolvePlay();
  await h.flush();
  old._node.resolvePlay();
  await h.flush();
  assert.equal(spare._ended, true);
  startNextLoop(howl, old);
  const oldId = old._id;
  h.api.stopAudioPlayback();
  old._node.resolvePlay();
  await flushMicrotasks();

  const notifications = [];
  const next = h.api.playAudio({
    ...request("新音声C", "/shared.wav"), cues: [{ index: 1, atMs: 1 }],
    onCue() { notifications.push("cue"); }, onEnded() { notifications.push("end"); },
    onStop() { notifications.push("stop"); }
  });
  await flushMicrotasks();
  assert.equal(await next, true);
  const current = howl._sounds.find((entry) => entry._id !== oldId && !entry._ended);
  assert.equal(current, spare);
  assert.equal(howl._playLock, true, "旧play通知前に別IDがHowl共通lockを取得する");
  await h.flush();
  current._node.resolvePlay();
  await h.flush();
  assert.equal(howl.playing(oldId), false);
  assert.equal(old._node.paused, true);
  assert.equal(howl.playing(current._id), true);
  assert.equal(current._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("新音声C"), true);
  assert.deepEqual(notifications, []);
  assert.deepEqual(queueEvents(howl), []);
  assert.deepEqual(listeners(howl), { play: 1, playerror: 1, stop: 0 });
});

test("実Howler: ラジオの第2segment開始待ちを停止し、同じキャッシュで再開できる", async (t) => {
  const h = audioHarness(t);
  const notifications = [];
  const radio = {
    segments: [{ url: "/radio-first.wav" }, { url: "/radio-second.wav" }],
    cues: [{ index: 1, atMs: 20000 }, { index: 2, atMs: 40000 }],
    onCue(cue) { notifications.push(`cue${cue.index}`); }, onEnded() { notifications.push("end"); },
    onStop() { notifications.push("stop"); }
  };
  await h.play({ ...radio, id: "ラジオ旧再生" });
  const first = h.Howler._howls[0];
  const second = h.Howler._howls[1];
  const firstSound = first._sounds[0];
  firstSound._node.resolvePlay();
  await h.flush();
  firstSound._node.currentTime = firstSound._node.duration;
  firstSound._node.ended = true;
  first._ended(firstSound);
  await h.flush();
  const secondSound = second._sounds[0];
  assert.equal(second._playLock, true);
  assert.deepEqual(notifications, ["cue1"]);
  h.api.stopAudioPlayback();
  secondSound._node.resolvePlay();
  await h.flush();
  assertStopped(second, secondSound);
  assert.deepEqual(notifications, ["cue1", "stop"]);
  notifications.length = 0;
  await h.play({ ...radio, id: "ラジオ再開" });
  assert.equal(h.Howler._howls.length, 2);
  const restarted = first._sounds[0];
  restarted._node.resolvePlay();
  await h.flush();
  assert.equal(first.playing(restarted._id), true);
  assert.equal(restarted._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("ラジオ再開"), true);
  assert.deepEqual(notifications, []);
});
