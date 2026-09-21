import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import {
  normalizeHookLlmRequest, normalizeHookLlmMatchRequest, resolveHookLlmRequest,
  HookLlmUnavailableError, hookLlmRequestKey, hookLlmModelVersion, hookLlmRequestHashes
} from "../src/worker/services/hookLlm.ts";
import { createStructuredOutputProvider, createFakeStructuredOutputProvider } from "../src/worker/providers/structuredOutput.ts";
import { semanticRuleSelector } from "../src/worker/services/conversationLlm.ts";
import { resolveScenarioTalkRule } from "../src/worker/services/talkResolver.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";
import { createInitialPlayerState, workerScenario } from "../src/worker/scenario.ts";
import { scenarioHookHandlers } from "../src/generated/scenarioHooks.generated.ts";
import { talkFlowRecentMessages } from "../src/worker/services/talkContext.ts";
import { createApp } from "../src/server/app.ts";

const event = { eventId: "test", playerInput: "現在入力", fields: { form_text: "明示source入力" } };
const request = (schema, extra = {}) => normalizeHookLlmRequest("extract", "task", {
  input: "入力", instructions: "指定した値を抽出する", schema, ...extra
}, event);

test("hook短縮schemaと現在unionを成功値・fallbackへ同じように適用する", async () => {
  const cases = [
    ["string_max_3", "あいう", "あいうえ"],
    ["hiragana_1_5", "たなか", "タナカ"],
    ["safe_reading_text", "あ".repeat(240), "あ".repeat(241)],
    ["integer", 3, 3.5],
    ["boolean", true, "true"],
    ["number|null", 3.5, "3.5"],
    ["string_max_3|null", null, "1234"]
  ];
  for (const [spec, valid, invalid] of cases) {
    const req = request({ value: spec });
    const good = await resolveHookLlmRequest(createFakeStructuredOutputProvider(() => ({ value: valid })), {}, req);
    assert.equal(good.status, "ready", spec);
    assert.deepEqual(good.output, { value: valid });
    const bad = await resolveHookLlmRequest(createFakeStructuredOutputProvider(() => ({ value: invalid })), {}, req);
    assert.ok(bad instanceof HookLlmUnavailableError, spec);
    assert.equal(bad.reason, "invalid_response");
    assert.throws(() => request({ value: spec }, { fallback: { value: invalid } }), /fallback/);
    const fallback = await resolveHookLlmRequest(null, {}, request({ value: spec }, { fallback: { value: valid } }));
    assert.deepEqual(fallback.output, { value: valid });
  }
  const long = "a".repeat(1_500);
  const plain = await resolveHookLlmRequest(createFakeStructuredOutputProvider(() => ({ value: long })), {}, request({ value: "string" }));
  assert.equal(plain.output.value, long, "plain stringへ旧500字制限を足さない");
  assert.throws(() => request({ value: "typo|string" }), /schemaが不正/);
  assert.throws(() => normalizeHookLlmMatchRequest("task", { match: { name: { rule: "名前", null: "no" } }, fallback: { name: null } }, event), /fallback/);
  assert.throws(() => normalizeHookLlmMatchRequest("task", { match: { name: "名前" }, mode: "typo" }, event), /mode/);
});

test("hook入力は非空input、明示source、空の順であり誤記を補完しない", () => {
  assert.equal(request({ value: "string" }, { input: "明示", source: "missing" }).input, "明示");
  assert.equal(request({ value: "string" }, { input: "", source: "player_message" }).input, "現在入力");
  assert.equal(request({ value: "string" }, { input: "", source: "form_text" }).input, "明示source入力");
  assert.equal(request({ value: "string" }, { input: "" }).input, "");
  assert.throws(() => request({ value: "string" }, { input: "", source: "missing" }), /sourceが未定義/);
  const long = "あ".repeat(3_000);
  const req = request({ value: "string" }, { input: long, instructions: long });
  assert.equal(req.input, long);
  assert.equal(req.instructions, long);
});

