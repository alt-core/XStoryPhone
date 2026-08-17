import assert from "node:assert/strict";
import test from "node:test";
import { projectGeneratedAudioProviders } from "../src/project/generatedAudioProviders.ts";
import { workerScenario } from "../src/worker/scenario.ts";
import { publicGeneratedAudioStates } from "../src/worker/services/generatedAudio.ts";
import { createStructuredOutputProvider } from "../src/worker/providers/structuredOutput.ts";

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
    outputKey: null,
    status: "running",
    errorCode: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    completedAt: null
  };
  const saved = [];
  const store = {
    async pendingGeneratedAudioJobs() { return [job]; },
    async generatedAudioJobs() { return [job]; },
    async saveGeneratedAudioJob(_playerId, next) { saved.push(next); }
  };

  workerScenario.generatedAudio.push(definition);
  projectGeneratedAudioProviders.push(provider);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const states = await publicGeneratedAudioStates(store, "player-1");
    assert.equal(states.find((item) => item.id === definition.publicId)?.status, "running");
    assert.deepEqual(saved, []);
  } finally {
    console.error = originalConsoleError;
    projectGeneratedAudioProviders.splice(projectGeneratedAudioProviders.indexOf(provider), 1);
    workerScenario.generatedAudio.splice(workerScenario.generatedAudio.indexOf(definition), 1);
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
    assert.deepEqual(result, { ok: false, error: "provider_error" });
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
      schema: { type: "object", properties: { selected: { type: "string" } }, required: ["selected"], additionalProperties: false }
    });
    assert.equal(result.ok, true);
    assert.equal(requestBody.temperature, 0);
    assert.equal(requestBody.reasoning_effort, "low");
    assert.equal(requestBody.max_completion_tokens, 1_024);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
