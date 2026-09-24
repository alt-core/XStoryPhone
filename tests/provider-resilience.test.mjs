import assert from "node:assert/strict";
import test from "node:test";
import { projectGeneratedAudioProviders } from "../src/project/generatedAudioProviders.ts";
import { workerScenario } from "../src/worker/scenario.ts";
import { publicGeneratedAudioStates, requestHash } from "../src/worker/services/generatedAudio.ts";
import { reconcileGeneratedAudio } from "../src/worker/services/generatedAudio.ts";
import { createStructuredOutputProvider } from "../src/worker/providers/structuredOutput.ts";

test("固定音声のreadyジョブは現行URLへ追従し、外部providerの成果物と保存済みjobは書き換えない", async () => {
  const fixed = { id: "fixed_update", publicId: "fixed-public", title: "固定音声", provider: "static", staticUrl: "/api/generated-audio/static/fixed-public.wav" };
  const external = { id: "external_update", publicId: "external-public", title: "外部音声", provider: "custom-provider", staticUrl: "/fallback.wav" };
  const jobs = [fixed, external].map((definition) => ({
    id: `${definition.id}-job`, audioId: definition.id, provider: definition.provider,
    inputHash: "hash", inputText: null, externalJobId: null, status: "ready", errorCode: null,
    outputKey: definition === fixed ? "/api/generated-audio/static/fixed-public" : "https://audio.example/player-voice.wav",
    createdAt: "2026-09-15T00:00:00.000Z", completedAt: "2026-09-15T00:00:01.000Z"
  }));
  const originalJobs = structuredClone(jobs);
  const store = {
    async generatedAudioJobs() { return jobs; },
    async saveGeneratedAudioJob() { assert.fail("表示URL更新だけでDBへ書き込まない"); }
  };
  workerScenario.generatedAudio.push(fixed, external);
  try {
    for (const url of [fixed.staticUrl, "/updated-fixed.wav"]) {
      fixed.staticUrl = url;
      const requests = Object.fromEntries(await Promise.all(jobs.map(async job => [workerScenario.generatedAudio.find(item => item.id === job.audioId).publicId, await requestHash("player-1", job)])));
      const states = await publicGeneratedAudioStates(store, "player-1", requests);
      assert.equal(states.find((item) => item.id === fixed.publicId).publicAudioUrl, url);
      assert.equal(states.find((item) => item.id === fixed.publicId).status, "ready");
      assert.equal(states.find((item) => item.id === external.publicId).publicAudioUrl, jobs[1].outputKey);
    }
    assert.deepEqual(jobs, originalJobs);
  } finally {
    workerScenario.generatedAudio.splice(workerScenario.generatedAudio.indexOf(fixed), 1);
    workerScenario.generatedAudio.splice(workerScenario.generatedAudio.indexOf(external), 1);
  }
});

test("生成音声providerの照会失敗は保存済み状態を保ち、PlayerState生成を止めない", async () => {
  const definition = {
    id: "test_audio",
    publicId: "test-public-audio",
    title: "テスト音声",
    provider: "test-failing-provider",
    staticUrl: "/fallback.wav"
  };
  const provider = {
    id: definition.provider,
    async enqueue() {
      return { status: "queued" };
    },
    async reconcile() {
      throw new Error("一時的な照会失敗");
    }
  };
  const job = {
    id: "job-1",
    audioId: definition.id,
    provider: definition.provider,
    externalJobId: "external-1",
    inputHash: "hash",
    inputText: null,
    outputKey: null,
    status: "running",
    errorCode: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    completedAt: null
  };
  const saved = [];
  let reads = 0;
  const store = {
    async generatedAudioJobs() { reads += 1; return [job]; },
    async saveGeneratedAudioJob(_playerId, next) { saved.push(next); }
  };

  workerScenario.generatedAudio.push(definition);
  projectGeneratedAudioProviders.push(provider);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const states = await publicGeneratedAudioStates(store, "player-1", { [definition.publicId]: await requestHash("player-1", job) });
    assert.equal(states.find((item) => item.id === definition.publicId)?.status, "running");
    assert.deepEqual(saved, []);
    assert.equal(reads, 1);
  } finally {
    console.error = originalConsoleError;
    projectGeneratedAudioProviders.splice(projectGeneratedAudioProviders.indexOf(provider), 1);
    workerScenario.generatedAudio.splice(workerScenario.generatedAudio.indexOf(definition), 1);
  }
});