test("hook出力予算はschemaから見積もり、明示値を保持する", () => {
  const fields = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`field${index}`, "string"]));
  assert.equal(request(fields).maxTokens, 816);
  assert.equal(request(fields, { maxTokens: 2_000 }).maxTokens, 2_000);
  assert.equal(request({ value: "string_max_500" }).maxTokens, 816);
  assert.throws(() => request(fields, { maxTokens: NaN }), /有限/);
});

test("不正なconfidenceと候補外IDは正当な低確信fallbackと区別する", async () => {
  const rules = [
    { id: "end", from: "from", isDefault: false, intent: "終了", type: "ai", criteria: "終了", mode: "game_over" },
    { id: "default", from: "from", isDefault: true, intent: "", type: "default", criteria: "現在の場面", mode: "" }
  ];
  const input = { playerInput: "入力", rules, defaultRuleId: "default", recentMessages: [] };
  for (const decision of [
    { rule_id: "end", confidence: 1.2, reason_code: "matched_intent" },
    { rule_id: "end", confidence: -0.1, reason_code: "matched_intent" },
    { rule_id: "unknown", confidence: 0.9, reason_code: "matched_intent" }
  ]) {
    assert.deepEqual(await semanticRuleSelector(createFakeStructuredOutputProvider(() => decision))(input), { ok: false, error: "provider_invalid" });
  }
  const result = await semanticRuleSelector(createFakeStructuredOutputProvider(() => ({ rule_id: "end", confidence: 0.85, reason_code: "matched_intent" })))(input);
  assert.equal(result.ruleId, "default");
  assert.equal(result.reviewSelection.fallbackReason, "low_game_over_confidence");
  assert.equal(result.reviewSelection.decision.confidence, 0.85);
  assert.match(result.reviewSelection.inputHash, /^[0-9a-f]{64}$/);
  const changed = await semanticRuleSelector(createFakeStructuredOutputProvider(() => ({ rule_id: "end", confidence: 0.85, reason_code: "matched_intent" })))(
    { ...input, rules: [rules[0], { ...rules[1], type: "ai", criteria: "変更した場面" }] }
  );
  assert.equal(result.reviewSelection.inputHash, changed.reviewSelection.inputHash);
  assert.notEqual(result.reviewSelection.promptHash, changed.reviewSelection.promptHash, "候補/場面の変更をprompt hashが識別する");
});

test("抽出no_match後も元LLMの採択と最終default、標本数を監修へ返す", async () => {
  const common = { from: "from", order: 1, cond: "", intent: "", type: "default", criteria: "", match: "", set: [], mode: "", nextBlocks: [], outputSteps: [], nextFromId: "from", notes: "", example: "" };
  const rules = [
    { ...common, id: "choice", isDefault: false, intent: "名前", type: "ai", criteria: "名前入力", match: '{"name":"名前"}' },
    { ...common, id: "default", order: 2, isDefault: true }
  ];
  let samples = 0;
  const selected = await resolveScenarioTalkRule({
    env: {}, llmEnabled: true, talk: { id: "talk", kind: "sms", rules }, from: "from", playerInput: "入力", stateValues: {},
    provider: createFakeStructuredOutputProvider((request) => request.taskId === "talk_rule_selection"
      ? { rule_id: "choice", confidence: 0.95, reason_code: "matched_intent" }
      : { name: `不一致${++samples}` })
  });
  assert.equal(selected.rule.id, "default");
  assert.equal(selected.reviewSelection.selectedRuleId, "choice");
  assert.equal(selected.reviewSelection.finalRuleId, "default");
  assert.equal(selected.reviewSelection.accepted, false);
  assert.equal(selected.reviewSelection.decision.confidence, 0.95);
  assert.equal(selected.reviewSelection.extraction.status, "no_match");
  assert.equal(selected.reviewSelection.extraction.sampleCount, 5);
  for (const key of ["inputHash", "promptHash", "schemaHash"]) assert.match(selected.reviewSelection.extraction[key], /^[a-f0-9]{64}$/u);
});

