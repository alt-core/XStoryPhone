import path from "node:path";
import { activeRows } from "./tsv-utils.mjs";
import { loadScenarioAuthoring } from "./scenario-authoring.mjs";

export function selectedScenarioDir(rootDir = process.cwd()) {
  const configured = String(process.env.XSTORYPHONE_SCENARIO_DIR ?? "scenario/demo").trim() || "scenario/demo";
  return path.resolve(rootDir, configured);
}

export function loadLocalTalkAuthoring(rootDir = process.cwd()) {
  const scenarioDir = selectedScenarioDir(rootDir);
  const { source, workbook } = loadScenarioAuthoring(scenarioDir);
  return {
    source,
    peopleRows: activeRows(workbook.talk_people.rows),
    flowRows: activeRows(workbook.talk_flow.rows),
    blockRows: workbook.talk_blocks.rows
  };
}