test("commit後に未dispatchの生成音声intentが残っても次のreconcileでenqueueする", async () => {
  const definition = { id: "intent_audio", publicId: "intent-public", title: "intent", provider: "intent-provider", staticUrl: "" };
  let enqueued = 0;
  const provider = {
    id: definition.provider,
    async enqueue() { enqueued += 1; return { status: "running", externalJobId: "external" }; },
    async reconcile() { throw new Error("intentはenqueueされるべきです"); }
  };
  const job = {
    id: "intent-job", audioId: definition.id, provider: provider.id, externalJobId: null,
    inputHash: "hash", inputText: "復旧入力", outputKey: null, status: "queued", errorCode: null,
    createdAt: "2026-08-23T00:00:00.000Z", completedAt: null
  };
  let saved = null;
  const store = {
    async generatedAudioJobs() { return [job]; },
    async updateGeneratedAudioJob(_playerId, next) { saved = next; return true; }
  };
  workerScenario.generatedAudio.push(definition);
  projectGeneratedAudioProviders.push(provider);
  try {
    await reconcileGeneratedAudio(store, "player-1");
    assert.equal(enqueued, 1);
    assert.equal(saved.externalJobId, "external");
    assert.equal(saved.inputText, "復旧入力", "運営による同じ依頼の再生成に備えて非公開jobへ保持する");
  } finally {
    projectGeneratedAudioProviders.splice(projectGeneratedAudioProviders.indexOf(provider), 1);
    workerScenario.generatedAudio.splice(workerScenario.generatedAudio.indexOf(definition), 1);
  }
});

test("生成音声定義がない作品ではjobを読み込まない", async () => {
  const definitions = workerScenario.generatedAudio.splice(0);
  let reads = 0;
  try {
    const states = await publicGeneratedAudioStates({
      async generatedAudioJobs() { reads += 1; return []; }
    }, "player-1", {});
    assert.deepEqual(states, []);
    assert.equal(reads, 0);
  } finally {
    workerScenario.generatedAudio.push(...definitions);
  }
});

