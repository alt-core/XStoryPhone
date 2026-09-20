import fs from "node:fs";
import path from "node:path";
import { loadScenarioAuthoring } from "../../scripts/lib/scenario-authoring.mjs";
import { loadAndValidateScenario as validate } from "../../scripts/scenario-lib.mjs";

// 検証器の異常入力fixture専用。製品の制作入口はこのmoduleを参照しない。
export function readScenarioFixture(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : loadScenarioAuthoring(path.dirname(file)).source;
}

export function loadAndValidateScenario() {
  const dir = path.resolve(process.env.XSTORYPHONE_SCENARIO_DIR?.trim() || "scenario/demo");
  const file = path.join(dir, "scenario.fixture.json");
  return validate(fs.existsSync(file) ? { source: readScenarioFixture(file) } : {});
}