test("regex採択後のAI抽出も観測と監修へ同じhashを返す", async () => {
  const common = { from: "from", order: 1, cond: "", intent: "", type: "default", criteria: "", match: "", set: [], mode: "", nextBlocks: [], outputSteps: [], nextFromId: "from", notes: "", example: "" };
  const rules = [
    { ...common, id: "regex-choice", isDefault: false, intent: "名前", type: "match", criteria: "/入力/u", match: '{"name":"名前"}' },
    { ...common, id: "default", order: 2, isDefault: true }
  ];
  const observations = [];
  const selected = await resolveScenarioTalkRule({
    env: {}, llmEnabled: true, talk: { id: "talk", kind: "sms", rules }, from: "from", playerInput: "入力", stateValues: {},
    provider: createFakeStructuredOutputProvider((request) => { observations.push(request.observation); return { name: "同じ名前" }; })
  });
  assert.equal(selected.source, "regex");
  assert.equal(selected.reviewSelection.extraction.status, "ready");
  assert.equal(selected.reviewSelection.extraction.sampleCount, 2);
  assert.equal(selected.reviewSelection.decision, undefined, "実行していないAI選択のdecisionは作らない");
  for (const key of ["inputHash", "promptHash", "schemaHash"]) {
    assert.match(selected.reviewSelection.extraction[key], /^[a-f0-9]{64}$/u);
    assert.ok(observations.every((item) => item[key] === selected.reviewSelection.extraction[key]));
  }
});

test("hookの5要求を完走でき、6要求目は通信前に停止しeffectを適用しない", async () => {
  const id = "test_llm_budget";
  const hook = { event: id, target: "", handler: id, cond: "", llm: true };
  workerScenario.hooks.push(hook);
  const initial = createInitialPlayerState();
  const original = structuredClone(initial);
  let calls = 0;
  const provider = createFakeStructuredOutputProvider(() => { calls++; return { ok: true }; });
  try {
    for (const [count, configured, succeeds] of [[5, undefined, true], [6, undefined, false], [6, "6", true]]) {
      calls = 0;
      scenarioHookHandlers[id] = (context) => {
        for (let i = 0; i < count; i++) {
          context.llm.extract(`step${i}`, { input: "入力", instructions: "判定", schema: { ok: "boolean" } });
          context.state.set("os_time_label", `更新${i}`);
        }
      };
      const operation = runScenarioHooks(initial, { eventId: id }, { llmProvider: provider, llmEnv: { LLM_MODEL: "fake", LLM_HOOK_MAX_REQUESTS: configured } });
      if (succeeds) await operation;
      else await assert.rejects(operation, /too_many_llm_hook_requests/);
      assert.equal(calls, succeeds ? count : 5);
      assert.deepEqual(initial, original);
    }
    scenarioHookHandlers[id] = (context) => {
      for (let i = 0; i < 8; i++) context.llm.match("same", { input: "入力", match: { value: "値" } });
    };
    calls = 0;
    await runScenarioHooks(initial, { eventId: id }, {
      llmEnv: { LLM_MODEL: "fake", LLM_HOOK_MAX_REQUESTS: "1" },
      llmProvider: createFakeStructuredOutputProvider(() => { calls++; return { value: "一致" }; })
    });
    assert.equal(calls, 2, "同じ要求の再利用とstableの2標本は要求数を増やさない");
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers[id];
  }
});

