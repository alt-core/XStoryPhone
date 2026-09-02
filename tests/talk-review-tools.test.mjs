import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { currentRuleIdForReviewEvent } from "../scripts/lib/review-cluster-rules.mjs";
import { talkBlockKeyError } from "../scripts/lib/talk-blocks.mjs";
import { formatTalkOutputStep, parseTalkOutputSteps } from "../scripts/lib/talk-output-steps.mjs";

test("talk outputの固定DSLを共通parserで解釈する", () => {
  const result = parseTalkOutputSteps([
    "reply",
    "/search {{player_input}}",
    "/input hide",
    "/input disable",
    "/input enable",
    "/if (search_found) found"
  ]);
  const nested = parseTalkOutputSteps('/if ((phase == "ready" && player_input =~ /foo\\(bar\\)/u) || label == ")") reply) block');
  assert.deepEqual(nested.errors, []);
  assert.deepEqual(nested.steps, [{
    kind: "if",
    cond: '(phase == "ready" && player_input =~ /foo\\(bar\\)/u) || label == ")"',
    blockKey: "reply) block"
  }]);
  assert.equal(formatTalkOutputStep(nested.steps[0]), '/if ((phase == "ready" && player_input =~ /foo\\(bar\\)/u) || label == ")") reply) block');
  assert.deepEqual(parseTalkOutputSteps("/if (player_input =~ /[()/]/u) found").steps, [{
    kind: "if",
    cond: "player_input =~ /[()/]/u",
    blockKey: "found"
  }]);
  assert.match(parseTalkOutputSteps("/if search_found => found").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps("/if (search_found) => found").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps("/if (search_found) -> found").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps("/if (search_found)found").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps("/if (search_found found").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps("/if () found").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps("/if (search_found)").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps('/if (name == "未終了) found').errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.match(parseTalkOutputSteps("/if (name =~ /未終了) found").errors[0] ?? "", /\/if \(<condition>\) <block_id>/u);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.steps, [
    { kind: "block", blockKey: "reply" },
    { kind: "search", queryTemplate: "{{player_input}}" },
    { kind: "input", action: "hide" },
    { kind: "input", action: "disable" },
    { kind: "input", action: "enable" },
    { kind: "if", cond: "search_found", blockKey: "found" }
  ]);
  assert.match(parseTalkOutputSteps("/input pause").errors[0] ?? "", /show、hide、enable、disable/u);
  assert.match(parseTalkOutputSteps("/unknown value").errors[0] ?? "", /未定義/u);
  assert.match(talkBlockKeyError("/reserved"), /next command/u);
});

test("会話制作dumpと全example mockを選択中scenarioで実行できる", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-talk-review-"));
  try {
    const pathOutput = path.join(outputDir, "path.md");
    const writerOutput = path.join(outputDir, "writer.md");
    const searchPathOutput = path.join(outputDir, "search-path.md");
    const searchWriterOutput = path.join(outputDir, "search-writer.md");
    for (const [script, args] of [
      ["scripts/scenario-talk-flow-path-dump.mjs", ["--talk=search_agent", "--multi-next-only", `--output=${pathOutput}`]],
      ["scripts/scenario-talk-flow-writer-review-dump.mjs", ["--talk=guide", `--output=${writerOutput}`]],
      ["scripts/scenario-talk-flow-path-dump.mjs", ["--talk=search_agent", `--output=${searchPathOutput}`]],
      ["scripts/scenario-talk-flow-writer-review-dump.mjs", ["--talk=search_agent", `--output=${searchWriterOutput}`]],
      ["scripts/scenario-llm-talk-flow-examples-test.mjs", []]
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    assert.match(fs.readFileSync(pathOutput, "utf8"), /next連結/u);
    assert.match(fs.readFileSync(writerOutput, "utf8"), /talk_flow シナリオライター確認用/u);
    assert.match(fs.readFileSync(searchPathOutput, "utf8"), /startSteps: `\/input hide` -> `intro` -> `\/input show`/u);
    const searchWriter = fs.readFileSync(searchWriterOutput, "utf8");
    assert.match(searchWriter, /\[入力\] hide/u);
    assert.match(searchWriter, /\[検索\] \{\{player_input\}\}/u);
    assert.match(searchWriter, /\[Quick Reply: 古いメモ \/ ヒント \/ 機能テスト \/ ヘルプ\]/u);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("監修clusterは旧rule IDを保存済みnext blockから現在ruleへ解決する", () => {
  const talk = {
    rules: [
      {
        id: "current",
        from: "start",
        outputSteps: [{ kind: "if", cond: "search_found", blockId: "reply" }, { kind: "search", queryTemplate: "{{player_input}}" }],
        nextBlocks: ["reply"]
      },
      { id: "other", from: "start", outputSteps: [{ kind: "block", blockId: "other" }], nextBlocks: ["other"] }
    ]
  };
  assert.equal(currentRuleIdForReviewEvent(talk, "start", {
    ruleId: "removed-rule",
    responseSnapshot: {
      outputSteps: [{ kind: "if", cond: "search_found", blockId: "reply" }, { kind: "search", queryTemplate: "{{player_input}}" }]
    }
  }), "current");
  assert.equal(currentRuleIdForReviewEvent(talk, "start", {
    ruleId: "removed-rule",
    responseSnapshot: { nextBlocks: ["reply"] }
  }), "current");
  assert.equal(currentRuleIdForReviewEvent(talk, "start", { ruleId: "removed-rule", responseSnapshot: {} }), "");
});

test("監修clusterは同じblockでも保存済み入力actionから現在ruleを区別する", () => {
  const talk = {
    rules: [{
      id: "hide-rule",
      from: "start",
      outputSteps: [{ kind: "block", blockId: "reply" }, { kind: "input", action: "hide" }],
      nextBlocks: ["reply"]
    }, {
      id: "disable-rule",
      from: "start",
      outputSteps: [{ kind: "block", blockId: "reply" }, { kind: "input", action: "disable" }],
      nextBlocks: ["reply"]
    }]
  };
  assert.equal(currentRuleIdForReviewEvent(talk, "start", {
    ruleId: "removed-rule",
    responseSnapshot: {
      outputSteps: [{ kind: "block", blockId: "reply" }, { kind: "input", action: "disable" }],
      nextBlocks: ["reply"]
    }
  }), "disable-rule");
  assert.equal(currentRuleIdForReviewEvent(talk, "start", {
    ruleId: "removed-rule",
    responseSnapshot: { nextBlocks: ["reply"] }
  }), "");
});
