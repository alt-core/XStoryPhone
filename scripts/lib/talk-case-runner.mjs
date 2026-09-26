import assert from "node:assert/strict";
import { activeTalkRules } from "../../src/shared/conversation.ts";
import { createTalkRuleSelector, resolveScenarioTalkRule, resolveScenarioTalkSelection, talkRuleSelectorKind } from "../../src/worker/services/talkResolver.ts";
import { resolveStructuredOutputConfig } from "../../src/worker/providers/structuredOutput.ts";
import { resolveTypesafeConfig } from "../../src/worker/providers/typesafe.ts";
import { talkFlowLlmDefaultThresholds } from "../../src/worker/product/talkFlowLlmSelection.ts";
import { talkTestContext } from "./talk-test-context.mjs";
import { sameRuleOutcome } from "./talk-rule-outcome.mjs";
import { matchesExpectedValue, expectedValuesForReport } from "./case-expectations.mjs";

const fields = new Set([
  "id", "talkId", "from", "input", "stateValues", "recentMessages", "semanticPlayerInput",
  "expectedRuleId", "expectedIntent", "forbiddenMode", "expectedMatch", "mockSelection", "mockExtractions"
]);
const modeOf = (rule) => rule.mode || "advance";

function prepareCase(scenario, fixture) {
  assert.ok(fixture && typeof fixture === "object" && !Array.isArray(fixture), "caseはobjectにしてください。");
  for (const key of Object.keys(fixture)) assert.ok(fields.has(key), `未対応のcase項目です: ${key}`);
  for (const field of ["id", "talkId", "from", "input"]) {
    assert.ok(typeof fixture[field] === "string" && fixture[field].trim(), `case.${field}が必要です。`);
  }
  const hasId = fixture.expectedRuleId !== undefined;
  const hasIntent = fixture.expectedIntent !== undefined;
  assert.ok(!(hasId && hasIntent), "expectedRuleIdとexpectedIntentは同時に指定できません。");
  assert.ok(hasId || hasIntent || fixture.forbiddenMode !== undefined, "expectedRuleId、expectedIntent、forbiddenModeのいずれかが必要です。");
  if (hasId) assert.ok(typeof fixture.expectedRuleId === "string" && fixture.expectedRuleId.trim(), "expectedRuleIdは空でない文字列にしてください。");
  if (fixture.forbiddenMode !== undefined) assert.ok(["advance", "stay", "game_over"].includes(fixture.forbiddenMode), "forbiddenModeはadvance/stay/game_overのいずれかにしてください。");
  for (const field of ["stateValues", "expectedMatch"]) {
    if (fixture[field] === undefined) continue;
    assert.ok(fixture[field] && typeof fixture[field] === "object" && !Array.isArray(fixture[field]), `case.${field}はobjectにしてください。`);
  }
  for (const [key, value] of Object.entries(fixture.stateValues ?? {})) {
    assert.ok(Object.hasOwn(scenario.stateVariables, key), `${fixture.id}: 未定義のstateです: ${key}`);
    assert.ok(["string", "number", "boolean"].includes(typeof value), `${fixture.id}: state値は文字列・数値・booleanにしてください。`);
  }
  assert.ok(Object.values(fixture.expectedMatch ?? {}).every((value) => typeof value === "string" || value instanceof RegExp), "expectedMatchは文字列またはRegExpのobjectです。値なしの項目は省略してください。");
  if (fixture.recentMessages !== undefined) {
    assert.ok(Array.isArray(fixture.recentMessages) && fixture.recentMessages.every((item) => item && typeof item.speaker === "string" && typeof item.body === "string"), "recentMessagesはspeaker/bodyの配列にしてください。");
  }
  if (fixture.mockExtractions !== undefined) assert.ok(Array.isArray(fixture.mockExtractions) && fixture.mockExtractions.length, "mockExtractionsは1件以上の配列にしてください。");
  if (fixture.semanticPlayerInput !== undefined) assert.equal(typeof fixture.semanticPlayerInput, "string", "semanticPlayerInputは文字列にしてください。");
  const talk = scenario.talks.find((item) => item.id === fixture.talkId);
  assert.ok(talk, `${fixture.id}: talkが存在しません。`);
  const from = fixture.from.includes("::") ? fixture.from : `${talk.id}::${fixture.from}`;
  assert.ok(talk.rules.some((rule) => rule.from === from), `${fixture.id}: fromが存在しません。`);
  const { stateValues, recentMessages } = talkTestContext(scenario, fixture);
  const activeRules = activeTalkRules({ rules: talk.rules, from, playerInput: fixture.input, stateValues });
  let expected = [];
  if (hasId) {
    expected = activeRules.filter((rule) => rule.id === fixture.expectedRuleId);
    assert.ok(expected.length, `${fixture.id}: 期待する分岐IDが有効な候補に存在しません。`);
  } else if (hasIntent) {
    const intents = Array.isArray(fixture.expectedIntent) ? fixture.expectedIntent : [fixture.expectedIntent];
    assert.ok(intents.length && intents.every((intent) => typeof intent === "string" && intent.trim()), "expectedIntentは空でない文字列またはその配列にしてください。");
    assert.equal(new Set(intents).size, intents.length, "expectedIntentが重複しています。");
    expected = intents.flatMap((intent) => {
      const matches = activeRules.filter((rule) => intent === "default"
        ? rule.isDefault && rule.from === from : !rule.isDefault && rule.intent === intent);
      assert.ok(matches.length, `${fixture.id}: 期待する意図が有効な候補に存在しません: ${intent}`);
      assert.ok(matches.every((rule) => sameRuleOutcome(matches[0], rule)), `${fixture.id}: 同じ意図に結果の異なる分岐があります: ${intent}`);
      return matches;
    });
  }
  assert.ok(!expected.some((rule) => modeOf(rule) === fixture.forbiddenMode), "期待する分岐がforbiddenModeと矛盾しています。");
  return { talk, from, stateValues, recentMessages, expected };
}

