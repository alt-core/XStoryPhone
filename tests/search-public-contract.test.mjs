import assert from "node:assert/strict";
import test from "node:test";
import { createInitialPlayerState, searchScenario } from "../src/worker/scenario.ts";

test("検索結果は対象種別と修復要否を常に公開する", () => {
  const state = createInitialPlayerState();
  const results = [
    ...searchScenario("電話", state),
    ...searchScenario("ダミーデータ", state)
  ];

  assert.ok(results.length > 0);
  for (const result of results) {
    assert.ok(["app", "content", "talk_history"].includes(result.targetKind));
    assert.equal(typeof result.repairable, "boolean");
  }
});
