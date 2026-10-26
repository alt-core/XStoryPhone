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

function emitNetworkError(node) {
  node.error = { code: 2 };
  for (const callback of [...(node.events.get("error") ?? [])]) callback();
}

function assertRetained(h, howl, sound, node) {
  // 失敗印とcache除外だけを行い、Howlerの全保持対象やAudio poolからの回収は保証しない。
  assert.equal(h.Howler._howls.includes(howl), true);
  assert.notEqual(howl.state(), "unloaded");
  assert.equal(sound._node, node);
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

test("実Howler: 共通lockが先に解除されてもcanplaythrough待ちの旧音源は遅れて停止する", async (t) => {
  const h = audioHarness(t);
  await h.play(request("旧音声A", "/shared-error.wav"));
  const howl = h.Howler._howls[0];
  const first = howl._sounds[0];
  const firstNode = first._node;
  const events = [];
  await h.play({ ...request("旧音声B", "/shared-error.wav"), onError() { events.push("エラー"); } });
  const second = howl._sounds.find((sound) => sound !== first);
  assert.ok(second);
  const secondNode = second._node;
  secondNode.resolvePlay();
  await h.flush();
  startNextLoop(howl, second, 2);
  assert.equal(howl._playLock, true);
  firstNode.resolvePlay();
  await h.flush();
  assert.equal(howl._playLock, false, "旧AのPromiseだけがHowl共通lockを解除する");
  assert.equal(howl.state(), "loading", "Bのcanplaythrough待ちは解除されない");

  emitNetworkError(secondNode);
  await h.flush();
  assert.deepEqual(events, ["エラー"]);
  assert.equal(h.api.isAudioPlaybackActive(), false);
  assertRetained(h, howl, first, firstNode);
  assertRetained(h, howl, second, secondNode);

  await h.play({
    ...request("再試行", "/shared-error.wav"),
    onStop() { events.push("新停止"); }, onError() { events.push("新エラー"); }
  });
  const current = h.Howler._howls.find((entry) => entry !== howl);
  assert.ok(current, "失敗したHowlを再使用しない");
  const currentSound = current._sounds[0];
  currentSound._node.resolvePlay();
  await h.flush();
  firstNode.resolvePlay();
  secondNode.ready();
  secondNode.resolvePlay();
  await h.flush();
  assertStopped(howl, first);
  assertStopped(howl, second);
  assert.equal(h.Howler._howls.length, 2, "失敗Howlは保持されるが、新再生には使用しない");
  assert.equal(current.playing(currentSound._id), true);
  assert.equal(currentSound._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("再試行"), true);
  assert.deepEqual(events, ["エラー"]);
});

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

test("実Howler: 初期metadataの取得失敗は一度だけ通知し、次の再試行は別Howlを使う", async (t) => {
  const h = audioHarness(t);
  const events = [];
  const pending = h.api.playAudio({
    id: "初期読み込み", segments: [{ url: "/initial-error.wav" }],
    onEnded() { events.push("完了"); }, onStop() { events.push("停止"); }, onError() { events.push("エラー"); }
  });
  await flushMicrotasks();
  const old = h.Howler._howls[0];
  const sound = old._sounds[0];
  const node = sound._node;
  assert.equal(old.state(), "loading");
  // metadataの準備完了を保留し、先にエラーの通知を配信する。
  const loadTimers = new Set(h.timerIds(0));
  emitNetworkError(node);
  for (const id of h.timerIds(0).filter((id) => !loadTimers.has(id))) h.fireTimer(id);
  await flushMicrotasks();
  assert.equal(await pending, false);
  assert.equal(h.api.isAudioPlaybackActive(), false);
  assert.deepEqual(events, ["エラー"]);
  assertRetained(h, old, sound, node);
  await h.play({ id: "再試行", segments: [{ url: "/initial-error.wav" }], onError() { events.push("新エラー"); } });
  const current = h.Howler._howls.find((entry) => entry !== old);
  assert.ok(current);
  current._sounds[0]._node.resolvePlay();
  await h.flush();
  emitNetworkError(node);
  await h.flush();
  assert.equal(h.Howler._howls.length, 2);
  assert.equal(current._sounds[0]._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("再試行"), true);
  assert.deepEqual(events, ["エラー"]);
});

test("実Howler: load通知の配信待ちにerrorも届いても、一度通知して新しいHowlで再試行できる", async (t) => {
  const h = audioHarness(t);
  const events = [];
  const pending = h.api.playAudio({
    id: "境界の音声", segments: [{ url: "/load-error-boundary.wav" }],
    onEnded() { events.push("完了"); }, onStop() { events.push("停止"); }, onError() { events.push("エラー"); }
  });
  const old = h.Howler._howls[0];
  const sound = old._sounds[0];
  const node = sound._node;
  // canplaythroughだけを進め、Howlerのload callbackが未配信のうちにerrorも通知する。
  h.fireTimer(h.timerIds(0)[0]);
  assert.equal(old.state(), "loaded");
  emitNetworkError(node);
  await h.flush();
  await pending;
  assert.equal(h.api.isAudioPlaybackActive(), false);
  assert.deepEqual(events, ["エラー"]);
  assertRetained(h, old, sound, node);
  await h.play({ id: "再試行", segments: [{ url: "/load-error-boundary.wav" }], onError() { events.push("新エラー"); } });
  const current = h.Howler._howls.find((entry) => entry !== old);
  assert.ok(current);
  current._sounds[0]._node.resolvePlay();
  node.resolvePlay?.();
  await h.flush();
  assertStopped(old, sound);
  assert.equal(h.api.isAudioPlaybackActive("再試行"), true);
  assert.equal(current._sounds[0]._node.paused, false);
  assert.deepEqual(events, ["エラー"]);
});

test("実Howler: 再生中の通信エラーを一度だけ知らせ、同じURLの次の再生は読み込み直す", async (t) => {
  const h = audioHarness(t);
  const events = [];
  await h.play({
    id: "通話", segments: [{ url: "/call.wav" }],
    onEnded() { events.push("完了"); }, onStop() { events.push("停止"); }, onError() { events.push("エラー"); }
  });
  const howl = h.Howler._howls[0];
  const sound = howl._sounds[0];
  const node = sound._node;
  node.resolvePlay();
  await h.flush();
  emitNetworkError(node);
  await h.flush();
  assert.deepEqual(events, ["エラー"]);
  assertStopped(howl, sound);
  assertRetained(h, howl, sound, node);
  await h.play({ id: "再試行", segments: [{ url: "/call.wav" }] });
  assert.equal(h.Howler._howls.length, 2, "旧Howlの保持と再試行のcacheを区別する");
  assert.notEqual(h.Howler._howls[1], howl, "壊れたHowlを読み込み直す");
});

for (const phase of ["再生中", "再生開始待ち"]) {
  test(`実Howler: ${phase}のエラー通知から同じURLを即時再試行しても旧キャッシュを使わない`, async (t) => {
    const h = audioHarness(t);
    const events = [];
    let retry;
    await h.play({
      id: "旧音声", segments: [{ url: "/immediate-retry.wav" }],
      onError() {
        events.push("旧エラー");
        retry = h.api.playAudio({
          id: "再試行", segments: [{ url: "/immediate-retry.wav" }],
          onStarted() { events.push("新開始"); },
          onEnded() { events.push("新完了"); },
          onStop() { events.push("新停止"); },
          onError() { events.push("新エラー"); }
        });
      }
    });
    const old = h.Howler._howls[0];
    const oldSound = old._sounds[0];
    const oldNode = oldSound._node;
    if (phase === "再生中") {
      oldNode.resolvePlay();
      await h.flush();
    }
    emitNetworkError(oldNode);
    await h.flush();
    assert.ok(retry, "旧音声のエラー通知で再試行を始める");
    assert.equal(await retry, true);
    assert.equal(h.Howler._howls.length, 2, "旧Howlを保持していても別Howlで再試行する");
    const current = h.Howler._howls.find((entry) => entry !== old);
    assert.notEqual(current, old, "同じURLでも新しいHowlで再試行する");
    const sound = current._sounds[0];
    sound._node.resolvePlay();
    await h.flush();
    oldNode.resolvePlay();
    await h.flush();
    assert.equal(h.api.isAudioPlaybackActive("再試行"), true);
    assert.equal(current.playing(sound._id), true);
    assert.equal(sound._node.paused, false);
    assert.deepEqual(events, ["旧エラー", "新開始"]);
    assertStopped(old, oldSound);
    assertRetained(h, old, oldSound, oldNode);
  });
}

test("実Howler: 旧Soundの通信エラーで共有Howlを使用不可にするときは現在の再生にも一度だけエラーを知らせる", async (t) => {
  const h = audioHarness(t);
  const events = [];
  await h.play({ ...request("旧音声A", "/old-sound-error.wav"), onError() { events.push("旧エラー"); } });
  const howl = h.Howler._howls[0];
  const first = howl._sounds[0];
  const firstNode = first._node;
  await h.play({
    ...request("現在の音声B", "/old-sound-error.wav"),
    onEnded() { events.push("完了"); }, onStop() { events.push("停止"); }, onError() { events.push("エラー"); }
  });
  const second = howl._sounds.find((sound) => sound !== first);
  const secondNode = second._node;
  secondNode.resolvePlay();
  await h.flush();
  assert.equal(h.api.isAudioPlaybackActive("現在の音声B"), true);
  emitNetworkError(firstNode);
  await h.flush();
  assert.equal(h.api.isAudioPlaybackActive(), false, "共有Howlの失敗後に現在の再生状態を残さない");
  assert.deepEqual(events, ["エラー"]);
  assertRetained(h, howl, first, firstNode);
  assertRetained(h, howl, second, secondNode);

  await h.play({ ...request("再試行", "/old-sound-error.wav"), onError() { events.push("再試行エラー"); } });
  const current = h.Howler._howls.find((entry) => entry !== howl);
  assert.ok(current);
  const currentSound = current._sounds[0];
  currentSound._node.resolvePlay();
  await h.flush();
  firstNode.resolvePlay();
  await h.flush();
  assertStopped(howl, first);
  assertStopped(howl, second);
  assert.equal(current.playing(currentSound._id), true);
  assert.equal(currentSound._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("再試行"), true);
  assert.deepEqual(events, ["エラー"]);
});

test("実Howler: 同じURLを繰り返し再試行しても失敗Howlを再利用しない", async (t) => {
  const h = audioHarness(t);
  const events = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await h.play({ ...request(`再試行${attempt}`, "/retry.wav"), onError() { events.push(attempt); } });
    assert.equal(h.Howler._howls.length, attempt + 1, "失敗Howlは残り、再試行だけ新規に作る");
    const howl = h.Howler._howls[attempt];
    const sound = howl._sounds[0];
    const node = sound._node;
    node.resolvePlay();
    await h.flush();
    emitNetworkError(node);
    await h.flush();
    assertStopped(howl, sound);
    assertRetained(h, howl, sound, node);
    assert.equal(h.api.isAudioPlaybackActive(), false);
  }
  assert.deepEqual(events, [0, 1, 2, 3]);
});

