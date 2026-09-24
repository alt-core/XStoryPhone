import assert from "node:assert/strict";
import test from "node:test";
import { runTalkCase, runTalkCases, talkCaseEvaluationConfig } from "../scripts/lib/talk-case-runner.mjs";

const base = {
  order: 1, from: "guide::start", isDefault: false, cond: "", intent: "協力する",
  type: "ai", criteria: "協力を承諾した", match: "",
  outputSteps: [{ kind: "block", blockId: "guide::next" }], nextBlocks: ["guide::next"], nextFromId: "guide::next",
  set: [], mode: "", notes: "", example: ""
};
const scenario = {
  features: { llm: true }, stateVariables: { ready: true, scene: "協力依頼" },
  talkPeople: [], talkBlocks: [{ id: "guide::start", messages: [] }],
  talks: [{ id: "guide", kind: "sms", rules: [
    { ...base, id: "agree" },
    { ...base, id: "help", order: 2, intent: "手伝い方を尋ねる", criteria: "具体的な手伝い方を尋ねた" },
    { ...base, id: "end", order: 3, intent: "終了", criteria: "終了を明言", mode: "game_over" },
    { ...base, id: "default", order: 4, isDefault: true, type: "default", intent: "", criteria: "現在は{{scene}}", mode: "stay" }
  ] }]
};
const fixture = { id: "agree", talkId: "guide", from: "start", input: "手伝うよ", expectedIntent: "協力する" };
const decision = (rule_id, confidence = 0.99) => ({ rule_id, confidence, reason_code: "matched_intent" });
const alter = (update) => ({
  ...scenario, talks: scenario.talks.map((talk) => ({ ...talk, rules: talk.rules.map(update) }))
});

test("意図指定は同じ結果の別分岐を受理し、ID指定は厳密な一致を保つ", async () => {
  const changed = { ...fixture, mockSelection: decision("help") };
  const equivalent = await runTalkCase(scenario, changed);
  assert.equal(equivalent.expectationMatch, "equivalent");
  assert.equal(equivalent.actual.intent, "手伝い方を尋ねる");
  assert.equal(equivalent.actual.ruleId, "help");
  const { expectedIntent, ...strict } = changed;
  const result = await runTalkCases(scenario, [{ ...strict, expectedRuleId: "agree" }]);
  assert.equal(result.failures[0].actual.ruleId, "help");
  assert.equal(result.failures[0].reviewSelection.decision.confidence, 0.99);
  assert.equal(result.failures[0].checks.selection, false);
});

test("nextの命令・進行mode・状態更新・抽出・part読込みが異なる分岐は同等にしない", async () => {
  const changes = [
    { outputSteps: [{ kind: "block", blockId: "guide::other" }] },
    { outputSteps: [...base.outputSteps, { kind: "input", action: "disable" }] },
    { nextFromId: "guide::other" },
    { mode: "stay" },
    { set: ["ready=false"] },
    { match: '{"name":"名乗った名前"}' },
    { loadParts: ["chapter2"] }
  ];
  for (const change of changes) {
    const target = alter((rule) => rule.id === "help" ? { ...rule, ...change } : rule);
    const result = await runTalkCases(target, [{ ...fixture, mockSelection: decision("help") }], { selectionOnly: true });
    assert.equal(result.failures.length, 1, JSON.stringify(change));
    assert.equal(result.failures[0].failureStage, "expectation");
  }
});

test("抽出JSONのkey順や空白だけの差は同等で、抽出条件の差は不一致になる", async () => {
  const target = alter((rule) => ({
    ...rule, match: rule.id === "agree" ? '{"name":"名前","place":"場所"}' : '{ "place": "場所", "name": "名前" }'
  }));
  const result = await runTalkCase(target, { ...fixture, mockSelection: decision("help") }, { selectionOnly: true });
  assert.equal(result.expectationMatch, "equivalent");
  const changed = { ...target, talks: target.talks.map((talk) => ({ ...talk, rules: talk.rules.map((rule) => rule.id === "help" ? { ...rule, match: '{"name":"名字","place":"場所"}' } : rule) })) };
  await assert.rejects(runTalkCase(changed, { ...fixture, mockSelection: decision("help") }, { selectionOnly: true }), /同等の分岐/u);
});