test("stayの履歴が増えてもfromの問い2件と直近2件、template捕捉と話者を維持する", () => {
  const block = workerScenario.talkBlocks[0];
  const original = block.messages;
  const owner = workerScenario.talkPeople.find((person) => person.role === "owner");
  const npc = workerScenario.talkPeople.find((person) => person.role !== "owner");
  assert.ok(owner && npc);
  block.messages = [
    { ...original[0], sender: owner.id, body: "{{name}}からの問い" },
    { ...original[0], sender: npc.id, body: "回答を待っています" }
  ];
  try {
    const result = talkFlowRecentMessages({ label: "相手" }, block.id, { name: "所有者" }, [
      { speaker: "player", body: "古いヒント要求" }, { speaker: "相手", body: "古いヒント" },
      { speaker: "player", body: "再質問" }, { speaker: "相手", body: "直近の説明" }
    ]);
    assert.deepEqual(result, [
      { speaker: "phone_owner", body: "所有者からの問い" }, { speaker: npc.name, body: "回答を待っています" },
      { speaker: "player", body: "再質問" }, { speaker: "相手", body: "直近の説明" }
    ]);
  } finally { block.messages = original; }
});

test("本文なし添付が続いてもserverとclientの文脈入口は直前の本文2件を落とさない", async () => {
  const messages = [
    { sender: "owner", body: "前の入力" }, { sender: "other", body: "直前の説明" },
    ...Array.from({ length: 4 }, () => ({ sender: "other", body: "", attachment: { kind: "image" } }))
  ];
  function loadFunction(file, name, scope) {
    const text = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    const source = file.endsWith(".svelte") ? text.match(/<script[^>]*>([\s\S]*?)<\/script>/u)[1] : text;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let declaration;
    const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); };
    visit(parsed);
    assert.ok(declaration);
    const compiled = ts.transpileModule(declaration.getText(parsed), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    return new Function(...Object.keys(scope), `${compiled}; return ${name};`)(...Object.values(scope));
  }
  const client = loadFunction("../src/client/App.svelte", "recentMessagesForTalk", {
    deviceState: { messages: [{ id: "talk", contactName: "相手", messages }], chatThreads: [] }
  });
  assert.deepEqual(client("sms", "talk").map((message) => message.body), ["前の入力", "直前の説明"]);
  const server = loadFunction("../src/server/playerApp.ts", "recentMessagesForTalk", {
    runtime: {workerScenario: { talks: [{ id: "talk", kind: "sms", label: "相手" }], stateVariables: {} }},
    talkFlowRecentMessages,
    effectiveStateValues: () => ({}), clientProgressMode: () => false,
    storeFor: () => ({ loadTranscript: async () => ({ messages: [] }) }),
    isSearchAgentTalk: () => false,
    visibleTalkMessagesForState: () => messages
  });
  const result = await server({}, { id: "player", state: { talks: { talk: { from: "" } }, stateValues: {} } }, "talk", "stream", []);
  assert.deepEqual(result.map((message) => message.body), ["前の入力", "直前の説明"]);
});

test("hook cache keyは実model・reasoning・provider有無に対応し、hashは保存とlogで一致する", async () => {
  const req = request({ value: "string" });
  const key = (env) => hookLlmRequestKey(req, hookLlmModelVersion(env, req));
  const configured = { LLM_API_KEY: "offline-placeholder", LLM_PROFILE_FAST_MODEL: "fake-A" };
  assert.notEqual(key(configured), key({ ...configured, LLM_PROFILE_FAST_MODEL: "fake-B" }));
  assert.notEqual(key(configured), key({ ...configured, LLM_REASONING_EFFORT: "high" }));
  assert.notEqual(key(configured), key({ ...configured, LLM_API_KEY: "" }));
  assert.equal(key(configured), key({ ...configured, LLM_API_KEY: "rotated-placeholder" }), "鍵そのものをcache keyへ保存しない");
  const logs = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"value":"ok"}' } }] }), { status: 200 });
  console.log = (line) => logs.push(JSON.parse(line));
  try {
    await resolveHookLlmRequest(createStructuredOutputProvider({ ...configured, LLM_ANALYTICS_ENABLED: "true" }), configured, req);
  } finally { globalThis.fetch = originalFetch; console.log = originalLog; }
  const hashes = await hookLlmRequestHashes(req);
  const usage = logs.find((line) => line.event === "llm_usage");
  const result = logs.find((line) => line.event === "llm_result");
  for (const field of ["inputHash", "promptHash", "schemaHash"]) {
    assert.equal(usage[field], hashes[field].slice(0, 12));
    assert.equal(result[field], hashes[field].slice(0, 12));
  }
  assert.ok(!JSON.stringify(logs).includes("offline-placeholder"));
});

