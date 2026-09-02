import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
    { cwd: rootDir }
  );

  const output = fs.readFileSync(outputPath, "utf8");

  assert.ok(output.includes("# guide"), "指定talkを出力する");
  assert.ok(output.includes("デモ進行係:"), "複数発話を人物名付きで出力する");
  assert.ok(output.includes("プレイヤー:"), "talk_flow.exampleを出力する");
  assert.ok(output.includes("[attachment: rainy_window_image]"), "添付を出力する");
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}

console.log("scenario talk_flow writer review dump tests passed");
