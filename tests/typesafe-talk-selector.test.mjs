import assert from "node:assert/strict";
import test from "node:test";
import { runTalkCase, runTalkCases } from "../scripts/lib/talk-case-runner.mjs";
import { buildTypesafeTalkRuleRequest, typesafeTalkRuleDecision } from "../src/worker/product/talkFlowTypesafeSelection.ts";
import { requestTypesafeSystemOne, resolveTypesafeConfig } from "../src/worker/providers/typesafe.ts";
import { typesafeRuleSelector } from "../src/worker/services/conversationLlm.ts";
import { createTalkRuleSelector, resolveScenarioTalkRule, talkRuleSelectorKind } from "../src/worker/services/talkResolver.ts";

const env = { LLM_TALK_SELECTOR: "typesafe", TYPESAFE_API_KEY: "typesafe-secret-key" };
const baseRule = {
  order: 1, from: "start", isDefault: false, cond: "", intent: "", type: "ai", criteria: "", match: "",
  nextBlocks: ["start"], set: [], mode: "", notes: "", example: ""
};
const rules = [
  { ...baseRule, id: "agree", intent: "同意", criteria: "提案に同意した" },
  { ...baseRule, id: "end", order: 2, intent: "終了", criteria: "会話の終了を明言した", mode: "game_over" },
  { ...baseRule, id: "default", order: 3, isDefault: true, type: "default", criteria: "相手は返事を待っている", mode: "stay" }
];
const selectorInput = {
  playerInput: "いいよ",
  rules: rules.map(({ id, from, criteria, intent, mode, isDefault }) => ({ id, from, criteria, intent, mode, isDefault })),
  defaultRuleId: "default",
  recentMessages: [{ speaker: "案内役", body: "  一緒に  行きますか？ " }]
};
const promptInput = { talkId: "talk", kind: "sms", fromId: "start", ...selectorInput };

function answer(choice, confidence, probabilities = { agree: 0, end: 0, default: 0, [choice]: confidence }) {
  return { model: "jev-1.13.0", answers: { rule: { type: "choice", choice, confidence, probabilities } }, usage: { input_tokens: 321, output_tokens: 20 } };
}

async function withFetch(responses, run) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    const next = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : Response.json(next);
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Jevのrequestは候補をChoiceの選択肢にし、defaultを「どれでもない」として渡す", () => {
  const request = buildTypesafeTalkRuleRequest(promptInput, "jev-1.13.0");
  assert.equal(request.model, "jev-1.13.0");
  assert.deepEqual(request.state, {
    context: "相手は返事を待っている",
    recent_messages: [{ speaker: "案内役", body: "一緒に 行きますか？" }],
    player_input: "いいよ"
  });
  assert.equal(request.questions.rule.type, "choice");
  assert.deepEqual(Object.keys(request.questions.rule.criteria), ["agree", "end", "default"]);
  assert.deepEqual(request.questions.rule.criteria.agree, { intent: "同意", criteria: "提案に同意した" });
  assert.match(request.questions.rule.criteria.default, /None of the other candidates/u);
  assert.match(request.questions.rule.instructions.question, /`player_input`/u);
});

test("Jevの応答は候補内のchoiceと0〜1のconfidenceだけを有効とし、reason_codeはdefaultかどうかを表す", () => {
  assert.deepEqual(typesafeTalkRuleDecision(answer("agree", 0.8, { agree: 0.8, end: 0.05, default: 0.15, unknown: 1 }), promptInput), {
    decision: { rule_id: "agree", confidence: 0.8, reason_code: "matched_intent" },
    probabilities: { agree: 0.8, end: 0.05, default: 0.15 },
    model: "jev-1.13.0",
    inputTokens: 321
  });
  assert.equal(typesafeTalkRuleDecision(answer("agree", 0.5), promptInput).decision.reason_code, "matched_intent");
  assert.equal(typesafeTalkRuleDecision(answer("default", 0.9), promptInput).decision.reason_code, "default_unclear");
  for (const invalid of [
    answer("missing", 0.9),
    answer("agree", 1.2),
    answer("agree", Number.NaN),
    answer("end", 1, {}),
    answer("end", 1, { end: 1, default: 0 }),
    answer("end", 1, { agree: 0, end: -2, default: 3 }),
    answer("end", 1, { agree: 0, end: 0, default: 1 }),
    { answers: { rule: { type: "noul", noul: 1 } } },
    { answers: { rule: { type: "choice", choice: "agree", confidence: 0.9 } } },
    { answers: {} },
    null
  ]) {
    assert.equal(typesafeTalkRuleDecision(invalid, promptInput), null);
  }
});

