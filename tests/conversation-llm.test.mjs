import assert from "node:assert/strict";
import test from "node:test";
import { semanticRuleSelector, extractTalkRuleMatch } from "../src/worker/services/conversationLlm.ts";
import { resolveScenarioTalkRule } from "../src/worker/services/talkResolver.ts";

function providerFrom(values) {
  let index = 0;
  const requests = [];
  return {
    requests,
    provider: {
      id: "fake",
      async completeJson(request) {
        requests.push(request);
        const value = values[Math.min(index, values.length - 1)];
        index += 1;
        if (value?.error) return { ok: false, error: value.error };
        return { ok: true, value, raw: JSON.stringify(value) };
      }
    }
  };
}

const defaultRule = {
  id: "default",
  order: 99,
  from: "start",
  isDefault: true,
  cond: "",
  intent: "",
  criteria: "",
  match: "",
  nextBlocks: ["start"],
  set: [],
  mode: "",
  notes: "",
  example: ""
};

test("LLM分岐は直近文脈を渡し、低確信と危険分岐をdefaultへ倒す", async () => {
  const rules = [
    { ...defaultRule, id: "normal", isDefault: false, order: 1, intent: "肯定", criteria: "肯定している" },
    { ...defaultRule, id: "end", isDefault: false, order: 2, intent: "終了", criteria: "終了を明言", mode: "game_over" },
    defaultRule
  ];
  const high = providerFrom([{ rule_id: "normal", confidence: 0.8, reason_code: "matched_intent" }]);
  const selected = await semanticRuleSelector(high.provider)({
    playerInput: "はい",
    rules,
    defaultRuleId: "default",
    recentMessages: [{ speaker: "案内役", body: "進めますか？" }]
  });
  assert.deepEqual(selected, { ok: true, ruleId: "normal" });
  assert.equal(high.requests[0].temperature, 0);
  assert.deepEqual(high.requests[0].input.recent_messages, [{ speaker: "案内役", body: "進めますか？" }]);
  assert.equal(high.requests[0].input.current_context, "");
  assert.equal(high.requests[0].input.candidate_rules[0].from, "start");
  assert.match(high.requests[0].instructions, /短い肯定、否定、指示語/u);
  assert.match(high.requests[0].instructions, /同じ添付ID/u);

  const low = providerFrom([{ rule_id: "normal", confidence: 0.4, reason_code: "ambiguous_fallback" }]);
  assert.deepEqual(await semanticRuleSelector(low.provider)({ playerInput: "たぶん", rules, defaultRuleId: "default", recentMessages: [] }), { ok: true, ruleId: "default" });

  const gameOver = providerFrom([{ rule_id: "end", confidence: 0.85, reason_code: "matched_intent" }]);
  assert.deepEqual(await semanticRuleSelector(gameOver.provider)({ playerInput: "終わり", rules, defaultRuleId: "default", recentMessages: [] }), { ok: true, ruleId: "default" });
});

test("match抽出は同じ値を2回確認し、best項目は一致度で選ぶ", async () => {
  const rule = {
    ...defaultRule,
    id: "extract",
    isDefault: false,
    match: JSON.stringify({
      name: { rule: "名前", pick: "same" },
      reading: { rule: "読み", pick: "best", null: "weak" }
    }),
    set: ["saved_name=$match.name"]
  };
  const fake = providerFrom([
    { name: "田中太郎", reading: "たなかたろう" },
    { name: "田中太郎", reading: "タナカタロウ" },
    { name: "田中太郎", reading: "たなかたろう" }
  ]);
  const result = await extractTalkRuleMatch(fake.provider, rule, "田中太郎です", [{ speaker: "相手", body: "名前は？" }]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.values, { name: "田中太郎", reading: "たなかたろう" });
  assert.equal(fake.requests.length, 3);
});

test("match抽出の壊れた応答は503相当、合意不成立はdefaultへ戻す", async () => {
  const rule = { ...defaultRule, id: "extract", isDefault: false, criteria: "名前を述べた", match: '{"name":"名前"}', set: [] };
  const invalid = providerFrom([{ wrong: "値" }]);
  assert.deepEqual(await extractTalkRuleMatch(invalid.provider, rule, "名前です"), { ok: false, error: "provider_invalid" });

  const disagree = providerFrom([
    { rule_id: "extract", confidence: 0.9, reason_code: "matched_intent" },
    { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }
  ]);
  const resolved = await resolveScenarioTalkRule({
    env: {},
    llmEnabled: true,
    provider: disagree.provider,
    talk: { id: "talk", publicId: "public", kind: "sms", appId: "messages", label: "会話", cond: "", startBlocks: ["start"], initialFrom: "start", rules: [rule, defaultRule] },
    from: "start",
    playerInput: "名前です",
    stateValues: {}
  });
  assert.equal(resolved.ok && resolved.rule.id, "default");
});

test("LLM互換providerのschema外の値を成功扱いしない", async () => {
  const rules = [{ ...defaultRule, id: "normal", isDefault: false, order: 1, criteria: "一致" }, defaultRule];
  const invalidSelection = providerFrom([{ rule_id: "normal", confidence: 1.2, reason_code: "unknown" }]);
  assert.deepEqual(await semanticRuleSelector(invalidSelection.provider)({
    playerInput: "入力", rules, defaultRuleId: "default", recentMessages: []
  }), { ok: false, error: "provider_invalid" });

  const tooLong = providerFrom([{ name: "あ".repeat(241) }]);
  assert.deepEqual(await extractTalkRuleMatch(tooLong.provider, {
    ...defaultRule,
    id: "extract",
    isDefault: false,
    match: '{"name":"名前"}'
  }, "名前です"), { ok: false, error: "provider_invalid" });
});