// 設定を丸ごと保存せず、比較に必要な項目だけを記録する。認証情報は含めない。
export function talkCaseEvaluationConfig({ live = false, env = {} } = {}) {
  if (!live) return { selector: "mock" };
  const selector = talkRuleSelectorKind(env);
  if (selector === "typesafe") {
    const config = resolveTypesafeConfig(env);
    return config.ok
      ? { selector, model: config.model, thresholds: { minConfidence: config.minConfidence, minGameOverConfidence: config.minGameOverConfidence } }
      : { selector, configurationError: config.reason };
  }
  if (selector === null) return { selector: "invalid" };
  const config = resolveStructuredOutputConfig(env);
  let endpoint;
  try {
    const url = new URL(config.baseUrl);
    endpoint = url.origin + url.pathname;
  } catch {
    // 不正な接続先は実行結果に残す。認証情報を含み得る入力値はreportへ転記しない。
  }
  return { selector, endpoint, model: config.model, reasoningEffort: config.reasoningEffort, timeoutMs: config.timeoutMs, thresholds: { ...talkFlowLlmDefaultThresholds } };
}

function actualSelection(selected) {
  return {
    ruleId: selected.rule.id,
    intent: selected.rule.isDefault ? "default" : selected.rule.intent,
    mode: modeOf(selected.rule),
    source: selected.source
  };
}

