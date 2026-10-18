import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseTsv } from "./lib/tsv-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-writer-review-test-"));
const outputPath = path.join(outputDir, "guide.md");

try {
  await execFileAsync(
    "node",
    [
      "scripts/scenario-talk-flow-writer-review-dump.mjs",
      "--talk=guide",
      `--output=${outputPath}`
    ],
    { cwd: rootDir, env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/demo" } }
  );

  const output = fs.readFileSync(outputPath, "utf8");

  assert.ok(output.includes("# guide"), "指定talkを出力する");
  assert.ok(output.includes("デモ連絡先:"), "複数発話を人物名付きで出力する");
  assert.ok(output.includes("プレイヤー:"), "talk_flow.exampleを出力する");
  assert.ok(output.includes("[attachment: rainy_window_image]"), "添付を出力する");

  const scenarioDir = path.join(outputDir, "scenario");
  fs.cpSync(path.join(rootDir, "scenario/demo"), scenarioDir, { recursive: true });
  const flowPath = path.join(scenarioDir, "authoring/talk_flow.tsv");
  const flowRows = parseTsv(fs.readFileSync(flowPath, "utf8"));
  const [headers] = flowRows;
  const rule = flowRows.find((row, index) => index > 0 && row[headers.indexOf("talk")] === "guide");
  const reason = "あなたは確認に失敗しました。\n手順を確認して、もう一度答えましょう。";
  for (const mode of [
    `game_over(${JSON.stringify(reason)})`,
    `game_over("${reason.replaceAll("\n", "\r\n")}")`
  ]) {
    rule[headers.indexOf("mode")] = mode;
    fs.writeFileSync(flowPath, flowRows.map((row) => row.map((cell) => /[\t\n\r"]/u.test(cell)
      ? `"${cell.replaceAll('"', '""')}"` : cell).join("\t")).join("\n") + "\n");

    for (const groupFlags of [[], ["--group-by-from"]]) {
      await execFileAsync(process.execPath, [
        "scripts/scenario-talk-flow-writer-review-dump.mjs", "--talk=guide", ...groupFlags, `--output=${outputPath}`
      ], { cwd: rootDir, env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: scenarioDir } });
      const review = fs.readFileSync(outputPath, "utf8");
      assert.ok(review.includes(`（GAME OVER）\n理由:\n${reason}`), "エスケープ・実改行の理由を両方の表示形式で段落のまま出力する");
    }
  }
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}

console.log("scenario talk_flow writer review dump tests passed");
