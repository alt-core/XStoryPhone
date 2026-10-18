import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedAudioRuntime } from "../src/worker/services/generatedAudioRuntime.ts";
import { projectGeneratedAudioProviders } from "../src/project/generatedAudioProviders.ts";
import {
  GeneratedAudioRequestDeferredError,
  GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE
} from "../src/worker/providers/generatedAudio.ts";

function clock(t) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T00:00:00Z") });
  const timers = new Set();
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
    const timer = { callback, milliseconds, at: Date.now() + milliseconds, unref() { return this; } };
    timers.add(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", timer => timers.delete(timer));
  return {
    timers,
    advance(milliseconds) { t.mock.timers.tick(milliseconds); },
    fire(timer) {
      assert.ok(timers.has(timer), "開始済みのタイマーだけを発火させる");
      t.mock.timers.tick(Math.max(0, timer.at - Date.now()));
      timers.delete(timer);
      timer.callback();
    }
  };
}

async function until(check) {
  for (let index = 0; index < 100; index += 1) {
    if (check()) return;
    await new Promise(setImmediate);
  }
  assert.fail("試験中の非同期処理に到達しませんでした");
}

function fixture(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("この試験で実通信を行わない"));
  const definition = { id: "audio_a", publicId: "public_audio_a", provider: "budget_fixture", title: "音声", staticUrl: "", fallbackAttachmentId: "fallback" };
  const scenario = { project: { id: "audio_budget_fixture" }, generatedAudio: [definition], attachments: [{ id: "fallback", type: "audio", asset: "/fallback.wav" }] };
  const calls = { enqueue: [], reconcile: [] };
  const provider = {
    id: definition.provider,
    minimumRequestBudgetMs: { enqueue: 1_000, reconcile: 500 },
    async enqueue(input) { calls.enqueue.push(input); return { status: "queued", externalJobId: "external_job_a" }; },
    async reconcile(input) { calls.reconcile.push(input); return { status: "running" }; }
  };
  projectGeneratedAudioProviders.push(provider);
  t.after(() => projectGeneratedAudioProviders.splice(projectGeneratedAudioProviders.indexOf(provider), 1));
  const jobs = new Map();
  const key = (playerId, audioId) => JSON.stringify([playerId, audioId]);
  const current = (playerId = "player_a", audioId = definition.id) => structuredClone(jobs.get(key(playerId, audioId)) ?? null);
  const save = (playerId, job) => jobs.set(key(playerId, job.audioId), structuredClone(job));
  const store = {
    async generatedAudioJob(playerId, audioId) { return current(playerId, audioId); },
    async generatedAudioJobs(playerId) { return [...jobs.entries()].filter(([id]) => JSON.parse(id)[0] === playerId).map(([, job]) => structuredClone(job)); },
    async saveGeneratedAudioJob(playerId, job) { save(playerId, job); },
    async updateGeneratedAudioJob(playerId, next) {
      const job = current(playerId, next.audioId);
      if (job?.id !== next.id || job.inputHash !== next.inputHash || !["queued", "running"].includes(job.status)) return false;
      save(playerId, next);
      return true;
    },
    async replaceGeneratedAudioJob(playerId, expectedId, next) {
      const job = current(playerId, next.audioId);
      if (job?.id !== expectedId || job.status === "ready") return false;
      save(playerId, next);
      return true;
    }
  };
  const runtime = requestDeadlineMs => createGeneratedAudioRuntime({ workerScenario: scenario }, { requestDeadlineMs });
  async function intent(runtime, playerId = "player_a", input = "非公開の生成台本") {
    const job = await runtime.createGeneratedAudioIntent(store, playerId, definition.id, input);
    assert.ok(job);
    await store.saveGeneratedAudioJob(playerId, job);
    return job;
  }
  async function state(runtime, job, playerId = "player_a") {
    const hash = await runtime.requestHash(playerId, job, "fixture_secret");
    return (await runtime.publicGeneratedAudioStates(store, playerId, { [definition.publicId]: hash }, "fixture_secret"))[0];
  }
  return { definition, scenario, provider, calls, store, runtime, intent, state, current };
}

