import assert from "node:assert/strict";
import { resolveScenarioTalkRule } from "../../src/worker/services/talkResolver.ts";
import { talkTestContext } from "./talk-test-context.mjs";

// 本編は生成済みscenarioを使い、fixtureには一入力の開始条件と期待値だけを置く。
export async function runTalkCase(scenario, fixture, { provider = null, live = false, env = {} } = {}) {
  assert.ok(fixture && typeof fixture === "object", "caseはobjectにしてください。");
  const fields = new Set(["id", "talkId", "from", "input", "stateValues", "recentMessages", "semanticPlayerInput", "expectedRuleId", "expectedMatch", "mockSelection", "mockExtractions"]);
  for (const key of Object.keys(fixture)) assert.ok(fields.has(key), `未対応のcase項目です: ${key}`);
  for (const field of ["id", "talkId", "from", "input", "expectedRuleId"]) {
    assert.ok(typeof fixture[field] === "string" && fixture[field].trim(), `case.${field}が必要です。`);
  }
  for (const field of ["stateValues", "expectedMatch"]) {
    if (fixture[field] === undefined) continue;
    assert.ok(fixture[field] && typeof fixture[field] === "object" && !Array.isArray(fixture[field]), `case.${field}はobjectにしてください。`);
  }
  for (const [key, value] of Object.entries(fixture.stateValues ?? {})) {
    assert.ok(Object.hasOwn(scenario.stateVariables, key), `${fixture.id}: 未定義のstateです: ${key}`);
    assert.ok(["string", "number", "boolean"].includes(typeof value), `${fixture.id}: state値は文字列・数値・booleanにしてください。`);
  }
  assert.ok(Object.values(fixture.expectedMatch ?? {}).every((value) => typeof value === "string"), "expectedMatchは文字列のobjectです。値なしの項目は省略してください。");
  if (fixture.recentMessages !== undefined) {
    assert.ok(Array.isArray(fixture.recentMessages) && fixture.recentMessages.every((item) => item && typeof item.speaker === "string" && typeof item.body === "string"), "recentMessagesはspeaker/bodyの配列にしてください。");
  }
  if (fixture.mockExtractions !== undefined) assert.ok(Array.isArray(fixture.mockExtractions) && fixture.mockExtractions.length, "mockExtractionsは1件以上の配列にしてください。");
  if (fixture.semanticPlayerInput !== undefined) assert.equal(typeof fixture.semanticPlayerInput, "string", "semanticPlayerInputは文字列にしてください。");
  const talk = scenario.talks.find((item) => item.id === fixture.talkId);
  assert.ok(talk, `${fixture.id}: talkが存在しません。`);
  const from = fixture.from.includes("::") ? fixture.from : `${talk.id}::${fixture.from}`;
  const expected = talk.rules.find((rule) => rule.id === fixture.expectedRuleId);
  assert.ok(expected, `${fixture.id}: 期待する分岐IDが存在しません。`);
  assert.ok(talk.rules.some((rule) => rule.from === from), `${fixture.id}: fromが存在しません。`);
  const { stateValues, recentMessages } = talkTestContext(scenario, fixture);
  let extractionIndex = 0;
  const mock = {
    id: "case-fixture",
    async completeJson(request) {
      if (request.operation === "match_extraction") {
        const samples = fixture.mockExtractions ?? (fixture.expectedMatch ? [fixture.expectedMatch] : []);
        assert.ok(samples.length, `${fixture.id}: mockExtractionsまたはexpectedMatchが必要です。`);
        const value = samples[Math.min(extractionIndex++, samples.length - 1)];
        return { ok: true, value, raw: JSON.stringify(value) };
      }
      const value = fixture.mockSelection ?? {
        rule_id: expected.id,
        confidence: expected.mode === "game_over" ? 0.98 : 0.86,
        reason_code: expected.isDefault ? "default_unclear" : "matched_intent"
      };
      return { ok: true, value, raw: JSON.stringify(value) };
    }
  };
  if (live) assert.ok(provider, "live実行にはLLM provider設定が必要です。");
  let selectionCalls = 0;
  let extractionCalls = 0;
  const backend = live ? provider : mock;
  const observedProvider = {
    id: backend.id,
    completeJson(request) {
      if (request.operation === "match_extraction") extractionCalls += 1;
      else selectionCalls += 1;
      return backend.completeJson(request);
    },
    observeResult(result, debug) { backend.observeResult?.(result, debug); }
  };
  const selected = await resolveScenarioTalkRule({
    env,
    llmEnabled: scenario.features.llm,
    provider: observedProvider,
    talk,
    from,
    playerInput: fixture.input,
    ...(fixture.semanticPlayerInput ? { semanticPlayerInput: fixture.semanticPlayerInput } : {}),
    stateValues,
    recentMessages
  });
  assert.equal(selected.ok, true, `${fixture.id}: ${selected.error ?? "選択失敗"}`);
  assert.equal(selected.rule.id, fixture.expectedRuleId, `${fixture.id}: 分岐IDが期待と違います。`);
  if (fixture.expectedMatch !== undefined) {
    assert.deepEqual(selected.matchGroups, fixture.expectedMatch, `${fixture.id}: 抽出値が期待と違います。`);
  }
  return {
    id: fixture.id,
    talkId: talk.id,
    from,
    ruleId: selected.rule.id,
    source: selected.source,
    match: selected.matchGroups,
    mode: selected.rule.mode || "advance",
    selectionCalls,
    extractionCalls
  };
}

export async function runTalkCases(scenario, cases, options = {}) {
  assert.ok(Array.isArray(cases) && cases.length > 0, "casesには1件以上のcaseが必要です。");
  const ids = new Set();
  for (const item of cases) {
    assert.ok(item?.id && !ids.has(item.id), "case.idが空または重複しています。");
    ids.add(item.id);
  }
  const results = [];
  const failures = [];
  for (const item of cases) {
    try {
      results.push(await runTalkCase(scenario, item, options));
    } catch (error) {
      failures.push({ id: item.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, failures };
}
