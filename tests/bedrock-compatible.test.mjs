import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createStructuredOutputProvider } from "../src/worker/providers/structuredOutput.ts";
import { resolveHookLlmProfile } from "../src/worker/product/llmProfiles.ts";
import { talkFlowLlmResponseSchema } from "../src/worker/product/talkFlowLlmSelection.ts";
import { runTalkCases } from "../scripts/lib/talk-case-runner.mjs";
import { parseTsv } from "../scripts/lib/tsv-utils.mjs";

const baseUrl = "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1";
const request = {
  taskId: "connection_test", instructions: "指定形式のJSONで判定してください。", input: { text: "はい" },
  schema: talkFlowLlmResponseSchema(["accept", "default"]), temperature: 0, maxTokens: 512
};

test("Bedrockの3モデルを既存のBearer認証・Schema付きChat Completionsで指定できる", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, baseUrl + "/chat/completions");
    assert.equal(init.headers.authorization, "Bearer test-key");
    const body = JSON.parse(init.body);
    bodies.push(body);
    return Response.json({
      model: body.model, choices: [{ message: { content: '{"rule_id":"accept","confidence":0.95,"reason_code":"matched_intent"}' } }],
      usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50, prompt_tokens_details: { cached_tokens: 10 } }
    });
  };
  try {
    for (const model of ["global.moonshotai.kimi-k3", "zai.glm-4.7-flash", "qwen.qwen3-next-80b-a3b"]) {
      const result = await createStructuredOutputProvider({ LLM_API_KEY: "test-key", LLM_MODEL: model, LLM_BASE_URL: baseUrl, LLM_REASONING_EFFORT: "omit" }).completeJson(request);
      assert.equal(result.ok, true);
      assert.equal(result.model, model);
      assert.equal(result.usage.totalTokens, 50);
      const body = bodies.at(-1);
      assert.deepEqual(body.response_format.json_schema.schema, request.schema);
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.max_completion_tokens, 512);
      assert.equal(body.reasoning_effort, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("推論強度のomitはprofileの既定値を抑え、noneは明示的な値として送る", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  };
  try {
    const env = { LLM_API_KEY: "test-key", LLM_MODEL: "test-model", LLM_REASONING_EFFORT: "high", LLM_PROFILE_SUPER_MODEL: "profile-model", LLM_PROFILE_SUPER_REASONING_EFFORT: "omit" };
    const profile = resolveHookLlmProfile(env, "super");
    assert.equal(profile.config.reasoningEffort, "omit");
    const provider = createStructuredOutputProvider(env);
    await provider.completeJson({ ...request, ...profile.config, operation: "match_extraction" });
    await provider.completeJson({ ...request, reasoningEffort: "none" });
    assert.equal(bodies[0].reasoning_effort, undefined);
    assert.equal(bodies[0].max_completion_tokens, 512);
    assert.equal(bodies[0].model, "profile-model");
    assert.equal(bodies[1].reasoning_effort, "none");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("評価側の再試行0指定を守り、認証エラー時には後続caseを呼ばない", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("busy", { status: 503 }); };
  try {
    const env = { LLM_API_KEY: "test-key", LLM_MODEL: "test-model", LLM_BASE_URL: baseUrl };
    const provider = createStructuredOutputProvider(env, { retries: 0 });
    assert.deepEqual(await provider.completeJson(request), { ok: false, error: "provider_error", httpStatus: 503 });
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("denied", { status: 403 }); };
    const rule = { id: "accept", from: "guide::start", order: 1, type: "ai", isDefault: false, intent: "承諾", criteria: "承諾した", cond: "", match: "", mode: "", outputSteps: [], nextBlocks: [], nextFromId: "guide::start", set: [] };
    const scenario = { features: { llm: true }, stateVariables: {}, talkPeople: [], talkBlocks: [], talks: [{ id: "guide", kind: "sms", rules: [
      rule, { ...rule, id: "default", order: 2, type: "default", isDefault: true, intent: "", mode: "stay" }
    ] }] };
    const cases = [1, 2].map((id) => ({ id: String(id), talkId: "guide", from: "start", input: "はい", expectedRuleId: "accept" }));
    const result = await runTalkCases(scenario, cases, { live: true, provider, env, selectionOnly: true });
    assert.equal(calls, 1);
    assert.equal(result.failures[0].httpStatus, 403);
    assert.equal(result.summary.planned, 2);
    assert.equal(result.summary.attempted, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exampleのlive評価も本番の送信項目・推論設定・認証失敗停止を使う", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-bedrock-evaluation-"));
  try {
    const scenarioDir = path.join(temporary, "scenario");
    fs.cpSync("scenario/demo", scenarioDir, { recursive: true });
    const writeRows = (file, rows) => fs.writeFileSync(file, rows.map((row) => row.map((cell) => '"' + String(cell).replaceAll('"', '""') + '"').join("\t")).join("\n") + "\n");
    const constantsFile = path.join(scenarioDir, "authoring/project_constants.tsv");
    const constants = parseTsv(fs.readFileSync(constantsFile, "utf8"));
    const keyColumn = constants[0].indexOf("key");
    constants.find((row) => row[keyColumn] === "features.llm")[constants[0].indexOf("value")] = "true";
    writeRows(constantsFile, constants);
    const flowFile = path.join(scenarioDir, "authoring/talk_flow.tsv");
    const flow = parseTsv(fs.readFileSync(flowFile, "utf8"));
    const headers = flow[0];
    const col = (name) => headers.indexOf(name);
    flow.find((row) => row[col("talk")] === "guide" && row[col("from")] === "intro" && row[col("type")] === "default")[col("example")] = "分かりません";
    const row = (values) => headers.map((name) => values[name] ?? "");
    flow.push(row({ talk: "guide", from: "intro", type: "context", text: "協力への返答を待っている。" }));
    flow.push(row({ talk: "guide", from: "intro", type: "ai", intent: "協力を承諾", text: "協力を明確に承諾した。", example: "はい、協力します", next: "message_reply", mode: "stay" }));
    writeRows(flowFile, flow);
    const capture = path.join(temporary, "requests.jsonl");
    const preload = path.join(temporary, "fetch.mjs");
    fs.writeFileSync(preload, `
      import fs from "node:fs";
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        fs.appendFileSync(process.env.BEDROCK_TEST_CAPTURE, JSON.stringify({ url, body }) + "\\n");
        if (process.env.BEDROCK_TEST_DENY === "true") return new Response("denied", { status: 403 });
        const input = JSON.parse(body.messages[1].content);
        const rule = input.candidate_rules.find((r) => input.player_input === "分かりません" ? r.default : r.intent === "協力を承諾");
        return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify({
          rule_id: rule.rule_id, confidence: 0.99, reason_code: rule.default ? "default_unclear" : "matched_intent"
        }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      };
    `);
    const env = { ...process.env, XSTORYPHONE_SCENARIO_DIR: scenarioDir, BEDROCK_TEST_CAPTURE: capture,
      LLM_TALK_SELECTOR: "openai-compatible", LLM_API_KEY: "test-key", LLM_MODEL: "test-model", LLM_BASE_URL: baseUrl,
      LLM_REASONING_EFFORT: "low", LLM_TIMEOUT_MS: "6000", LLM_DEBUG_LOGS: "false", LLM_ANALYTICS_ENABLED: "false" };
    for (const denied of [false, true]) {
      fs.writeFileSync(capture, "");
      const report = path.join(temporary, "report.json");
      const result = spawnSync(process.execPath, ["--import", preload, "scripts/scenario-llm-talk-flow-examples-test.mjs",
        "--talk=guide", "--from=intro", "--live", "--retries=0", "--report=" + report,
        "--i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation"
      ], { env: { ...env, BEDROCK_TEST_DENY: String(denied) }, encoding: "utf8" });
      assert.equal(result.status, denied ? 1 : 0, result.stderr || result.stdout);
      const requests = fs.readFileSync(capture, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      assert.equal(requests.length, denied ? 1 : 2);
      for (const { url, body } of requests) {
        assert.equal(url, baseUrl + "/chat/completions");
        assert.equal(body.reasoning_effort, "low");
        assert.equal(body.max_completion_tokens, 1024);
        assert.equal(body.max_tokens, undefined);
      }
      const data = JSON.parse(fs.readFileSync(report, "utf8"));
      assert.equal(data.configuration.endpoint, baseUrl);
      if (denied) assert.match(data.failures[0].error, /http=403/u);
      else assert.equal(data.results.filter((item) => item.model === "test-model").length, 2);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