test("期待意図は現在地点と共通分岐の有効候補から解決し、同じ意図の異なる結果は設定誤りにする", async () => {
  const scoped = alter((rule) => rule.id === "help" ? { ...rule, intent: "協力する", cond: "ready == false", mode: "stay" } : rule);
  assert.equal((await runTalkCase(scoped, fixture)).ruleId, "agree");
  const common = alter((rule) => rule.id === "agree" ? { ...rule, from: "*", cond: 'ready && player_input == "手伝うよ"' } : rule);
  assert.equal((await runTalkCase(common, { ...fixture, input: "  手伝うよ  " })).ruleId, "agree");
  const duplicate = alter((rule) => rule.id === "help" ? { ...rule, intent: "協力する" } : rule);
  assert.equal((await runTalkCase(duplicate, fixture)).ruleId, "agree");
  const invalidCases = [
    [scenario, { ...fixture, expectedIntent: "誤記" }],
    [scoped, { ...fixture, stateValues: { ready: false } }],
    [alter((rule) => rule.id === "agree" ? { ...rule, from: "guide::elsewhere" } : rule), fixture]
  ];
  let calls = 0;
  const provider = { id: "呼出し禁止", async completeJson() { calls += 1; throw new Error("呼ばない"); } };
  for (const [target, input] of invalidCases) {
    const result = await runTalkCases(target, [input], { live: true, provider });
    assert.equal(result.failures[0].failureStage, "configuration");
    assert.equal(result.failures[0].actual, undefined);
  }
  assert.equal(calls, 0);
});

test("複数の期待意図とdefaultを指定でき、矛盾・空配列・未定義の許容先を無視しない", async () => {
  const fallback = await runTalkCase(scenario, { ...fixture, expectedIntent: ["協力する", "default"], mockSelection: decision("default") });
  assert.equal(fallback.actual.intent, "default");
  assert.equal(fallback.expectationMatch, "exact");
  for (const patch of [
    { expectedIntent: [] }, { expectedIntent: ["協力する", "不明"] },
    { expectedIntent: ["協力する", "協力する"] },
    { expectedRuleId: "agree" }, { forbiddenMode: "advance" }, { forbiddenMode: "誤記" }
  ]) {
    await assert.rejects(runTalkCase(scenario, { ...fixture, ...patch }), (error) => error.caseResult.failureStage === "configuration");
  }
});

test("禁止modeだけの試験は分岐一致率へ混ぜず、違反時にも実際の選択を記録する", async () => {
  const { expectedIntent, ...negative } = fixture;
  const result = await runTalkCases(scenario, [
    { ...negative, id: "safe", forbiddenMode: "game_over", mockSelection: decision("default") },
    { ...negative, id: "unsafe", forbiddenMode: "game_over", mockSelection: decision("end") },
    { ...fixture, id: "positive" }
  ], { selectionOnly: true });
  assert.deepEqual(result.summary.forbiddenMode, { evaluated: 2, passed: 1, failed: 1 });
  assert.equal(result.summary.selection.evaluated, 1);
  assert.equal(result.failures[0].actual.mode, "game_over");
  assert.equal(result.failures[0].reviewSelection.accepted, true);
  await assert.rejects(runTalkCase(scenario, { ...negative, forbiddenMode: "game_over" }), (error) => {
    assert.match(error.message, /mockSelection/u);
    assert.equal(error.caseResult.failureStage, "configuration");
    assert.equal(error.caseResult.selectionCalls, 1);
    return true;
  });
});

test("禁止modeだけでも正規表現とAI候補なしのdefaultをmock指定なしで検査できる", async () => {
  const { expectedIntent, ...negative } = fixture;
  const target = alter((rule) => rule.id === "agree" ? { ...rule, type: "match", criteria: "/^ヒント$/u" } : rule);
  const input = { ...negative, input: "ヒント", forbiddenMode: "game_over" };
  for (const llm of [false, true]) {
    for (const selectionOnly of [false, true]) {
      const selected = await runTalkCase({ ...target, features: { llm } }, input, { selectionOnly });
      assert.equal(selected.actual.ruleId, "agree");
      assert.equal(selected.actual.source, "regex");
      assert.equal(selected.checks.forbiddenMode, true);
      assert.equal(selected.selectionCalls, 0);
    }
  }
  const dangerous = { ...target, talks: target.talks.map((talk) => ({ ...talk, rules: talk.rules.map((rule) => rule.id === "agree" ? { ...rule, mode: "game_over" } : rule) })) };
  const failed = await runTalkCases(dangerous, [input]);
  assert.equal(failed.failures[0].failureStage, "expectation");
  assert.equal(failed.failures[0].checks.forbiddenMode, false);
  assert.equal(failed.failures[0].selectionCalls, 0);

  const fallbackOnly = { ...scenario, talks: scenario.talks.map((talk) => ({ ...talk, rules: talk.rules.filter((rule) => rule.isDefault) })) };
  const fallback = await runTalkCase(fallbackOnly, input);
  assert.equal(fallback.actual.ruleId, "default");
  assert.equal(fallback.checks.forbiddenMode, true);
  assert.equal(fallback.selectionCalls, 0);
});