// 本編は生成済みscenarioを使い、fixtureには一入力の開始条件と期待値だけを置く。
export async function runTalkCase(scenario, fixture, { provider = null, live = false, env = {}, selectionOnly = false } = {}) {
  const startedAt = Date.now();
  const report = {
    id: fixture?.id,
    expectedRuleId: fixture?.expectedRuleId,
    expectedIntent: fixture?.expectedIntent,
    forbiddenMode: fixture?.forbiddenMode,
    selectionCalls: 0, extractionCalls: 0, checks: {}
  };
  let stage = "configuration";
  try {
    const { talk, from, stateValues, recentMessages, expected } = prepareCase(scenario, fixture);
    Object.assign(report, { talkId: talk.id, from, expectedMatch: expectedValuesForReport(fixture.expectedMatch) });
    let extractionIndex = 0;
    const mock = {
      id: "case-fixture",
      async completeJson(request) {
        if (request.operation === "match_extraction") {
          const samples = fixture.mockExtractions ?? (fixture.expectedMatch ? [fixture.expectedMatch] : []);
          if (!samples.length) {
            stage = "configuration";
            throw new Error(`${fixture.id}: mockExtractionsまたはexpectedMatchが必要です。`);
          }
          if (!fixture.mockExtractions && Object.values(fixture.expectedMatch).some(value => value instanceof RegExp)) {
            stage = "configuration";
            throw new Error(`${fixture.id}: 正規表現の期待値からmock応答は作れません。mockExtractionsを指定してください。`);
          }
          const value = samples[Math.min(extractionIndex++, samples.length - 1)];
          return { ok: true, value, raw: JSON.stringify(value) };
        }
        if (!expected.length && !fixture.mockSelection) {
          stage = "configuration";
          throw new Error("禁止modeだけのケースでAI選択をmockする場合はmockSelectionを指定してください。");
        }
        const value = fixture.mockSelection ?? {
          rule_id: expected[0].id,
          confidence: expected[0].mode === "game_over" ? 0.98 : 0.86,
          reason_code: expected[0].isDefault ? "default_unclear" : "matched_intent"
        };
        return { ok: true, value, raw: JSON.stringify(value) };
      }
    };
    // mockではenvの切替設定を読まず、外部APIへ送らない。
    const selectorEnv = live ? env : {};
    if (live) assert.ok(provider || talkRuleSelectorKind(env) === "typesafe", "live実行にはLLM providerかLLM_TALK_SELECTOR=typesafeの設定が必要です。");
    const backend = live ? provider : mock;
    const observedProvider = backend && {
      id: backend.id,
      async completeJson(request) {
        if (request.operation === "match_extraction") report.extractionCalls += 1;
        const result = await backend.completeJson(request);
        if (!result.ok && result.httpStatus) report.httpStatus = result.httpStatus;
        if (result.ok && result.model && request.operation !== "match_extraction") report.model = result.model;
        if (result.ok && result.usage) {
          report.usage = Object.fromEntries(Object.entries(result.usage).map(([key, value]) => [key, (report.usage?.[key] ?? 0) + value]));
        }
        return result;
      },
      observeResult(result, debug) { backend.observeResult?.(result, debug); }
    };
    const selector = scenario.features.llm
      ? createTalkRuleSelector(selectorEnv, observedProvider, { talkId: talk.id, kind: talk.kind, fromId: from })
      : undefined;
    stage = "selection";
    const selectionStartedAt = Date.now();
    const observeSelection = (selected) => {
      report.selectionDurationMs = Date.now() - selectionStartedAt;
      if (!selected.ok) {
        if (selected.httpStatus) report.httpStatus = selected.httpStatus;
        return;
      }
      report.selection = actualSelection(selected);
      report.reviewSelection = selected.reviewSelection;
      if (!selectionOnly && selected.rule.match.trim()) stage = "extraction";
    };
    const input = {
      env: selectorEnv, llmEnabled: scenario.features.llm, provider: observedProvider,
      ...(selector ? { semanticSelector: async (input) => { report.selectionCalls += 1; return selector(input); } } : {}),
      talk, from, playerInput: fixture.input,
      ...(fixture.semanticPlayerInput ? { semanticPlayerInput: fixture.semanticPlayerInput } : {}),
      stateValues, recentMessages
    };
    // 抽出でdefaultに戻った結果を、選択器の正解として数えない。
    const selected = selectionOnly
      ? await resolveScenarioTalkSelection(input)
      : await resolveScenarioTalkRule({ ...input, onSelection: observeSelection });
    if (selectionOnly) observeSelection(selected);
    if (!selected.ok) {
      report.errorCode = selected.error;
      throw new Error(`${fixture.id}: ${selected.error}`);
    }
    report.actual = actualSelection(selected);
    report.reviewSelection = selected.reviewSelection;
    Object.assign(report, {
      ruleId: selected.rule.id, source: selected.source, mode: modeOf(selected.rule),
      ...(!selectionOnly ? { match: selected.matchGroups } : {})
    });
    stage = "expectation";
    if (expected.length) {
      const exact = expected.some((rule) => rule.id === selected.rule.id);
      const equivalent = !fixture.expectedRuleId && expected.some((rule) => sameRuleOutcome(rule, selected.rule));
      report.checks.selection = exact || equivalent;
      report.expectationMatch = exact ? "exact" : equivalent ? "equivalent" : "mismatch";
    }
    if (fixture.forbiddenMode !== undefined) report.checks.forbiddenMode = modeOf(selected.rule) !== fixture.forbiddenMode;
    if (!selectionOnly && fixture.expectedMatch !== undefined) {
      const actual = selected.matchGroups;
      report.checks.extraction = Object.keys(actual).length === Object.keys(fixture.expectedMatch).length
        && Object.entries(fixture.expectedMatch).every(([key, value]) => Object.hasOwn(actual, key) && matchesExpectedValue(actual[key], value));
    }
    assert.notEqual(report.checks.forbiddenMode, false, `${fixture.id}: 禁止modeが選ばれました: ${fixture.forbiddenMode}`);
    assert.notEqual(report.checks.selection, false, `${fixture.id}: ${fixture.expectedRuleId ? "分岐IDが期待と違います。" : "意図または同等の分岐が期待と違います。"}`);
    assert.notEqual(report.checks.extraction, false, `${fixture.id}: 抽出値が期待と違います。`);
    return { ...report, durationMs: Date.now() - startedAt };
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      caseResult: { ...report, failureStage: stage, durationMs: Date.now() - startedAt }
    });
  }
}

function summarize(results, failures) {
  const rows = [...results, ...failures];
  const checked = (key) => {
    const evaluated = rows.filter((row) => typeof row.checks?.[key] === "boolean");
    return { evaluated: evaluated.length, passed: evaluated.filter((row) => row.checks[key]).length, failed: evaluated.filter((row) => !row.checks[key]).length };
  };
  return {
    selection: { ...checked("selection"), exact: rows.filter((row) => row.expectationMatch === "exact").length, equivalent: rows.filter((row) => row.expectationMatch === "equivalent").length },
    forbiddenMode: checked("forbiddenMode"),
    extraction: checked("extraction"),
    failuresByStage: Object.fromEntries(["configuration", "selection", "extraction", "expectation"].map((stage) => [stage, failures.filter((row) => row.failureStage === stage).length]))
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
      failures.push({ id: item.id, ...error.caseResult, error: error instanceof Error ? error.message : String(error) });
      if (options.live && [401, 403].includes(error.caseResult?.httpStatus)) break;
    }
  }
  return { results, failures, summary: { planned: cases.length, attempted: results.length + failures.length, ...summarize(results, failures) } };
}
