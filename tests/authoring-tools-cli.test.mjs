import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";

test("writer reviewはflowに登場しない台本専用talkも選択したTSVから出力する", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-writer-independent-"));
  try {
    const scenarioDir = path.join(temporary, "scenario");
    fs.cpSync("scenario/demo", scenarioDir, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(scenarioDir, "scenario.source.json"), "utf8")).scenarioAuthoring;
    const blockFile = path.resolve(scenarioDir, manifest.exportDir, `${manifest.tables.talk_blocks}.tsv`);
    const content = fs.readFileSync(blockFile, "utf8");
    const headers = content.split(/\r?\n/u)[0].split("\t");
    const row = (values) => headers.map((header) => values[header] ?? "").join("\t");
    fs.appendFileSync(blockFile, [
      "", row({ comment: "*independent_fixture" }), row({ comment: "archive" }),
      row({ sender: "owner", body: "独立した過去履歴の検証文です。" }), ""
    ].join("\n"));
    const output = path.join(temporary, "review.md");
    const result = spawnSync(process.execPath, [
      "scripts/scenario-talk-flow-writer-review-dump.mjs", "--talk=independent_fixture", `--output=${output}`
    ], { encoding: "utf8", env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: scenarioDir } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const review = fs.readFileSync(output, "utf8");
    assert.match(review, /# independent_fixture/u);
    assert.match(review, /## 独立ブロック/u);
    assert.match(review, /独立した過去履歴の検証文です/u);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("一入力case CLIはSheet由来の分岐IDを参照し、選択結果を報告する", () => {
  const scenario = loadAndValidateScenario().worker;
  const talk = scenario.talks.find((item) => item.kind === "sms");
  const fallback = talk.rules.find((rule) => rule.from === talk.initialFrom && rule.isDefault);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-case-cli-"));
  try {
    const fixture = path.join(temporary, "cases.mjs");
    const report = path.join(temporary, "report.json");
    fs.writeFileSync(fixture, `export const cases = ${JSON.stringify([{
      id: "cli-fixture", talkId: talk.id, from: talk.initialFrom, input: "fixture-unknown-input",
      expectedRuleId: fallback.id, expectedMatch: {}
    }])};\n`);
    const result = spawnSync(process.execPath, [
      "scripts/scenario-talk-flow-cases-test.mjs", `--fixture=${fixture}`, `--report=${report}`
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(data.mode, "mock");
    assert.equal(data.results[0].ruleId, fallback.id);
    assert.deepEqual(data.failures, []);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
