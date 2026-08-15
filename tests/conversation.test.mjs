import assert from "node:assert/strict";
import test from "node:test";
import { resolveTalkRule } from "../src/shared/conversation.ts";

const baseRule = {
  order: 1,
  from: "start",
  cond: "",
  intent: "",
  match: "",
  nextBlocks: ["start"],
  set: [],
  mode: "",
  notes: "",
  example: ""
};

test("正規表現だけで分岐を選択できる", async () => {
  const result = await resolveTalkRule({
    rules: [
      { ...baseRule, id: "found", isDefault: false, criteria: "/^見つけた[！!]?$/u" },
      { ...baseRule, id: "default", order: 999, isDefault: true, criteria: "" }
    ],
    from: "start",
    playerInput: "見つけた！",
    stateValues: {}
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rule.id, "found");
    assert.equal(result.source, "regex");
  }
});

test("自然文criteriaがある時だけsemantic selectorを使う", async () => {
  let calls = 0;
  const result = await resolveTalkRule({
    rules: [
      { ...baseRule, id: "positive", isDefault: false, criteria: "肯定している" },
      { ...baseRule, id: "default", order: 999, isDefault: true, criteria: "" }
    ],
    from: "start",
    playerInput: "はい",
    stateValues: {},
    semanticSelector: async () => {
      calls += 1;
      return { ok: true, ruleId: "positive" };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.ok && result.rule.id, "positive");
});

test("正規表現にも自然文criteriaにも該当しなければdefaultへ進む", async () => {
  const result = await resolveTalkRule({
    rules: [
      { ...baseRule, id: "found", isDefault: false, criteria: "/^見つけた$/u" },
      { ...baseRule, id: "default", order: 999, isDefault: true, criteria: "" }
    ],
    from: "start",
    playerInput: "まだです",
    stateValues: {}
  });
  assert.equal(result.ok && result.rule.id, "default");
  assert.equal(result.ok && result.source, "default");
});

test("共通分岐を現在fromの分岐より先に評価し、defaultは現在fromから選ぶ", async () => {
  const result = await resolveTalkRule({
    rules: [
      { ...baseRule, id: "help", from: "*", order: 1, intent: "ヘルプ", isDefault: false, criteria: "/^ヘルプ$/u" },
      { ...baseRule, id: "default", order: 999, isDefault: true, criteria: "" }
    ],
    from: "start",
    playerInput: "ヘルプ",
    stateValues: {}
  });
  assert.equal(result.ok && result.rule.id, "help");
  assert.equal(result.ok && result.source, "regex");
});

test("添付コマンドは正規表現へ内部ID、LLMへ説明文を渡せる", async () => {
  let semanticInput = "";
  const result = await resolveTalkRule({
    rules: [
      { ...baseRule, id: "semantic", isDefault: false, criteria: "写真を送った" },
      { ...baseRule, id: "default", order: 999, isDefault: true, criteria: "" }
    ],
    from: "start",
    playerInput: "photo:clue_photo",
    semanticPlayerInput: "プレイヤーは「手がかり」という画像を添付しました。",
    stateValues: {},
    semanticSelector: async (input) => {
      semanticInput = input.playerInput;
      return { ok: true, ruleId: "semantic" };
    }
  });
  assert.match(semanticInput, /画像を添付/u);
  assert.equal(result.ok && result.rule.id, "semantic");
});
