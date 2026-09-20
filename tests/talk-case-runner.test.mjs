import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runTalkCase, runTalkCases } from "../scripts/lib/talk-case-runner.mjs";
import { talkTestContext } from "../scripts/lib/talk-test-context.mjs";
import { resolveScenarioTalkRule } from "../src/worker/services/talkResolver.ts";
import { buildTalkFlowLlmMessages } from "../src/worker/product/talkFlowLlmSelection.ts";

const base = {
  order: 1, from: "guide::start", isDefault: false, cond: "", intent: "回答", criteria: "名前を伝えた", match: "",
  outputSteps: [{ kind: "block", blockId: "guide::reply" }], nextBlocks: ["guide::reply"], nextFromId: "guide::reply", set: [], mode: "", notes: "", example: ""
};
const scenario = {
  features: { llm: true }, stateVariables: { scene: "名前確認", accepted: true },
  talkPeople: [{ id: "guide", name: "案内役", role: "npc" }],
  talkBlocks: [{ id: "guide::start", messages: [{ sender: "guide", body: "{{scene}}の質問です。" }] }],
  talks: [{ id: "guide", kind: "sms", rules: [
    { ...base, id: "answer", criteria: "{{scene}}で名前を述べた", match: '{"name":"名乗った名前"}', set: ["saved=$match.name"] },
    { ...base, id: "hint", order: 2, criteria: "/^ヒント$/u", mode: "stay" },
    { ...base, id: "default", order: 3, isDefault: true, intent: "", criteria: "現在は{{scene}}", mode: "stay" }
  ] }]
};

test("制作promptは現在stateのcriteria/contextとfromの台詞を本番と同じ値へ展開する", async () => {
  const fixture = { talkId: "guide", from: "start", input: "名前です", stateValues: { scene: "新しい場面" } };
  const built = talkTestContext(scenario, fixture);
  const cliInput = JSON.parse(buildTalkFlowLlmMessages(built.context.input)[1].content);
  let actualInput;
  await resolveScenarioTalkRule({
    env: {}, llmEnabled: true, talk: { ...built.talk, rules: built.talk.rules.map((rule) => ({ ...rule, match: "" })) },
    from: built.fromId, playerInput: fixture.input, stateValues: built.stateValues, recentMessages: built.recentMessages,
    provider: { id: "fake", async completeJson(request) {
      actualInput = request.input;
      return { ok: true, value: { rule_id: "answer", confidence: 0.9, reason_code: "matched_intent" }, raw: "{}" };
    } }
  });
  assert.deepEqual(cliInput, actualInput);
  assert.equal(cliInput.current_context, "現在は新しい場面");
  assert.match(cliInput.candidate_rules.find((rule) => rule.rule_id === "answer").criteria, /新しい場面/u);
  assert.equal(cliInput.recent_messages[0].body, "新しい場面の質問です。");
});

test("一入力fixtureは本番resolverで分岐と抽出を確かめ、副作用を実行しない", async () => {
  const before = structuredClone(scenario);
  const result = await runTalkCase(scenario, {
    id: "name", talkId: "guide", from: "start", input: "田中です", stateValues: { scene: "新しい場面" },
    expectedRuleId: "answer", expectedMatch: { name: "田中" }
  });
  assert.equal(result.ruleId, "answer");
  assert.deepEqual(result.match, { name: "田中" });
  assert.equal(result.selectionCalls, 1);
  assert.equal(result.extractionCalls, 2);
  assert.deepEqual(scenario, before);
});

test("regex選択はmock期待値を使って成功を捏造しない", async () => {
  const result = await runTalkCases(scenario, [{
    id: "wrong", talkId: "guide", from: "start", input: "ヒント", expectedRuleId: "answer", expectedMatch: { name: "田中" }
  }, {
    id: "hint", talkId: "guide", from: "start", input: "ヒント", expectedRuleId: "hint", expectedMatch: {}
  }]);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /分岐IDが期待と違います/u);
  assert.equal(result.results[0].selectionCalls, 0);
  assert.equal(result.results[0].extractionCalls, 0);
});

test("抽出不成立のdefaultと、異なる抽出値を検証する", async () => {
  const selectedAnswer = { rule_id: "answer", confidence: 0.9, reason_code: "matched_intent" };
  const result = await runTalkCases(scenario, [{
    id: "missing", talkId: "guide", from: "start", input: "分からない", expectedRuleId: "default", expectedMatch: {},
    mockSelection: selectedAnswer, mockExtractions: [{ name: null }]
  }, {
    id: "wrong-value", talkId: "guide", from: "start", input: "名前です", expectedRuleId: "answer", expectedMatch: { name: "期待" },
    mockExtractions: [{ name: "別の値" }]
  }]);
  assert.equal(result.results[0].ruleId, "default");
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /抽出値が期待と違います/u);
});

test("live指定はfixtureや認証情報を読む前に課金確認flagを要求する", () => {
  const result = spawnSync(process.execPath, ["scripts/scenario-talk-flow-cases-test.mjs", "--live", "--fixture=does-not-exist.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ユーザー確認後/u);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/u);
});

test("fixtureの期待値・stateの誤記を黙って無視しない", async () => {
  const baseCase = { id: "typo", talkId: "guide", from: "start", input: "ヒント", expectedRuleId: "hint" };
  await assert.rejects(runTalkCase(scenario, { ...baseCase, expectedMatches: {} }), /未対応のcase項目/u);
  await assert.rejects(runTalkCase(scenario, { ...baseCase, stateValues: { scnee: "誤記" } }), /未定義のstate/u);
  await assert.rejects(runTalkCase(scenario, { ...baseCase, expectedMatch: { name: null } }), /値なしの項目は省略/u);
});