test("実API境界でcacheは設定変更・期限を区別し、書込後の掃除失敗でも進行する", async () => {
  const id = "test_llm_cached_event";
  const hook = { event: id, target: "", handler: id, cond: "", llm: true };
  const originalMode = workerScenario.playerMode;
  const originalLlm = workerScenario.features.llm;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  workerScenario.playerMode = "server";
  workerScenario.features.llm = true;
  workerScenario.hooks.push(hook);
  workerScenario.clientCallableEvents.push(id);
  workerScenario.stateVariables.test_llm_cached_value = "";
  workerScenario.stateVariableDefinitions.test_llm_cached_value = { type: "string" };
  scenarioHookHandlers[id] = (context) => {
    const result = context.llm.extract("cache_probe", { input: "入力", instructions: "値を返す", schema: { value: "string" }, fallback: { value: "fallback" } });
    context.state.set("test_llm_cached_value", result.value);
  };
  let player = { id: "local-probe", state: createInitialPlayerState(), stateVersion: 0 };
  const cache = new Map();
  let calls = 0;
  let cleanups = 0;
  let saved;
  const store = {
    async playerForSession() { return structuredClone(player); },
    async savePlayer(expected, state) {
      assert.equal(expected.stateVersion, player.stateVersion);
      player = { ...player, state: structuredClone(state), stateVersion: player.stateVersion + 1 };
      return true;
    },
    async dueScheduledEvents() { return []; },
    async nextScheduledWakeAt() { return null; },
    async generatedAudioJobs() { return []; },
    async loadHookLlmResult(_playerId, key, at) {
      const record = cache.get(key);
      return record && record.expiresAt > at ? record : null;
    },
    async saveHookLlmResultIfAbsent(_playerId, record) { saved = record; cache.set(record.cacheKey, record); return record; },
    async cleanupExpiredHookLlmResults() { cleanups++; throw new Error("清掃だけの一時障害"); }
  };
  const env = { LLM_API_KEY: "", LLM_PROFILE_FAST_MODEL: "model-A" };
  const app = createApp({ store, config: { appEnv: "development", llm: env } });
  globalThis.fetch = async (_url, init) => {
    calls++;
    const model = JSON.parse(init.body).model;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ value: model }) } }] }), { status: 200 });
  };
  console.error = () => {};
  const send = async () => {
    const response = await app.request("http://localhost/api/scenario/event", {
      method: "POST", headers: { authorization: "Bearer local", "content-type": "application/json" }, body: JSON.stringify({ eventId: id })
    });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    return player.state.stateValues.test_llm_cached_value;
  };
  try {
    assert.equal(await send(), "fallback");
    assert.equal(calls, 0);
    env.LLM_API_KEY = "offline-placeholder";
    assert.equal(await send(), "model-A", "鍵設定の修正で過去fallbackを再利用しない");
    assert.equal(calls, 1);
    assert.equal(await send(), "model-A");
    assert.equal(calls, 1, "同設定の正常結果は再利用する");
    env.LLM_PROFILE_FAST_MODEL = "model-B";
    assert.equal(await send(), "model-B");
    assert.equal(calls, 2);
    saved.expiresAt = "2000-01-01T00:00:00.000Z";
    assert.equal(await send(), "model-B");
    assert.equal(calls, 3, "期限切れは返さない");
    assert.equal(cleanups, 4, "cache書込ごとに少量清掃を試みる");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    workerScenario.playerMode = originalMode;
    workerScenario.features.llm = originalLlm;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    workerScenario.clientCallableEvents.splice(workerScenario.clientCallableEvents.indexOf(id), 1);
    delete workerScenario.stateVariables.test_llm_cached_value;
    delete workerScenario.stateVariableDefinitions.test_llm_cached_value;
    delete scenarioHookHandlers[id];
  }
});
