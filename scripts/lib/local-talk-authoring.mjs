import fs from "node:fs";
import path from "node:path";
import { activeRows, inheritColumns, loadTsvSheet } from "./tsv-utils.mjs";

export function selectedScenarioDir(rootDir = process.cwd()) {
  const configured = String(process.env.XSTORYPHONE_SCENARIO_DIR ?? "scenario/demo").trim() || "scenario/demo";
  return path.resolve(rootDir, configured);
}

export function loadLocalTalkAuthoring(rootDir = process.cwd()) {
  const scenarioDir = selectedScenarioDir(rootDir);
  const source = JSON.parse(fs.readFileSync(path.join(scenarioDir, "scenario.json"), "utf8"));
  const flowSheet = loadTsvSheet(path.join(scenarioDir, "authoring/talk_flow.tsv"), { trimHeaders: true, normalizeNewlines: true });
  const blockSheet = loadTsvSheet(path.join(scenarioDir, "authoring/talk_blocks.tsv"), { trimHeaders: true, normalizeNewlines: true });
  return {
    source,
    peopleRows: (source.talkPeople ?? []).map((person, index) => ({ ...person, __rowNumber: index + 1 })),
    flowRows: activeRows(inheritColumns(flowSheet.rows, ["talk", "from"])),
    blockRows: blockSheet.rows
  };
}
