import { inheritColumns } from "./tsv-utils.mjs";

const inheritedColumnsByTable = {
  talk_flow: ["talk", "from"],
  hooks: ["event"],
  attachments: ["type"],
  calendar_items: ["date"]
};

export function applyScenarioAuthoringInheritance(tableId, rows) {
  return inheritColumns(rows, inheritedColumnsByTable[tableId] ?? []);
}

export function applyScenarioAuthoringSheetInheritance(tableId, sheet) {
  return {
    ...sheet,
    rows: applyScenarioAuthoringInheritance(tableId, sheet.rows)
  };
}
