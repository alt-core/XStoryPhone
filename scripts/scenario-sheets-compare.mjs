import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { selectedScenarioDir } from "./lib/scenario-directory.mjs";
import { accessToken, readJson, readSheetsAuthoring, selectedTables, spreadsheetMetadata, validateSheetsArguments } from "./lib/google-sheets.mjs";
import { existingSheetNames, loadLocalSheets, printSheetDiff, readSheetCells } from "./lib/sheets-sync.mjs";

const rootDir = process.cwd();
const defaultScenarioPath = path.join(selectedScenarioDir(), "scenario.source.json");
const defaultCredentialsPath = "";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
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

  if (!spreadsheetId) {
    throw new Error("--spreadsheet-id、XSTORYPHONE_SCENARIO_SPREADSHEET_ID、または scenarioAuthoring.spreadsheetId が必要です。");
  }
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Google service account credential がありません: ${credentialsPath}`);
  }

  const sheets = loadLocalSheets(authoring, selectedTables(authoring.tables, argValue("--tables")));
  const credentials = readJson(credentialsPath);
  const token = await accessToken(credentials);
  const metadata = await spreadsheetMetadata(spreadsheetId, token);
  const remote = await readSheetCells(spreadsheetId, token, existingSheetNames(metadata, sheets));
  let mismatches = 0;
  console.log(`比較対象: ${sheets.map(sheet => `${sheet.tableId} (${sheet.sheetName})`).join(", ")}`);
  for (const sheet of sheets) {
    if (printSheetDiff(sheet, remote.get(sheet.sheetName))) mismatches += 1;
  }
  if (mismatches) throw new Error(`${mismatches} sheet(s) do not match local TSV.`);

  console.log(`Google Spreadsheet とローカル TSV は一致しています: ${spreadsheetId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