test("残り0と正の短い予算では投入せず、同じ依頼を次の要求で再開する", async t => {
  const c = clock(t), f = fixture(t);
  for (const remaining of [0, 999]) {
    const playerId = `player_${remaining}`;
    const runtime = f.runtime(Date.now() + remaining);
    const job = await f.intent(runtime, playerId);
    const hash = await runtime.requestHash(playerId, job, "fixture_secret");
    const before = f.calls.enqueue.length;
    await runtime.dispatchGeneratedAudioIntent(f.store, playerId, job);
    const state = await f.state(runtime, job, playerId);
    assert.equal(state.status, "queued");
    assert.equal(state.fallbackAudioUrl, null);
    assert.equal(f.calls.enqueue.length, before);
    assert.equal(f.current(playerId).id, job.id);
    assert.equal(f.current(playerId).createdAt, job.createdAt);
    assert.equal(f.current(playerId).errorCode, null);

    const next = f.runtime(Date.now() + 5_000);
    const [resumed] = await next.publicGeneratedAudioStates(f.store, playerId, { [f.definition.publicId]: hash }, "fixture_secret");
    assert.equal(resumed.status, "queued");
    assert.equal(f.current(playerId).id, job.id);
    assert.equal(f.calls.enqueue.at(-1).jobId, job.id);
    assert.equal(f.calls.enqueue.at(-1).createdAt, job.createdAt);
    assert.equal(f.calls.reconcile.length, 0);
  }
  assert.equal(f.calls.enqueue.length, 2);
  assert.equal(c.timers.size, 0);
});

test("受付済みIDを保存し、照会の予算が不足する同じ要求ではpendingを返す", async t => {
  const c = clock(t), f = fixture(t);
  const deadlineMs = Date.now() + 5_000;
  const runtime = f.runtime(deadlineMs);
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    assert.equal(input.requestBudget.deadlineMs, deadlineMs);
    assert.equal(input.requestBudget.signal.aborted, false);
    c.advance(4_800);
    return { status: "queued", externalJobId: "external_job_a" };
  };
  const job = await f.intent(runtime);
  await runtime.dispatchGeneratedAudioIntent(f.store, "player_a", job);
  assert.equal(f.current().externalJobId, "external_job_a");
  assert.equal((await f.state(runtime, job)).status, "queued");
  assert.equal(f.calls.reconcile.length, 0);
  const next = f.runtime(Date.now() + 5_000);
  assert.equal((await f.state(next, job)).status, "running");
  assert.equal(f.calls.enqueue.length, 1);
  assert.equal(f.calls.reconcile[0].job.externalJobId, "external_job_a");
  assert.equal(c.timers.size, 0);
});

test("照会の残り0と正の短い予算では保存済みpendingを返す", async t => {
  const c = clock(t), f = fixture(t);
  const job = await f.intent(f.runtime());
  await f.store.saveGeneratedAudioJob("player_a", { ...job, status: "running", externalJobId: "external_job_a" });
  for (const remaining of [0, 499]) {
    const state = await f.state(f.runtime(Date.now() + remaining), job);
    assert.equal(state.status, "running");
    assert.equal(state.fallbackAudioUrl, null);
    assert.equal(f.calls.reconcile.length, 0);
    assert.equal(f.current().externalJobId, "external_job_a");
    assert.equal(f.current().errorCode, null);
  }
  await f.state(f.runtime(Date.now() + 500), job);
  assert.equal(f.calls.reconcile.length, 1);
  assert.equal(c.timers.size, 0);
});

test("期限中断後でも取得できた受付IDを破棄せず保存する", async t => {
  const c = clock(t), f = fixture(t);
  const runtime = f.runtime(Date.now() + 1_000);
  let release;
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    return new Promise(resolve => { release = resolve; });
  };
  const job = await f.intent(runtime);
  const pending = runtime.dispatchGeneratedAudioIntent(f.store, "player_a", job);
  await until(() => release);
  c.fire([...c.timers][0]);
  assert.equal(f.calls.enqueue[0].requestBudget.signal.aborted, true);
  release({ status: "queued", externalJobId: "accepted_external_job" });
  const accepted = await pending;
  assert.equal(accepted.externalJobId, "accepted_external_job");
  assert.equal(f.current().errorCode, null);
  assert.equal((await f.state(runtime, job)).status, "queued");
  assert.equal(f.calls.reconcile.length, 0);
  await f.state(f.runtime(Date.now() + 5_000), job);
  assert.equal(f.calls.enqueue.length, 1);
  assert.equal(f.calls.reconcile[0].job.externalJobId, "accepted_external_job");
  assert.equal(c.timers.size, 0);
});

