import { selectedScenarioDir } from "./scenario-directory.mjs";
import { activeRows } from "./tsv-utils.mjs";
import { loadScenarioAuthoring } from "./scenario-authoring.mjs";
import { talkFlowRows } from "./talk-flow-rows.mjs";

export { selectedScenarioDir };

export function loadLocalTalkAuthoring(rootDir = process.cwd()) {
  const scenarioDir = selectedScenarioDir(rootDir);
  const { source, workbook } = loadScenarioAuthoring(scenarioDir);
  return {
    source,
    peopleRows: activeRows(workbook.talk_people.rows),
    flowRows: talkFlowRows(activeRows(workbook.talk_flow.rows)).rules,
    blockRows: workbook.talk_blocks.rows
  };
}