test("実Howler: preload後の通信エラーは待機cacheだけを外し、別音源の再生を継続する", async (t) => {
  const h = audioHarness(t);
  const preloaded = h.api.preloadAudioSegments([{ url: "/preloaded.wav" }]);
  await h.flush();
  assert.equal((await preloaded).durationMs, 20000);
  const idle = h.Howler._howls[0];
  const idleSound = idle._sounds[0];
  const idleNode = idleSound._node;
  const events = [];
  await h.play({ ...request("別音源", "/other.wav"), onError() { events.push("エラー"); } });
  const current = h.Howler._howls[1];
  const currentSound = current._sounds[0];
  currentSound._node.resolvePlay();
  await h.flush();
  emitNetworkError(idleNode);
  await h.flush();
  assertRetained(h, idle, idleSound, idleNode);
  assert.equal(h.Howler._howls.length, 2);
  assert.equal(current.playing(currentSound._id), true);
  assert.equal(currentSound._node.paused, false);
  assert.equal(h.api.isAudioPlaybackActive("別音源"), true);
  assert.deepEqual(events, []);

  const reloaded = h.api.preloadAudioSegments([{ url: "/preloaded.wav" }]);
  await h.flush();
  assert.equal((await reloaded).durationMs, 20000);
  assert.equal(h.Howler._howls.length, 3, "壊れた待機音源だけを新しく読み込む");
  assert.notEqual(h.Howler._howls[2], idle);
});

