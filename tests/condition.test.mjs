import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStateAssignments,
  evaluateCondition,
  renderTemplate,
  validateConditionExpression,
  validateStateAssignments
} from "../src/shared/condition.ts";

test("条件式は真偽値・比較・論理演算を評価できる", () => {
  const state = { repaired: true, count: 2, route: "a" };
  assert.equal(evaluateCondition("repaired && count != 0", state), true);
  assert.equal(evaluateCondition("!repaired || route == 'b'", state), false);
});

test("条件式は整数比較とplayer_inputの正規表現を評価できる", () => {
  assert.equal(evaluateCondition("count >= 2 && count < 4", { count: 3 }), true);
  assert.equal(evaluateCondition("player_input =~ /黄色|オレンジ/u", { player_input: "黄色です" }), true);
  assert.equal(evaluateCondition("player_input !~ /秘密/u", {}), true);
});

test("条件式の型・enum値・未定義変数をビルド前に検出する", () => {
  const definitions = new Map([
    ["started", { type: "boolean" }],
    ["count", { type: "integer" }],
    ["phase", { type: "enum", values: ["start", "done"] }]
  ]);
  assert.deepEqual(validateConditionExpression("started && count >= 2 && phase == 'done'", definitions), []);
  assert.match(validateConditionExpression("missing", definitions).join("\n"), /未定義/u);
  assert.match(validateConditionExpression("phase == 'unknown'", definitions).join("\n"), /比較の型/u);
  assert.match(validateConditionExpression("count =~ /2/u", definitions).join("\n"), /比較の型/u);
});

test("状態更新は型・enum・match参照を検証する", () => {
  const definitions = new Map([
    ["started", { type: "boolean" }],
    ["name", { type: "string" }],
    ["phase", { type: "enum", values: ["start", "done"] }]
  ]);
  assert.deepEqual(validateStateAssignments(["started=true", "phase='done'", "name=$match.name"], definitions, new Set(["name"])), []);
  assert.match(validateStateAssignments(["phase='other'"], definitions).join("\n"), /enum/u);
  assert.match(validateStateAssignments(["started=$match.name"], definitions, new Set(["name"])).join("\n"), /string/u);
  assert.match(validateStateAssignments(["name=$match.missing"], definitions).join("\n"), /未定義のmatch/u);
});

test("状態更新とテンプレート置換を同じ変数で扱える", () => {
  const state = applyStateAssignments(
    { found: false, name: "" },
    ["found=true", "name=$match.name"],
    { name: "オレンジ" }
  );
  assert.deepEqual(state, { found: true, name: "オレンジ" });
  assert.equal(renderTemplate("{{name}}を見つけた", { name: "印" }), "印を見つけた");
  assert.equal(renderTemplate("{{missing}}を見つけた", {}), "を見つけた");
});

test("実行時も未定義の状態変数へsetしない", () => {
  const definitions = new Map([["known", { type: "boolean" }]]);
  assert.throws(
    () => applyStateAssignments({ known: false }, ["unknown = true"], {}, definitions),
    /setの状態変数が未定義です/u
  );
});