test("選択だけの試験はAI抽出を呼ばず、抽出不成立で禁止mode違反を隠さない", async () => {
  const target = alter((rule) => rule.id === "end" ? { ...rule, match: '{"name":"名前"}' } : rule);
  const { expectedIntent, ...negative } = fixture;
  const input = { ...negative, forbiddenMode: "game_over", mockSelection: decision("end"), mockExtractions: [{ name: null }], expectedMatch: {} };
  const full = await runTalkCase(target, input);
  assert.equal(full.actual.ruleId, "default");
  assert.equal(full.selection.ruleId, "end");
  assert.equal(full.reviewSelection.fallbackReason, "extraction_no_match");
  const selected = await runTalkCases(target, [input], { selectionOnly: true });
  assert.equal(selected.failures[0].actual.ruleId, "end");
  assert.equal(selected.failures[0].extractionCalls, 0);
  assert.equal(selected.failures[0].checks.extraction, undefined);
});

test("選択だけの試験は正規表現抽出も実行せず、期待抽出値を比較しない", async () => {
  const target = alter((rule) => rule.id === "agree" ? { ...rule, match: "/名前は(?<name>.+)です/u", set: ["saved=$extract.name"] } : rule);
  const selected = await runTalkCase(target, { ...fixture, expectedMatch: { name: "比較しない値" } }, { selectionOnly: true });
  assert.equal(selected.ruleId, "agree");
  assert.equal(selected.match, undefined);
  assert.equal(selected.checks.extraction, undefined);
  const full = await runTalkCases(target, [fixture]);
  assert.equal(full.failures[0].actual.ruleId, "default");
});

test("抽出エラーと選択通信エラーを区別し、取得済みの選択結果を失わない", async () => {
  const target = alter((rule) => rule.id === "agree" ? { ...rule, match: '{"name":"名前"}' } : rule);
  const provider = { id: "失敗確認", async completeJson(request) {
    return request.operation === "match_extraction"
      ? { ok: false, error: "provider_error" }
      : { ok: true, value: decision("agree"), raw: "{}" };
  } };
  const failedExtraction = await runTalkCases(target, [fixture], { live: true, provider });
  assert.equal(failedExtraction.failures[0].failureStage, "extraction");
  assert.equal(failedExtraction.failures[0].selection.ruleId, "agree");
  assert.equal(failedExtraction.failures[0].reviewSelection.decision.confidence, 0.99);
  assert.equal(failedExtraction.failures[0].actual, undefined);
  const failedSelection = await runTalkCases(scenario, [fixture], { live: true, provider: { id: "障害", async completeJson() { return { ok: false, error: "provider_error" }; } } });
  assert.equal(failedSelection.failures[0].failureStage, "selection");
  assert.equal(failedSelection.failures[0].selection, undefined);
  assert.equal(failedSelection.summary.selection.evaluated, 0);
});

test("レポートの設定には解決済みmodelと閾値を含め、API keyを含めない", () => {
  const env = { LLM_TALK_SELECTOR: "typesafe", TYPESAFE_API_KEY: "secret-for-test", TYPESAFE_MIN_CONFIDENCE: "0.6" };
  const config = talkCaseEvaluationConfig({ live: true, env });
  assert.equal(config.model, "jev-1.13.0");
  assert.deepEqual(config.thresholds, { minConfidence: 0.6, minGameOverConfidence: 0.9 });
  assert.doesNotMatch(JSON.stringify(config), /secret-for-test/u);
  assert.deepEqual(talkCaseEvaluationConfig({ env }), { selector: "mock" });
});

test("レポートの既定閾値は通常分岐とgame overの採否境界に一致する", async () => {
  const config = talkCaseEvaluationConfig({ live: true, env: { LLM_MODEL: "評価用モデル" } });
  const { expectedIntent, ...input } = fixture;
  for (const [ruleId, threshold] of [
    ["agree", config.thresholds.minConfidence],
    ["end", config.thresholds.minGameOverConfidence]
  ]) {
    for (const confidence of [threshold - 0.001, threshold]) {
      const result = await runTalkCase(scenario, {
        ...input, expectedRuleId: confidence < threshold ? "default" : ruleId,
        mockSelection: decision(ruleId, confidence)
      }, { selectionOnly: true });
      assert.equal(result.reviewSelection.accepted, confidence >= threshold);
    }
  }
});