test("LLM providerは一時的なHTTP障害だけを1回再試行する", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("busy", { status: 503 });
    return Response.json({ choices: [{ message: { content: '{"selected":"ok"}' } }] });
  };
  try {
    const provider = createStructuredOutputProvider({ LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });
    const result = await provider.completeJson({
      taskId: "retry_test",
      instructions: "JSONで返してください。",
      input: { message: "test" },
      schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
    });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM providerは一時的な通信例外を1回再試行する", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network unavailable");
    return Response.json({ choices: [{ message: { content: '{"selected":"ok"}' } }] });
  };
  try {
    const provider = createStructuredOutputProvider({ LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });
    const result = await provider.completeJson({
      taskId: "network_retry_test",
      instructions: "JSONで返してください。",
      input: {},
      schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
    });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM providerは入力不備に相当するHTTP 4xxを再試行しない", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("bad request", { status: 400 });
  };
  try {
    const provider = createStructuredOutputProvider({ LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });
    const result = await provider.completeJson({
      taskId: "no_retry_test",
      instructions: "JSONで返してください。",
      input: {},
      schema: { type: "object", properties: {}, additionalProperties: false }
    });
    assert.deepEqual(result, { ok: false, error: "provider_error", httpStatus: 400 });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM providerは壊れた成功応答を再試行しない", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("not-json", { status: 200 });
  };
  try {
    const provider = createStructuredOutputProvider({ LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });
    const result = await provider.completeJson({
      taskId: "invalid_response_test",
      instructions: "JSONで返してください。",
      input: {},
      schema: { type: "object", properties: {}, additionalProperties: false }
    });
    assert.deepEqual(result, { ok: false, error: "invalid_response" });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM providerは会話エンジンのtemperatureと任意の推論強度を送る", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return Response.json({ choices: [{ message: { content: '{"selected":"ok"}' } }] });
  };
  try {
    const provider = createStructuredOutputProvider({
      LLM_API_KEY: "test-key",
      LLM_MODEL: "test-model",
      LLM_REASONING_EFFORT: "low"
    });
    const result = await provider.completeJson({
      taskId: "request_options_test",
      instructions: "JSONで返してください。",
      input: {},
      temperature: 0,
      model: "profile-model",
      reasoningEffort: "medium",
      timeoutMs: 60_000,
      schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
    });
    assert.equal(result.ok, true);
    assert.equal(requestBody.temperature, 0);
    assert.equal(requestBody.model, "profile-model");
    assert.equal(requestBody.reasoning_effort, "medium");
    assert.equal(requestBody.max_completion_tokens, 2_048);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM providerはGemini系だけ安全な既定推論強度を補う", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init.body)));
    return Response.json({ choices: [{ message: { content: '{"selected":"ok"}' } }] });
  };
  try {
    for (const model of ["gemini-2.5-flash", "gemini-3-flash", "gemini-3.1-flash-lite", "other-model"]) {
      const provider = createStructuredOutputProvider({ LLM_API_KEY: "test-key", LLM_MODEL: model });
      const result = await provider.completeJson({
        taskId: "gemini_default_reasoning_test",
        instructions: "JSONで返してください。",
        input: {},
        maxTokens: 512,
        schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
      });
      assert.equal(result.ok, true);
    }
    const configured = createStructuredOutputProvider({
      LLM_API_KEY: "test-key",
      LLM_MODEL: "gemini-3-flash",
      LLM_REASONING_EFFORT: "low"
    });
    const configuredResult = await configured.completeJson({
      taskId: "gemini_configured_reasoning_test",
      instructions: "JSONで返してください。",
      input: {},
      maxTokens: 512,
      schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
    });
    assert.equal(configuredResult.ok, true);
    assert.deepEqual(requestBodies.map((body) => [body.model, body.reasoning_effort, body.max_completion_tokens]), [
      ["gemini-2.5-flash", "none", 512],
      ["gemini-3-flash", "minimal", 1_024],
      ["gemini-3.1-flash-lite", "none", 512],
      ["other-model", undefined, 512],
      ["gemini-3-flash", "low", 1_024]
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("match抽出は作者task IDに依存せず推論token下限を確保する", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init.body)));
    return Response.json({ choices: [{ message: { content: '{"selected":"ok"}' } }] });
  };
  try {
    const provider = createStructuredOutputProvider({ LLM_API_KEY: "test-key", LLM_MODEL: "default-model" });
    for (const [model, reasoningEffort] of [
      ["super-model", "medium"],
      ["ultra-model", "medium"],
      ["super-model", "high"],
      ["ultra-model", "high"]
    ]) {
      const result = await provider.completeJson({
        taskId: `作者が決めた_${model}`,
        operation: "match_extraction",
        instructions: "JSONで返してください。",
        input: {},
        model,
        reasoningEffort,
        maxTokens: 512,
        schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
      });
      assert.equal(result.ok, true);
    }
    assert.deepEqual(requestBodies.map((body) => [body.model, body.max_completion_tokens]), [
      ["super-model", 4_096],
      ["ultra-model", 4_096],
      ["super-model", 8_192],
      ["ultra-model", 8_192]
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM観測は通常logへ本文を出さずdebug時にもsecretを出さない", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  globalThis.fetch = async () => Response.json({
    choices: [{ message: { content: '{"selected":"ok"}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 3 } }
  });
  console.log = (value) => logs.push(String(value));
  const request = {
    taskId: "analytics_test",
    instructions: "秘密の指示",
    input: { message: "秘密本文" },
    schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
  };
  try {
    const usageProvider = createStructuredOutputProvider({
      LLM_API_KEY: "super-secret-key",
      LLM_MODEL: "test-model",
      LLM_ANALYTICS_ENABLED: "true"
    });
    await usageProvider.completeJson(request);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"event":"llm_usage"/u);
    assert.doesNotMatch(logs[0], /秘密本文|秘密の指示|super-secret-key/u);
    assert.match(logs[0], /"cachedTokens":3/u);

    logs.length = 0;
    const debugProvider = createStructuredOutputProvider({
      LLM_API_KEY: "super-secret-key",
      LLM_MODEL: "test-model",
      LLM_DEBUG_LOGS: "true"
    });
    await debugProvider.completeJson(request);
    assert.match(logs.join("\n"), /秘密本文/u);
    assert.doesNotMatch(logs.join("\n"), /super-secret-key/u);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});