test("実Howler: 複数音源の準備中に付いた失敗印は、読み込み済みHowlの再生開始も拒否する", async (t) => {
  const h = audioHarness(t);
  const preloaded = h.api.preloadAudioSegments([{ url: "/prepared-first.wav" }]);
  await h.flush();
  await preloaded;
  const first = h.Howler._howls[0];
  const firstNode = first._sounds[0]._node;
  const playCount = firstNode.playCount;
  const events = [];
  const preparing = h.api.playAudio({
    id: "複数音源の準備", segments: [{ url: "/prepared-first.wav" }, { url: "/prepared-second.wav" }],
    onEnded() { events.push("完了"); }, onError() { events.push("エラー"); }
  });
  await flushMicrotasks();
  assert.equal(h.Howler._howls.length, 2);
  // 第2音源のmetadata通知は保留し、第1音源のエラー通知だけを先に処理する。
  const secondLoadTimers = new Set(h.timerIds(0));
  emitNetworkError(firstNode);
  for (let turn = 0; turn < 8; turn += 1) {
    const pending = h.timerIds(0).filter((id) => !secondLoadTimers.has(id));
    if (!pending.length) break;
    for (const id of pending) h.fireTimer(id);
    await flushMicrotasks();
  }
  assert.equal(first.state(), "loaded", "unloadなしでも失敗印で拒否できる必要がある");
  assert.deepEqual(events, []);
  for (const id of secondLoadTimers) h.fireTimer(id);
  await h.flush();
  assert.equal(await preparing, false);
  assert.equal(firstNode.playCount, playCount, "準備配列に残る失敗Howlを再生しない");
  assert.equal(h.api.isAudioPlaybackActive(), false);
  assert.deepEqual(events, ["エラー"]);
});

