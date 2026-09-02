import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTalkOutputSteps, talkOutputMatchEnv } from "../src/worker/services/talkOutput.ts";

test("talk outputはset後envで検索を一度だけ評価し、条件blockとcardを記述順に返す", () => {
  let searches = 0;
  const result = evaluateTalkOutputSteps({
    steps: [
      { kind: "if", cond: "search_found", blockId: "found" },
      { kind: "if", cond: "!search_found", blockId: "not_found" },
      { kind: "search", queryTemplate: "{{query}}" },
      { kind: "block", blockId: "followup" }
    ],
    env: { query: "古いメモ" },
    search(query) {
      searches += 1;
      return [{ id: `result:${query}` }];
    }
  });

  assert.equal(searches, 1);
  assert.equal(result.env.search_found, true);
  assert.equal(result.env.search_result_count, 1);
  assert.deepEqual(result.outputs, [
    { kind: "block", blockId: "found" },
    { kind: "search", query: "古いメモ", results: [{ id: "result:古いメモ" }] },
    { kind: "block", blockId: "followup" }
  ]);
});

test("検索のないoutputは検索一時値をfalseと0で扱う", () => {
  const result = evaluateTalkOutputSteps({
    steps: [
      { kind: "if", cond: "!search_found && search_result_count == 0", blockId: "no_search" },
      { kind: "input", visible: false }
    ],
    env: {},
    search() {
      throw new Error("検索してはいけません");
    }
  });
  assert.deepEqual(result.outputs, [
    { kind: "block", blockId: "no_search" },
    { kind: "input", visible: false }
  ]);
});

test("検索queryは従来の500文字上限を保つ", () => {
  let actualQuery = "";
  evaluateTalkOutputSteps({
    steps: [{ kind: "search", queryTemplate: "  {{query}}  " }],
    env: { query: "あ".repeat(600) },
    search(query) {
      actualQuery = query;
      return [];
    }
  });
  assert.equal(actualQuery, "あ".repeat(500));
});

test("nullableなmatch抽出値はoutput条件とtemplateで同じ空文字として扱う", () => {
  const env = talkOutputMatchEnv(JSON.stringify({
    name: { rule: "名前", null: "ok" },
    reading: { rule: "読み", null: "ok" }
  }), { name: "田中" });
  assert.deepEqual(env, { name: "田中", reading: "" });
  const result = evaluateTalkOutputSteps({
    steps: [{ kind: "if", cond: 'reading == ""', blockId: "missing_reading" }],
    env,
    search: () => []
  });
  assert.deepEqual(result.outputs, [{ kind: "block", blockId: "missing_reading" }]);
});
