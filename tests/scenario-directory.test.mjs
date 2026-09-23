import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { selectedScenarioDir } from "../scripts/lib/scenario-directory.mjs";

test("作品ディレクトリは環境変数、リポジトリ設定、demoの順で選ぶ", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-scenario-dir-"));
  const packageFile = path.join(root, "package.json");
  try {
    assert.equal(selectedScenarioDir(root, {}), path.join(root, "scenario/demo"));
    fs.writeFileSync(packageFile, JSON.stringify({ xstoryphone: { scenarioDir: "scenario/story" } }));
    assert.equal(selectedScenarioDir(root, {}), path.join(root, "scenario/story"));
    assert.equal(selectedScenarioDir(root, { XSTORYPHONE_SCENARIO_DIR: "  " }), path.join(root, "scenario/story"));
    assert.equal(selectedScenarioDir(root, { XSTORYPHONE_SCENARIO_DIR: "scenario/override" }), path.join(root, "scenario/override"));
    assert.equal(selectedScenarioDir(root, { XSTORYPHONE_SCENARIO_DIR: root }), root);
    for (const scenarioDir of ["", "  ", false, 1, null]) {
      fs.writeFileSync(packageFile, JSON.stringify({ xstoryphone: { scenarioDir } }));
      assert.throws(() => selectedScenarioDir(root, {}), /xstoryphone.scenarioDir/u);
    }
    fs.writeFileSync(packageFile, "{");
    assert.throws(() => selectedScenarioDir(root, {}), SyntaxError, "壊れた設定をdemoへ戻して隠さない");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