test("実Howler: 後続音源の故障を一度だけ通知し、再試行ではその音源だけ読み込み直す", async (t) => {
  const h = audioHarness(t);
  const events = [];
  const segments = [{ url: "/current.wav" }, { url: "/future.wav" }];
  await h.play({ id: "連続音声", segments, onEnded() { events.push("完了"); }, onError() { events.push("エラー"); } });
  const first = h.Howler._howls[0];
  const firstSound = first._sounds[0];
  firstSound._node.resolvePlay();
  await h.flush();
  const future = h.Howler._howls[1];
  const futureSound = future._sounds[0];
  const futureNode = futureSound._node;
  emitNetworkError(futureNode);
  await h.flush();
  assert.equal(h.api.isAudioPlaybackActive(), false);
  assertStopped(first, firstSound);
  assertRetained(h, future, futureSound, futureNode);
  assert.deepEqual(events, ["エラー"]);
  await h.play({ id: "連続音声の再試行", segments, onError() { events.push("新エラー"); } });
  assert.equal(h.Howler._howls.length, 3, "先頭の正常cacheは再利用し、故障した後続だけ新規に作る");
  const reloaded = h.Howler._howls[2];
  assert.notEqual(reloaded, future);
  const restarted = first._sounds[0];
  restarted._node.resolvePlay();
  await h.flush();
  restarted._node.currentTime = restarted._node.duration;
  restarted._node.ended = true;
  first._ended(restarted);
  await h.flush();
  const currentSound = reloaded._sounds[0];
  currentSound._node.resolvePlay();
  await h.flush();
  assert.equal(h.api.isAudioPlaybackActive("連続音声の再試行"), true);
  assert.equal(currentSound._node.paused, false);
  assert.deepEqual(events, ["エラー"]);
});

test("実Howler: 再生済み音源の遅延エラーは次の正常な音源を停止しない", async (t) => {
  const h = audioHarness(t);
  const events = [];
  await h.play({
    id: "連続音声", segments: [{ url: "/first.wav" }, { url: "/second.wav" }],
    onEnded() { events.push("完了"); },
    onStop() { events.push("停止"); },
    onError() { events.push("エラー"); }
  });
  const first = h.Howler._howls[0];
  const firstSound = first._sounds[0];
  const firstNode = firstSound._node;
  firstNode.resolvePlay();
  await h.flush();
  firstNode.currentTime = firstNode.duration;
  firstNode.ended = true;
  first._ended(firstSound);
  await h.flush();
  const second = h.Howler._howls[1];
  const secondSound = second._sounds[0];
  const secondNode = secondSound._node;
  secondNode.resolvePlay();
  await h.flush();
  emitNetworkError(firstNode);
  await h.flush();
  assertRetained(h, first, firstSound, firstNode);
  assert.equal(h.Howler._howls.length, 2);
  assert.equal(h.api.isAudioPlaybackActive("連続音声"), true);
  assert.equal(second.playing(secondSound._id), true);
  assert.equal(secondNode.paused, false);
  assert.deepEqual(events, []);
});

