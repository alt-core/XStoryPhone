import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedAudioRuntime } from "../src/worker/services/generatedAudioRuntime.ts";
import { projectGeneratedAudioProviders } from "../src/project/generatedAudioProviders.ts";

function fixture(t) {
  const definition = { id: "voice", publicId: "g_voice", provider: "fixture_audio", title: "音声", staticUrl: "", fallbackAttachmentId: "fallback" };
  const scenario = { project: { id: "audio_fixture" }, generatedAudio: [definition], attachments: [{ id: "fallback", type: "audio", asset: "/fallback.wav" }] };
  const provider = { id: definition.provider, enqueue: async () => ({ status: "running", externalJobId: "external" }), reconcile: async () => ({ status: "running" }) };
  projectGeneratedAudioProviders.push(provider);
  t.after(() => projectGeneratedAudioProviders.splice(projectGeneratedAudioProviders.indexOf(provider), 1));
  let job = null, reads = 0, writes = 0;
  const store = {
    generatedAudioJob: async () => structuredClone(job),
    generatedAudioJobs: async () => { reads += 1; return job ? [structuredClone(job)] : []; },
    saveGeneratedAudioJob: async (_, next) => { writes += 1; job = structuredClone(next); },
    updateGeneratedAudioJob: async (_, next) => {
      if (job?.id !== next.id || job.inputHash !== next.inputHash || !["queued", "running"].includes(job.status)) return false;
      writes += 1; job = structuredClone(next); return true;
    },
    replaceGeneratedAudioJob: async (_, expected, next) => {
      if (job?.id !== expected || job.status === "ready") return false;
      writes += 1; job = structuredClone(next); return true;
    }
  };
  const runtime = createGeneratedAudioRuntime({ workerScenario: scenario });
  return { runtime, provider, store, scenario, definition, get job() { return job; }, get reads() { return reads; }, get writes() { return writes; } };
}

test("未prepareの外部音声と固定音声はjob DBへ触れない", async t => {
  const f = fixture(t);
  const state = await f.runtime.publicGeneratedAudioStates(f.store, "p", {}, "secret");
  assert.equal(state[0].status, "idle");
  assert.equal(state[0].fallbackAudioUrl, null, "失敗前に代替を配らない");
  assert.equal(f.reads, 0);
});

test("照合手段のないpendingとURLのないreadyは永久待機にせず失敗へ倒す", async t => {
  const f = fixture(t);
  for (const status of ["running", "ready"]) {
    f.provider.enqueue = async () => ({ status });
    const job = await f.runtime.prepareGeneratedAudio(f.store, "p", "voice", status);
    assert.equal(job.status, "failed");
    assert.equal(job.errorCode, "provider_result_invalid");
  }
});

test("同じ依頼の手動再生成はhashを保ち、旧tokenの期待値で新しいURLを利用できる", async t => {
  const f = fixture(t);
  const initial = await f.runtime.createGeneratedAudioIntent(f.store, "p", "voice", "未公開の生成台本");
  initial.createdAt = "2020-01-01T00:00:00.000Z";
  initial.status = "failed";
  await f.store.saveGeneratedAudioJob("p", initial);
  const expected = await f.runtime.requestHash("p", initial, "secret");
  assert.notEqual(expected, initial.inputHash);
  assert.notEqual(expected, await f.runtime.requestHash("other", initial, "secret"));
  let enqueueInput;
  f.provider.enqueue = async input => { enqueueInput = input; return { status: "ready", outputKey: "/regenerated.wav", externalJobId: "new-external" }; };
  const retried = await f.runtime.retryGeneratedAudio(f.store, "p", "voice", initial.id);
  assert.notEqual(retried.id, initial.id);
  assert.notEqual(retried.createdAt, initial.createdAt);
  assert.equal(enqueueInput.createdAt, retried.createdAt);
  assert.equal(retried.inputHash, initial.inputHash);
  assert.equal(retried.inputText, "未公開の生成台本");
  assert.equal(await f.runtime.requestHash("p", retried, "secret"), expected);
  const [state] = await f.runtime.publicGeneratedAudioStates(f.store, "p", { g_voice: expected }, "secret");
  assert.equal(state.publicAudioUrl, "/regenerated.wav");
  assert.equal(state.status, "ready");
  assert.equal(JSON.stringify(state).includes("未公開の生成台本"), false);
  assert.equal(await f.runtime.retryGeneratedAudio(f.store, "p", "voice", initial.id), null);
});

test("別入力のjobは再照会せず失敗扱いにし、取得済みの代替だけを返す", async t => {
  const f = fixture(t);
  const old = await f.runtime.createGeneratedAudioIntent(f.store, "p", "voice", "元の入力");
  const expected = await f.runtime.requestHash("p", old, "secret");
  const other = await f.runtime.createGeneratedAudioIntent(f.store, "p", "voice", "別の入力");
  other.status = "running";
  await f.store.saveGeneratedAudioJob("p", other);
  f.provider.reconcile = async () => assert.fail("別入力は照会しない");
  const [state] = await f.runtime.publicGeneratedAudioStates(f.store, "p", { g_voice: expected }, "secret");
  assert.equal(state.status, "failed");
  assert.equal(state.publicAudioUrl, null);
  assert.equal(state.fallbackAudioUrl, "/fallback.wav");
  const [unloaded] = await f.runtime.publicGeneratedAudioStates(f.store, "p", { g_voice: expected }, "secret", { ...f.scenario, attachments: [] });
  assert.equal(unloaded.fallbackAudioUrl, null);
});

test("同じ試行の遅いpending応答はreadyとURLを消さず、同じstatusの照会では保存しない", async t => {
  const f = fixture(t);
  await f.runtime.prepareGeneratedAudio(f.store, "p", "voice", "入力");
  const before = f.writes;
  await f.runtime.reconcileGeneratedAudio(f.store, "p");
  assert.equal(f.writes, before);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.provider.reconcile = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const slow = f.runtime.reconcileGeneratedAudio(f.store, "p");
  await started;
  f.provider.reconcile = async () => ({ status: "ready", outputKey: "/ready.wav" });
  await f.runtime.reconcileGeneratedAudio(f.store, "p");
  release({ status: "running" });
  const rows = await slow;
  assert.equal(f.job.status, "ready");
  assert.equal(f.job.outputKey, "/ready.wav");
  assert.equal(rows[0].status, "ready");
});