test("投入中の期限切れは受付不明として保存し、次の要求で安全に照合して回復する", async t => {
  const c = clock(t), f = fixture(t), logs = [];
  for (const method of ["log", "warn", "error"]) t.mock.method(console, method, (...args) => logs.push(JSON.stringify(args)));
  const runtime = f.runtime(Date.now() + 1_000);
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    return new Promise((_resolve, reject) => input.requestBudget.signal.addEventListener("abort", () => reject(new Error("非公開の生成台本・fixture_secret・参照音声key")), { once: true }));
  };
  const job = await f.intent(runtime);
  const pending = runtime.dispatchGeneratedAudioIntent(f.store, "player_a", job);
  await until(() => f.calls.enqueue.length === 1);
  c.fire([...c.timers][0]);
  await pending;
  assert.equal(f.current().id, job.id);
  assert.equal(f.current().status, "queued");
  assert.equal(f.current().errorCode, GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE);
  assert.equal((await f.state(runtime, job)).fallbackAudioUrl, null);
  assert.equal(f.calls.reconcile.length, 0, "中断した同じ要求では照合を始めない");
  assert.equal((await f.state(f.runtime(Date.now() + 499), job)).status, "queued");
  assert.equal(f.calls.reconcile.length, 0, "受付不明の照合も残り予算が不足すれば見送る");
  assert.equal(f.current().errorCode, GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE);
  const next = f.runtime(Date.now() + 5_000);
  f.provider.reconcile = async input => {
    f.calls.reconcile.push(input);
    assert.equal(input.job.externalJobId, null);
    assert.equal(input.job.outputKey, null);
    assert.equal(input.job.id, job.id);
    assert.equal(input.job.createdAt, job.createdAt);
    assert.equal(input.requestBudget.deadlineMs, Date.now() + 5_000);
    return { status: "running", externalJobId: "recovered_external_job" };
  };
  await next.dispatchGeneratedAudioIntent(f.store, "player_a", f.current());
  assert.equal(f.calls.enqueue.length, 1, "受付不明を直接dispatchしても新しい投入を始めない");
  assert.equal((await f.state(next, job)).status, "running");
  assert.equal(f.calls.enqueue.length, 1, "通常pollはPOSTを再送せず、安全な照合だけを行う");
  assert.equal(f.calls.reconcile.length, 1);
  assert.equal(f.current().id, job.id);
  assert.equal(f.current().createdAt, job.createdAt);
  assert.equal(f.current().externalJobId, "recovered_external_job");
  assert.equal(f.current().errorCode, null);
  f.provider.reconcile = async input => {
    f.calls.reconcile.push(input);
    assert.equal(input.job.externalJobId, "recovered_external_job");
    return { status: "ready", outputKey: "/recovered.wav" };
  };
  const completed = await f.state(f.runtime(Date.now() + 5_000), job);
  assert.equal(completed.status, "ready");
  assert.equal(completed.publicAudioUrl, "/recovered.wav");
  assert.equal(f.calls.enqueue.length, 1);
  for (const secret of ["非公開の生成台本", "fixture_secret", "参照音声key"]) assert.ok(!logs.join("\n").includes(secret));
  assert.equal(c.timers.size, 0);
});

test("受付不明の照合が未確定でも元の期限を守り、期限切れ後はfallbackと明示再試行で復旧する", async t => {
  const c = clock(t), f = fixture(t);
  const runtime = f.runtime(Date.now() + 5_000);
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    throw new GeneratedAudioRequestDeferredError("acceptance_unknown");
  };
  const job = await f.intent(runtime);
  await runtime.dispatchGeneratedAudioIntent(f.store, "player_a", job);
  f.provider.reconcile = async input => {
    f.calls.reconcile.push(input);
    assert.equal(input.job.externalJobId, null);
    assert.equal(input.job.id, job.id);
    assert.equal(input.job.createdAt, job.createdAt);
    if (Date.now() - Date.parse(input.job.createdAt) >= 30_000)
      return { status: "failed", errorCode: "fixture_acceptance_expired" };
    throw new GeneratedAudioRequestDeferredError("acceptance_unknown");
  };
  c.advance(15_000);
  const pending = await f.state(f.runtime(Date.now() + 5_000), job);
  assert.equal(pending.status, "queued");
  assert.equal(pending.fallbackAudioUrl, null);
  assert.equal(f.current().errorCode, GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE);
  assert.equal(f.calls.reconcile.length, 1, "新しい要求では受付不明でもproviderへ照合を渡す");
  c.advance(15_001);
  const failed = await f.state(f.runtime(Date.now() + 5_000), job);
  assert.equal(failed.status, "failed");
  assert.equal(failed.fallbackAudioUrl, "/fallback.wav");
  assert.equal(f.current().errorCode, "fixture_acceptance_expired");
  assert.equal(f.calls.reconcile.length, 2, "永続的な空pollにせず、providerが元のjob期限を判定する");
  assert.equal(f.calls.enqueue.length, 1);
  assert.equal(f.current().createdAt, job.createdAt);

  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    return { status: "running", externalJobId: "retried_external_job" };
  };
  const retried = await f.runtime(Date.now() + 5_000).retryGeneratedAudio(f.store, "player_a", f.definition.id, job.id);
  assert.notEqual(retried.id, job.id);
  assert.equal(retried.status, "running");
  assert.equal(retried.errorCode, null);
  assert.equal(retried.externalJobId, "retried_external_job");
  assert.equal(f.calls.enqueue.length, 2);
  assert.equal(await runtime.requestHash("player_a", retried, "fixture_secret"), await runtime.requestHash("player_a", job, "fixture_secret"));
  assert.equal(c.timers.size, 0);
});

