import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resourceUrl } from "../src/client/system/resourceUrls.ts";
import { resolveResourceUrl } from "../src/shared/deploymentUrls.ts";

const source = readFileSync(new URL("../src/client/system/audioEngine.ts", import.meta.url), "utf8");

function audioHarness(resolveUrl = resourceUrl) {
  const howls = [];
  const frames = new Map();
  const timers = [];
  const warnings = [];
  let serial = 0;
  let frameSerial = 0;
  class FakeHowl {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.position = 0;
      this.playCount = 0;
      this.stopCount = 0;
      this.unloadCount = 0;
      howls.push(this);
    }
    state() { return "loaded"; }
    duration() { return 2; }
    once(name, callback, id) { return this.on(name, callback, id, true); }
    on(name, callback, id, once = false) {
      this.events.set(name, [...(this.events.get(name) ?? []), { callback, id, once }]);
      return this;
    }
    off(name, callback, id) {
      this.events.set(name, (this.events.get(name) ?? []).filter((entry) => (
        (callback && entry.callback !== callback) || (id !== undefined && entry.id !== id)
      )));
      return this;
    }
    emit(name, id) {
      for (const entry of [...(this.events.get(name) ?? [])]) {
        if (entry.id !== undefined && entry.id !== id) continue;
        if (entry.once) this.off(name, entry.callback, entry.id);
        entry.callback(id);
      }
    }
    play() { this.playCount += 1; this.isPlaying = true; return this.soundId = ++serial; }
    loop() {}
    unload() {
      this.unloadCount += 1;
      this.isPlaying = false;
      this.events.clear();
      return null;
    }
    playing(id) { return this.isPlaying && (id === undefined || id === this.soundId); }
    seek() { return this.position; }
    stop(id) {
      this.stopCount += 1;
      if (id !== undefined && id !== this.soundId) return this;
      this.isPlaying = false;
      this.emit("stop", this.soundId);
      return this;
    }
    end() {
      this.position = 2;
      this.isPlaying = false;
      this.emit("end", this.soundId);
    }
  }
  const sandbox = {
    exports: {}, console: { ...console, warn(...args) { warnings.push(args); } },
    require(name) {
      if (name === "./resourceUrls.ts") return { resourceUrl: resolveUrl };
      assert.equal(name, "howler");
      return { Howl: FakeHowl, Howler: { ctx: null, noAudio: false, html5PoolSize: 10 } };
    },
    window: {
      setTimeout(callback) { timers.push(callback); },
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
    api: sandbox.exports, howls, frames, warnings,
    flushTimers() {
      while (timers.length) timers.shift()();
    },
    tick() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    }
  };
}

// 再生の購読を外した後も、キャッシュが壊れた音源を外すためのloaderror監視は残る。
const remainingListeners = (howl) => [...howl.events].flatMap(([name, entries]) => entries.map(() => name));

test("静的音源・生成音声API・外部音源は再生入口で解決し、元のsegmentは変更しない", async () => {
  const { api, howls } = audioHarness((url) => resolveResourceUrl(url, "/works/story/", "https://api.example.test"));
  const segments = [
    { key: "公開素材", url: "/system/incoming-call-bell.wav" },
    { key: "生成音声", url: "/api/generated-audio/static/recording-id.wav" },
    { key: "外部素材", url: "https://media.example.test/voice.wav" }
  ];
  const original = structuredClone(segments);
  await api.preloadAudioSegments(segments);
  assert.deepEqual(howls.map((howl) => howl.options.src[0]), [
    "/works/story/system/incoming-call-bell.wav",
    "https://api.example.test/api/generated-audio/static/recording-id.wav",
    "https://media.example.test/voice.wav"
  ]);
  assert.deepEqual(segments, original);
  await api.playAudio({ id: "解決済みキャッシュの再利用", segments });
  assert.equal(howls.length, 3);
});

test("音声のpathとbaseが同名でもpreload後の再生で二重解決しない", async () => {
  const { api, howls } = audioHarness((url) => resolveResourceUrl(url, "/demo/", "https://api.example.test"));
  const segments = [{ url: "/demo/voice.wav" }];
  await api.preloadAudioSegments(segments);
  await api.playAudio({ id: "同名pathの再生", segments });
  assert.equal(howls.length, 1);
  assert.equal(howls[0].options.src[0], "/demo/demo/voice.wav");
  assert.equal(segments[0].url, "/demo/voice.wav");
});

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
  const staleEnd = howls[0].events.get("end").map((entry) => entry.callback);
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

test("再生中の通信エラーは一度だけ知らせ、強制解放せず同じURLを新しいHowlで再試行する", async () => {
  const { api, howls, frames, flushTimers } = audioHarness();
  const events = [];
  await api.playAudio({
    id: "通話", segments: [{ url: "/call.wav" }],
    onEnded() { events.push("完了"); }, onStop() { events.push("停止"); }, onError() { events.push("エラー"); }
  });
  howls[0].emit("loaderror", howls[0].soundId);
  flushTimers();
  howls[0].end();
  assert.deepEqual(events, ["エラー"]);
  assert.equal(api.isAudioPlaybackActive(), false);
  assert.equal(frames.size, 0);
  assert.equal(howls[0].unloadCount, 0);
  assert.equal(howls[0].stopCount, 1);
  assert.equal(howls[0].playing(howls[0].soundId), false);
  assert.equal(await api.playAudio({ id: "再試行", segments: [{ url: "/call.wav" }] }), true);
  assert.equal(howls.length, 2);
  assert.equal(howls[0].playCount, 1, "失敗したHowlは再利用しない");
  assert.equal(howls[1].playCount, 1);
  assert.equal(api.isAudioPlaybackActive("再試行"), true);
});