test("Jev selectorは既存の閾値関数でdefault退避とgame over抑止を行い、監修用に分布を残す", async () => {
  await withFetch([answer("agree", 0.8, { agree: 0.8, end: 0, default: 0.2 })], async (requests) => {
    const selected = await typesafeRuleSelector(env)(selectorInput);
    assert.equal(selected.ok, true);
    assert.equal(selected.ruleId, "agree");
    assert.equal(selected.reviewSelection.selector, "typesafe");
    assert.equal(selected.reviewSelection.model, "jev-1.13.0");
    assert.deepEqual(selected.reviewSelection.probabilities, { agree: 0.8, end: 0, default: 0.2 });
    assert.match(selected.reviewSelection.schemaHash, /^[0-9a-f]{64}$/u);
    assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(requests[0].init.headers.authorization, "Bearer typesafe-secret-key");
    assert.equal(requests[0].body.model, "jev-1.13.0");
  });
  await withFetch([answer("agree", 0.6)], async () => {
    const selected = await typesafeRuleSelector(env)(selectorInput);
    assert.equal(selected.ruleId, "default");
    assert.equal(selected.reviewSelection.fallbackReason, "low_confidence");
  });
  await withFetch([answer("end", 0.85)], async () => {
    const selected = await typesafeRuleSelector(env)(selectorInput);
    assert.equal(selected.ruleId, "default");
    assert.equal(selected.reviewSelection.fallbackReason, "low_game_over_confidence");
  });
  await withFetch([answer("end", 0.85)], async (requests) => {
    const tuned = { ...env, TYPESAFE_MODEL: "jev-1.14.0", TYPESAFE_MIN_CONFIDENCE: "0.5", TYPESAFE_GAME_OVER_MIN_CONFIDENCE: "0.8" };
    const selected = await typesafeRuleSelector(tuned)(selectorInput);
    assert.equal(selected.ruleId, "end");
    assert.equal(requests[0].body.model, "jev-1.14.0");
  });
});

test("Jevの通信は一時的な失敗だけ1回再試行し、認証や入力の誤りは再試行しない", async () => {
  for (const [first, calls] of [
    [new Response("busy", { status: 429 }), 2],
    [new Response("overloaded", { status: 529 }), 2],
    [new TypeError("network unavailable"), 2],
    [new Response("unauthorized", { status: 401 }), 1],
    [new Response("invalid", { status: 422 }), 1]
  ]) {
    await withFetch([first, answer("agree", 0.9)], async (requests) => {
      const selected = await typesafeRuleSelector(env)(selectorInput);
      assert.equal(requests.length, calls);
      assert.deepEqual(calls === 2 ? selected.ok : selected, calls === 2 ? true : { ok: false, error: "provider_error", httpStatus: first.status });
    });
  }
  await withFetch([new Response("unauthorized", { status: 401 })], async () => {
    const config = resolveTypesafeConfig(env);
    assert.deepEqual(await requestTypesafeSystemOne(config, { model: config.model }), { ok: false, error: "provider_error", httpStatus: 401 });
  });
  await withFetch([new Response("not json", { status: 200 })], async (requests) => {
    assert.deepEqual(await typesafeRuleSelector(env)(selectorInput), { ok: false, error: "provider_invalid" });
    assert.equal(requests.length, 1);
  });
  await withFetch([answer("missing", 0.9)], async () => {
    assert.deepEqual(await typesafeRuleSelector(env)(selectorInput), { ok: false, error: "provider_invalid" });
  });
});

test("Jevの1試行は本文の受信中も10秒で打ち切り、2回とも失敗ならprovider_errorにする", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 10_000 ? 1 : 0, ...args);
    for (const waitBody of [false, true]) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls += 1;
        const aborted = () => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true }));
        return waitBody ? { ok: true, status: 200, json: aborted } : aborted();
      };
      const config = resolveTypesafeConfig(env);
      assert.deepEqual(await requestTypesafeSystemOne(config, { model: config.model }), { ok: false, error: "provider_error" });
      assert.equal(calls, 2);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
  }
});

