import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { selectedScenarioDir } from "./lib/scenario-directory.mjs";
import { accessToken, maxColumns, readJson, readSheetsAuthoring, sheetValues, validateSheetsArguments } from "./lib/google-sheets.mjs";

const rootDir = process.cwd();
const defaultScenarioPath = path.join(selectedScenarioDir(), "scenario.source.json");
const defaultCredentialsPath = "";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function listArg(name) {
  return String(argValue(name) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function selectedTables(tables, selectedTableIds) {
  if (!selectedTableIds.length) {
    return Object.entries(tables);
  }

  const tableIdSet = new Set(selectedTableIds);
  const entries = Object.entries(tables).filter(([tableId]) => tableIdSet.has(tableId));
  const missing = selectedTableIds.filter((tableId) => !Object.hasOwn(tables, tableId));
  if (missing.length) {
    throw new Error(`未定義の table ID です: ${missing.join(", ")}`);
  }
  return entries;
}

function stringifyTsvCell(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/[\t\n]/.test(text) && !text.startsWith("\"")) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function stringifyTsv(rows) {
  const text = rows
    .map((row) => row.map((cell) => stringifyTsvCell(cell)).join("\t"))
    .join("\n");
  return `${text}\n`;
}

async function main() {
  validateSheetsArguments(process.argv.slice(2), { tables: true });
  const scenarioPath = argValue("--scenario") || defaultScenarioPath;
  const credentialsPath =
    argValue("--credentials") ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    defaultCredentialsPath;
  const authoring = readSheetsAuthoring(path.resolve(rootDir, scenarioPath));
  const spreadsheetId =
    argValue("--spreadsheet-id") ||
    process.env.XSTORYPHONE_SCENARIO_SPREADSHEET_ID ||
    authoring?.spreadsheetId;
  const selectedTableIds = listArg("--tables");

  if (!spreadsheetId) {
    throw new Error("--spreadsheet-id、XSTORYPHONE_SCENARIO_SPREADSHEET_ID、または scenarioAuthoring.spreadsheetId が必要です。");
  }
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Google service account credential がありません: ${credentialsPath}`);
  }

  const tableEntries = selectedTables(authoring.tables, selectedTableIds);
  const credentials = readJson(credentialsPath);
  const token = await accessToken(credentials);
  const exportDir = path.resolve(rootDir, authoring.exportDir);
  const fetched = [];
  for (const [tableId, sheetName] of tableEntries) {
    const remoteRows = await sheetValues(spreadsheetId, token, sheetName);
    if (!remoteRows.length) {
      throw new Error(`${tableId}: Google Sheet が空です: ${sheetName}`);
    }

    fetched.push({ sheetName, rows: remoteRows, text: stringifyTsv(remoteRows) });
  }

  // 後のSheet取得に失敗しても、前半の原本だけを更新しない。
  fs.mkdirSync(exportDir, { recursive: true });
  for (const { sheetName, rows, text: nextText } of fetched) {
    const filePath = path.join(exportDir, `${sheetName}.tsv`);
    const currentText = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    const changed = currentText !== nextText;
    if (changed) {
      fs.writeFileSync(filePath, nextText);
    }

    console.log(`${sheetName}: ${changed ? "updated" : "unchanged"} (${rows.length} rows x ${maxColumns(rows)} cols)`);
  }

  console.log(`Google Spreadsheet から TSV を取得しました: ${spreadsheetId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