test("読み込み後に待機中の音源が壊れたら、次の再生では読み込み直す", async () => {
  const { api, howls, flushTimers } = audioHarness();
  await api.preloadAudioSegments([{ url: "/radio.wav" }]);
  howls[0].emit("loaderror", 1);
  flushTimers();
  assert.equal(howls[0].unloadCount, 0);
  assert.equal(await api.playAudio({ id: "ラジオ", segments: [{ url: "/radio.wav" }] }), true);
  assert.equal(howls.length, 2);
  assert.equal(howls[0].playCount, 0, "準備中に失敗したHowlから再生しない");
  assert.equal(howls[1].playCount, 1);
  assert.equal(api.isAudioPlaybackActive("ラジオ"), true);
});

test("後続音源の読み込み中に先頭音源が壊れたら、準備済みsegmentsから再生せずエラーを知らせる", async () => {
  const events = [];
  const h = audioHarness((url) => {
    if (url === "/second.wav") {
      h.howls[0].emit("loaderror");
      h.flushTimers();
    }
    return url;
  });
  const started = await h.api.playAudio({
    id: "複数音源", segments: [{ url: "/first.wav" }, { url: "/second.wav" }],
    onError() { events.push("エラー"); }, onEnded() { events.push("完了"); }
  });
  assert.equal(started, false);
  assert.equal(h.howls[0].unloadCount, 0);
  assert.equal(h.howls[0].playCount, 0);
  assert.equal(h.howls[1].playCount, 0);
  assert.equal(h.api.isAudioPlaybackActive(), false);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(events, ["エラー"]);
});

test("待機中の後続音源が壊れたら現在の再生を止め、後続の開始や完了を通知しない", async () => {
  const { api, howls, frames, flushTimers } = audioHarness();
  const events = [];
  await api.playAudio({
    id: "複数音源", segments: [{ url: "/first.wav" }, { url: "/second.wav" }],
    onError() { events.push("エラー"); }, onEnded() { events.push("完了"); },
    onStop() { events.push("停止"); }
  });
  howls[1].emit("loaderror", 1);
  flushTimers();
  howls[0].end();
  assert.equal(howls[0].stopCount, 1);
  assert.equal(howls[0].playing(howls[0].soundId), false);
  assert.equal(howls[1].playCount, 0);
  assert.equal(howls[1].unloadCount, 0);
  assert.equal(api.isAudioPlaybackActive(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(events, ["エラー"]);
});

test("通常停止は一度だけ音源を止め、購読・tickerを外してonStopを一度通知する", async () => {
  const { api, howls, frames } = audioHarness();
  const stops = [];
  await api.playAudio({
    id: "normal-stop", segments: [{ url: "/one.wav" }],
    onStop(reason) { stops.push(reason); }
  });
  const howl = howls[0];

  api.stopAudioPlayback("操作停止", "normal-stop");
  api.stopAudioPlayback("重複停止");

  assert.equal(howl.stopCount, 1);
  assert.equal(howl.playing(howl.soundId), false);
  assert.deepEqual(remainingListeners(howl), ["loaderror"]);
  assert.equal(api.isAudioPlaybackActive(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(stops, ["操作停止"]);
});

test("停止通知後に配信済みの古いcallbackが届いても停止・UI通知を繰り返さない", async () => {
  const { api, howls, frames, warnings, flushTimers } = audioHarness();
  const events = [];
  await api.playAudio({
    id: "late-callback", segments: [{ url: "/one.wav" }],
    onStarted() { events.push("開始"); }, onEnded() { events.push("完了"); },
    onStop() { events.push("停止"); }, onError() { events.push("エラー"); }
  });
  const howl = howls[0];
  const oldCallbacks = [...howl.events.values()].flat().map((entry) => entry.callback);
  const stoppingCallbacks = [];
  const originalStop = howl.stop.bind(howl);
  howl.stop = (id) => {
    stoppingCallbacks.push(...[...howl.events.values()].flat().map((entry) => entry.callback));
    return originalStop(id);
  };

  api.stopAudioPlayback();
  assert.ok(stoppingCallbacks.length > 0);
  for (const callback of [...oldCallbacks, ...stoppingCallbacks]) {
    callback(howl.soundId, new Error("遅延した通知"));
  }
  flushTimers();

  assert.equal(howl.stopCount, 1);
  assert.deepEqual(remainingListeners(howl), [], "遅延した通信エラーの監視も解除する");
  assert.equal(api.isAudioPlaybackActive(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(events, ["開始", "停止"]);
  assert.deepEqual(warnings, []);
});

test("音源停止の同期例外は警告に留め、tickerの解除とonStop通知を完了する", async () => {
  const { api, howls, frames, warnings } = audioHarness();
  const stops = [];
  await api.playAudio({
    id: "failed-stop", segments: [{ url: "/one.wav" }],
    onStop(reason) { stops.push(reason); }
  });
  const howl = howls[0];
  const stopError = new Error("停止APIの同期例外");
  howl.stop = () => { howl.stopCount += 1; throw stopError; };

  assert.doesNotThrow(() => api.stopAudioPlayback("操作停止"));

  assert.equal(howl.stopCount, 1);
  assert.deepEqual(remainingListeners(howl), ["loaderror"]);
  assert.equal(api.isAudioPlaybackActive(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(stops, ["操作停止"]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[audioEngine:stop]");
  assert.equal(warnings[0][1], stopError);
});