test("Jevのlogは既存のLLM用変数に従い、API keyを出さない", async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  try {
    await withFetch([answer("agree", 0.9)], async () => {
      await typesafeRuleSelector({ ...env, LLM_ANALYTICS_ENABLED: "true", LLM_DEBUG_LOGS: "true" })(selectorInput);
    });
  } finally {
    console.log = originalLog;
  }
  const events = lines.map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.event), ["llm_usage", "llm_debug", "llm_result"]);
  assert.equal(events[0].provider, "typesafe");
  assert.equal(events[0].usage.inputTokens, 321);
  assert.equal(events[0].inputHash.length, 12);
  assert.equal(lines.some((line) => line.includes("typesafe-secret-key")), false);
});

test("Jevの設定誤りは通信せずprovider_unavailableにし、既存LLMへ戻さない", async () => {
  const originalError = console.error;
  const errors = [];
  console.error = (line) => errors.push(String(line));
  try {
    await withFetch([answer("agree", 0.9)], async (requests) => {
      for (const invalid of [
        { LLM_TALK_SELECTOR: "typesafe" },
        { ...env, TYPESAFE_MIN_CONFIDENCE: "high" },
        { ...env, TYPESAFE_MIN_CONFIDENCE: "1.5" },
        { ...env, TYPESAFE_MIN_CONFIDENCE: "0.8", TYPESAFE_GAME_OVER_MIN_CONFIDENCE: "0.7" }
      ]) {
        assert.equal(resolveTypesafeConfig(invalid).ok, false);
        assert.deepEqual(await typesafeRuleSelector(invalid)(selectorInput), { ok: false, error: "provider_unavailable" });
      }
      assert.equal(talkRuleSelectorKind({}), "openai-compatible");
      assert.equal(talkRuleSelectorKind(env), "typesafe");
      assert.equal(talkRuleSelectorKind({ LLM_TALK_SELECTOR: "typesfae" }), null);
      const provider = { id: "fake", async completeJson() { assert.fail("未知のselectorで既存LLMを呼ばない"); } };
      const unknown = createTalkRuleSelector({ LLM_TALK_SELECTOR: "jev" }, provider, { talkId: "talk", kind: "sms", fromId: "start" });
      assert.deepEqual(await unknown(selectorInput), { ok: false, error: "provider_unavailable" });
      assert.equal(requests.length, 0);
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 5);
  assert.equal(errors.some((line) => line.includes("typesafe-secret-key")), false);
});

test("既定のselectorは既存LLM経路だけを使い、typesafeはLLM_API_KEYなしでもrule選択できる", async () => {
  const talk = { id: "talk", publicId: "public", kind: "sms", appId: "messages", label: "会話", cond: "", startBlocks: ["start"], initialFrom: "start", rules };
  const input = { llmEnabled: true, talk, from: "start", playerInput: "photo:abc", semanticPlayerInput: "写真: 駅の看板", stateValues: {} };
  let providerCalls = 0;
  const provider = { id: "fake", async completeJson() {
    providerCalls += 1;
    return { ok: true, value: { rule_id: "agree", confidence: 0.9, reason_code: "matched_intent" }, raw: "{}" };
  } };
  await withFetch([answer("agree", 0.9)], async (requests) => {
    const legacy = await resolveScenarioTalkRule({ ...input, env: {}, provider });
    assert.equal(legacy.ok && legacy.rule.id, "agree");
    assert.equal(providerCalls, 1);
    assert.equal(requests.length, 0);

    const typesafe = await resolveScenarioTalkRule({ ...input, env });
    assert.equal(typesafe.ok && typesafe.rule.id, "agree");
    assert.equal(typesafe.reviewSelection.selector, "typesafe");
    assert.equal(requests[0].body.state.player_input, "写真: 駅の看板");
    assert.equal(providerCalls, 1);
  });
  const extractingTalk = { ...talk, rules: rules.map((rule) => rule.id === "agree" ? { ...rule, match: '{"place":"行き先"}' } : rule) };
  await withFetch([answer("agree", 0.9)], async () => {
    const extracted = await resolveScenarioTalkRule({ ...input, talk: extractingTalk, env });
    assert.deepEqual(extracted, { ok: false, error: "provider_unavailable" });
  });
});

test("会話caseのlive実行はtypesafeならLLM providerなしで動き、選択回数をselector単位で数える", async () => {
  const scenario = {
    features: { llm: true }, stateVariables: {},
    talkPeople: [{ id: "guide", name: "案内役", role: "npc" }],
    talkBlocks: [{ id: "guide::start", messages: [{ sender: "guide", body: "行きますか？" }] }],
    talks: [{ id: "guide", kind: "sms", rules: rules.map((rule) => ({
      ...rule, id: `guide_${rule.id}`, from: "guide::start", outputSteps: [], nextFromId: "guide::start"
    })) }]
  };
  await withFetch([answer("guide_agree", 0.9, { guide_agree: 0.9, guide_end: 0, guide_default: 0.1 })], async (requests) => {
    const result = await runTalkCase(scenario, { id: "agree", talkId: "guide", from: "start", input: "いいよ", expectedRuleId: "guide_agree" }, { live: true, provider: null, env });
    assert.equal(result.ruleId, "guide_agree");
    assert.equal(result.selectionCalls, 1);
    assert.equal(result.extractionCalls, 0);
    assert.equal(requests.length, 1);
  });
  await withFetch([answer("guide_agree", 0.9, { guide_agree: 0.9, guide_end: 0, guide_default: 0.1 })], async (requests) => {
    const result = await runTalkCase(scenario, { id: "mock", talkId: "guide", from: "start", input: "いいよ", expectedRuleId: "guide_agree" }, { live: false, env });
    assert.equal(result.ruleId, "guide_agree");
    assert.equal(result.selectionCalls, 1);
    assert.equal(requests.length, 0);
  });
});

test("選択だけのlive評価は抽出ruleでもJev以外を呼ばず、不一致時にモデルと分布を残す", async () => {
  const scenario = {
    features: { llm: true }, stateVariables: {}, talkPeople: [], talkBlocks: [],
    talks: [{ id: "guide", kind: "sms", rules: rules.map((rule) => ({
      ...rule, from: "guide::start", match: rule.id === "agree" ? '{"name":"名乗った名前"}' : "",
      outputSteps: [], nextFromId: "guide::start"
    })) }]
  };
  const fixture = { id: "agree", talkId: "guide", from: "start", input: "いいよ", expectedIntent: "同意" };
  await withFetch([answer("agree", 0.9)], async (requests) => {
    const result = await runTalkCase(scenario, fixture, { live: true, selectionOnly: true, env });
    assert.equal(result.actual.ruleId, "agree");
    assert.equal(result.extractionCalls, 0);
    assert.equal(result.reviewSelection.model, "jev-1.13.0");
    assert.equal(requests.length, 1);
  });
  await withFetch([answer("agree", 0.5)], async (requests) => {
    const result = await runTalkCases(scenario, [fixture], { live: true, selectionOnly: true, env });
    const failure = result.failures[0];
    assert.equal(failure.actual.ruleId, "default");
    assert.equal(failure.reviewSelection.selectedRuleId, "agree");
    assert.equal(failure.reviewSelection.fallbackReason, "low_confidence");
    assert.equal(failure.reviewSelection.model, "jev-1.13.0");
    assert.equal(failure.reviewSelection.probabilities.agree, 0.5);
    assert.equal(requests.length, 1);
  });
});

test("Jevのcase評価は401/403で後続caseを止め、ほかのHTTP失敗とは区別する", async () => {
  const scenario = {
    features: { llm: true }, stateVariables: {}, talkPeople: [], talkBlocks: [],
    talks: [{ id: "guide", kind: "sms", rules: rules.map(rule => ({ ...rule, from: "guide::start" })) }]
  };
  const cases = [1, 2].map(id => ({ id: String(id), talkId: "guide", from: "start", input: "いいよ", expectedRuleId: "agree" }));
  for (const selectionOnly of [false, true]) {
    for (const status of [401, 403, 422]) {
      await withFetch([new Response("denied", { status })], async requests => {
        const result = await runTalkCases(scenario, cases, { live: true, selectionOnly, env });
        const attempted = status === 422 ? 2 : 1;
        assert.equal(requests.length, attempted);
        assert.equal(result.summary.planned, 2);
        assert.equal(result.summary.attempted, attempted);
        assert.equal(result.results.length, 0);
        assert.equal(result.failures.length, attempted);
        assert.equal(result.failures[0].httpStatus, status);
        assert.equal(result.failures[0].errorCode, "provider_error");
        assert.equal(result.failures[0].failureStage, "selection");
      });
    }
  }
});