test("再試行待機中にも共有signalが期限で中断し、未送信なら次の要求で同intentを再開する", async t => {
  const c = clock(t), f = fixture(t);
  f.provider.minimumRequestBudgetMs.enqueue = 1;
  const runtime = f.runtime(Date.now() + 500);
  let attempts = 0, waiting = false;
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    attempts += 1;
    c.advance(300);
    await new Promise((resolve, reject) => {
      const retryTimer = setTimeout(resolve, 250);
      const abort = () => { clearTimeout(retryTimer); reject(new GeneratedAudioRequestDeferredError("not_sent")); };
      input.requestBudget.signal.addEventListener("abort", abort, { once: true });
      waiting = true;
    });
    attempts += 1;
    return { status: "queued", externalJobId: "external_job_a" };
  };
  const job = await f.intent(runtime);
  const pending = runtime.dispatchGeneratedAudioIntent(f.store, "player_a", job);
  await until(() => waiting);
  c.fire([...c.timers].find(timer => timer.milliseconds === 500));
  await pending;
  assert.equal(attempts, 1);
  assert.equal(f.current().id, job.id);
  assert.equal(f.current().status, "queued");
  assert.equal(f.current().errorCode, null);
  await f.state(runtime, job);
  assert.equal(f.calls.enqueue.length, 1);
  f.provider.enqueue = async input => { f.calls.enqueue.push(input); return { status: "running", externalJobId: "external_job_a" }; };
  assert.equal((await f.state(f.runtime(Date.now() + 5_000), job)).status, "running");
  assert.equal(f.calls.enqueue[1].jobId, job.id);
  assert.equal(c.timers.size, 0);
});

test("照会中の期限切れはjobを保持し、新しい要求から同じ外部IDを照会する", async t => {
  const c = clock(t), f = fixture(t);
  const job = await f.intent(f.runtime());
  await f.store.saveGeneratedAudioJob("player_a", { ...job, externalJobId: "external_job_a", status: "running" });
  f.provider.reconcile = async input => {
    f.calls.reconcile.push(input);
    return new Promise((_resolve, reject) => input.requestBudget.signal.addEventListener("abort", () => reject(new Error("中断")), { once: true }));
  };
  const pending = f.state(f.runtime(Date.now() + 500), job);
  await until(() => f.calls.reconcile.length === 1);
  c.fire([...c.timers][0]);
  assert.equal((await pending).status, "running");
  assert.equal(f.current().createdAt, job.createdAt);
  assert.equal(f.current().errorCode, null);
  f.provider.reconcile = async input => { f.calls.reconcile.push(input); return { status: "ready", outputKey: "/ready.wav" }; };
  const completed = await f.state(f.runtime(Date.now() + 5_000), job);
  assert.equal(completed.status, "ready");
  assert.equal(completed.publicAudioUrl, "/ready.wav");
  assert.deepEqual(f.calls.reconcile.map(input => input.job.externalJobId), ["external_job_a", "external_job_a"]);
  assert.equal(f.calls.enqueue.length, 0);
  assert.equal(c.timers.size, 0);
});

test("未投入の古いintentは作成時刻を更新せず、providerが期限切れを通信前に判定できる", async t => {
  const c = clock(t), f = fixture(t);
  const old = f.runtime(Date.now());
  const job = await f.intent(old);
  await old.dispatchGeneratedAudioIntent(f.store, "player_a", job);
  c.advance(600_001);
  let externalRequests = 0;
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    if (Date.now() - Date.parse(input.createdAt) > 600_000) return { status: "failed", errorCode: "fixture_expired" };
    externalRequests += 1;
    return { status: "queued", externalJobId: "unneeded_job" };
  };
  assert.equal((await f.state(f.runtime(Date.now() + 5_000), job)).status, "failed");
  assert.equal(f.calls.enqueue[0].createdAt, job.createdAt);
  assert.equal(f.current().createdAt, job.createdAt);
  assert.equal(f.current().errorCode, "fixture_expired");
  assert.equal(externalRequests, 0);
});

