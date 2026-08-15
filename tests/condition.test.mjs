import assert from "node:assert/strict";
import test from "node:test";
import { applyStateAssignments, evaluateCondition, renderTemplate } from "../src/shared/condition.ts";

test("条件式は真偽値・比較・論理演算を評価できる", () => {
  const state = { repaired: true, count: 2, route: "a" };
  assert.equal(evaluateCondition("repaired && count != 0", state), true);
  assert.equal(evaluateCondition("!repaired || route == 'b'", state), false);
});

test("状態更新とテンプレート置換を同じ変数で扱える", () => {
  const state = applyStateAssignments(
    { found: false, name: "" },
    ["found=true", "name={{name}}"],
    { name: "オレンジ" }
  );
  assert.deepEqual(state, { found: true, name: "オレンジ" });
  assert.equal(renderTemplate("{{name}}を見つけた", { name: "印" }), "印を見つけた");
});
