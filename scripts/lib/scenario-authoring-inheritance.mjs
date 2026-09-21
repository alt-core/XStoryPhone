import { inheritColumns } from "./tsv-utils.mjs";

const inheritedColumnsByTable = {
  talk_flow: ["talk", "from"],
  hooks: ["event"],
  attachments: ["type"],
  calendar_items: ["date"]
};

export function applyScenarioAuthoringInheritance(tableId, rows) {
  const output = [];
  let part = "base";
  let section = [];
  const flush = () => {
    output.push(...inheritColumns(section, inheritedColumnsByTable[tableId] ?? []));
    section = [];
  };
  for (const row of rows ?? []) {
    const comment = String(row.comment ?? "").trim();
    if (!comment.startsWith("#") && comment.normalize("NFKC").startsWith("#")) throw new Error(`${tableId}!${row.__rowNumber ?? "?"}: part宣言には半角の # を使ってください。`);
    if (comment.startsWith("#")) {
      const name = comment.slice(1);
      if (!/^[a-z][a-z0-9_-]*$/u.test(name)
        || Object.entries(row).some(([key, value]) => key !== "comment" && !key.startsWith("__") && String(value).trim())) {
        throw new Error(`${tableId}!${row.__rowNumber ?? "?"}: part宣言はA列だけに #part名 と記述してください。`);
      }
      if (["project_constants", "schedules"].includes(tableId) && name !== "base") {
        throw new Error(`${tableId}!${row.__rowNumber ?? "?"}: この表はbase専用です。`);
      }
      flush();
      part = name;
      output.push({ ...row, __part: part });
    } else section.push({ ...row, __part: part });
  }
  flush();
  return output;
}

export function applyScenarioAuthoringSheetInheritance(tableId, sheet) {
  return {
    ...sheet,
    rows: applyScenarioAuthoringInheritance(tableId, sheet.rows)
  };
}