for (const condition of ["初回play Promise待ち", "初回play Promise拒否", "ループplay Promise待ち", "ループcanplaythrough待ち"]) {
  test(`実Howler: ${condition}の通信エラーで別Howlへ再試行し、旧音源の遅延復旧は停止する`, async (t) => {
    const h = audioHarness(t);
    const events = [];
    await h.play({ ...request("旧音声", "/pending-error.wav"), onError() { events.push("旧エラー"); } });
    const old = h.Howler._howls[0];
    const oldSound = old._sounds[0];
    const oldNode = oldSound._node;
    if (condition.startsWith("ループ")) {
      oldNode.resolvePlay();
      await h.flush();
      startNextLoop(old, oldSound, condition === "ループcanplaythrough待ち" ? 2 : 4);
    }
    assert.equal(old._playLock, true, "通信エラー時点ではHowlerの再生開始が未完了");
    const settleOldPlay = condition === "初回play Promise拒否" ? oldNode.rejectPlay : oldNode.resolvePlay;
    emitNetworkError(oldNode);
    await h.flush();
    assert.equal(h.api.isAudioPlaybackActive(), false);
    assert.deepEqual(events, ["旧エラー"]);

    await h.play({
      ...request("再試行", "/pending-error.wav"),
      onEnded() { events.push("新完了"); }, onStop() { events.push("新停止"); }, onError() { events.push("新エラー"); }
    });
    const current = h.Howler._howls.find((howl) => howl !== old);
    assert.ok(current, "同じURLでも別のHowlで再試行する");
    const currentSound = current._sounds[0];
    currentSound._node.resolvePlay();
    await h.flush();

    // 旧Audioの通知が再試行開始後に届く順番を再現する。
    if (condition === "ループcanplaythrough待ち") {
      oldNode.ready();
      oldNode.resolvePlay();
    } else {
      settleOldPlay();
    }
    await h.flush();
    assertStopped(old, oldSound);
    assertRetained(h, old, oldSound, oldNode);
    assert.equal(h.Howler._howls.length, 2, "残る旧Howlと新cacheを分離する");
    assert.equal(current.playing(currentSound._id), true);
    assert.equal(currentSound._node.paused, false);
    assert.equal(h.api.isAudioPlaybackActive("再試行"), true);
    assert.deepEqual(events, ["旧エラー"]);
  });
}

for (const condition of ["初回play Promise待ち", "ループplay Promise待ち", "ループcanplaythrough待ち"]) {
  test(`実Howler: ${condition}で通信が復旧しなくてもUIを止めず別Howlで再試行できる`, async (t) => {
    const h = audioHarness(t);
    const events = [];
    await h.play({ ...request("通信停止", "/never-ready.wav"), onError() { events.push("エラー"); } });
    const howl = h.Howler._howls[0];
    const sound = howl._sounds[0];
    const node = sound._node;
    if (condition.startsWith("ループ")) {
      node.resolvePlay();
      await h.flush();
      startNextLoop(howl, sound, condition === "ループcanplaythrough待ち" ? 2 : 4);
    }
    assert.equal(howl._playLock, true);
    // 元URLのcanplaythroughとplay()成功は、この後一度も通知しない。
    emitNetworkError(node);
    await h.flush();
    assertRetained(h, howl, sound, node);
    assert.equal(h.Howler._howls.length, 1, "未復旧の音源は回収したことにしない");
    assert.equal(h.api.isAudioPlaybackActive(), false);
    assert.deepEqual(events, ["エラー"]);
    assert.ok(queueEvents(howl).includes("stop"), "復旧時に旧音源を止める要求を残す");
    assert.ok(listeners(howl).play > 0, "旧音源の遅延開始を監視する");
    await h.play({ ...request("再試行", "/never-ready.wav"), onError() { events.push("新エラー"); } });
    const current = h.Howler._howls.find((entry) => entry !== howl);
    assert.ok(current);
    current._sounds[0]._node.resolvePlay();
    await h.flush();
    assert.equal(h.api.isAudioPlaybackActive("再試行"), true);
    assert.equal(current._sounds[0]._node.paused, false);
    assert.equal(h.Howler._howls.length, 2);
    assert.deepEqual(events, ["エラー"]);
  });
}