test("並行要求と別プレイヤーへ締切を持ち越さず、遅いpendingでreadyを消さない", async t => {
  const c = clock(t), f = fixture(t);
  const deadlines = [Date.now() + 1_000, Date.now() + 5_000];
  const runtimes = deadlines.map(deadline => f.runtime(deadline));
  const jobs = await Promise.all(runtimes.map((runtime, index) => f.intent(runtime, `player_${index}`)));
  const entered = [];
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    return new Promise(resolve => entered.push({ input, resolve }));
  };
  const pending = runtimes.map((runtime, index) => runtime.dispatchGeneratedAudioIntent(f.store, `player_${index}`, jobs[index]));
  await until(() => entered.length === 2);
  assert.notEqual(entered[0].input.requestBudget.signal, entered[1].input.requestBudget.signal);
  assert.deepEqual(entered.map(item => item.input.requestBudget.deadlineMs), deadlines);
  await f.store.saveGeneratedAudioJob("player_0", { ...jobs[0], status: "ready", externalJobId: "completed_job", outputKey: "/ready.wav" });
  entered[0].resolve({ status: "queued", externalJobId: "late_job" });
  entered[1].resolve({ status: "queued", externalJobId: "other_job" });
  const results = await Promise.all(pending);
  assert.equal(results[0].status, "ready");
  assert.equal(f.current("player_0").outputKey, "/ready.wav");
  assert.equal(f.current("player_1").externalJobId, "other_job");
  assert.equal(c.timers.size, 0);
});

test("期限を渡さない呼出しは従来の成功・照会・明示失敗を保つ", async t => {
  clock(t);
  const f = fixture(t), runtime = f.runtime();
  const job = await runtime.prepareGeneratedAudio(f.store, "player_a", f.definition.id, "入力");
  assert.equal(f.calls.enqueue[0].requestBudget, undefined);
  assert.equal((await f.state(runtime, job)).status, "running");
  assert.equal(f.calls.reconcile[0].requestBudget, undefined);
  f.provider.enqueue = async () => ({ status: "failed", errorCode: "fixture_failure" });
  const failed = await runtime.prepareGeneratedAudio(f.store, "player_b", f.definition.id, "別の入力");
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "fixture_failure");
  assert.equal((await f.state(runtime, failed, "player_b")).fallbackAudioUrl, "/fallback.wav");
});

test("短い正常な投入と照会は十分な要求予算があれば期限なしと同じ要求内でreadyになる", async t => {
  const c = clock(t), f = fixture(t);
  f.provider.enqueue = async input => {
    f.calls.enqueue.push(input);
    c.advance(100);
    return { status: "running", externalJobId: `external_${input.jobId}` };
  };
  f.provider.reconcile = async input => {
    f.calls.reconcile.push(input);
    c.advance(100);
    return { status: "ready", outputKey: "/fast-ready.wav" };
  };
  for (const withDeadline of [true, false]) {
    const playerId = withDeadline ? "player_budget" : "player_unlimited";
    const deadlineMs = withDeadline ? Date.now() + 5_000 : undefined;
    const runtime = f.runtime(deadlineMs);
    const job = await runtime.prepareGeneratedAudio(f.store, playerId, f.definition.id, "入力");
    assert.equal(job.status, "running");
    const completed = await f.state(runtime, job, playerId);
    assert.equal(completed.status, "ready");
    assert.equal(completed.publicAudioUrl, "/fast-ready.wav");
    assert.equal(f.calls.reconcile.at(-1).job.id, job.id);
    for (const input of [f.calls.enqueue.at(-1), f.calls.reconcile.at(-1)]) {
      assert.equal(input.requestBudget?.deadlineMs, deadlineMs);
      if (withDeadline) assert.equal(input.requestBudget.signal.aborted, false);
      else assert.equal(input.requestBudget, undefined);
    }
  }
  assert.equal(f.calls.enqueue.length, 2);
  assert.equal(f.calls.reconcile.length, 2);
  assert.equal(c.timers.size, 0);
});

test("外部通信のない固定音声は要求期限が尽きても即時に利用できる", async t => {
  clock(t);
  const f = fixture(t);
  const definition = { ...f.definition, provider: "static", staticUrl: "/static.wav" };
  const runtime = createGeneratedAudioRuntime({ workerScenario: { ...f.scenario, generatedAudio: [definition] } }, { requestDeadlineMs: Date.now() });
  const job = await runtime.prepareGeneratedAudio(f.store, "player_a", definition.id, "入力");
  assert.equal(job.status, "ready");
  assert.equal((await f.state(runtime, job)).publicAudioUrl, "/static.wav");
  assert.equal(f.calls.enqueue.length, 0);
});
