import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { selectedScenarioDir } from "./lib/scenario-directory.mjs";
import { accessToken, maxColumns, readJson, readSheetsAuthoring, sheetValues, validateSheetsArguments } from "./lib/google-sheets.mjs";
import { parseTsv, validateTsvSyntax } from "./lib/tsv-utils.mjs";

const rootDir = process.cwd();
const defaultScenarioPath = path.join(selectedScenarioDir(), "scenario.source.json");
const defaultCredentialsPath = "";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function normalizeMatrix(rows, rowCount, columnCount) {
  return Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => String(rows[rowIndex]?.[columnIndex] ?? ""))
  );
}

function extraRemoteCells(remoteRows, rowCount, columnCount) {
  const extras = [];
  for (const [rowIndex, row] of remoteRows.entries()) {
    for (const [columnIndex, value] of row.entries()) {
      if ((rowIndex >= rowCount || columnIndex >= columnCount) && String(value ?? "") !== "") {
        extras.push({ row: rowIndex + 1, column: columnIndex + 1, value: String(value) });
      }
    }
  }
  return extras;
}

function firstDiff(localRows, remoteRows) {
  for (const [rowIndex, localRow] of localRows.entries()) {
    const remoteRow = remoteRows[rowIndex] ?? [];
    for (const [columnIndex, localValue] of localRow.entries()) {
      const remoteValue = remoteRow[columnIndex] ?? "";
      if (localValue !== remoteValue) {
        return {
          row: rowIndex + 1,
          column: columnIndex + 1,
          localValue,
          remoteValue
        };
      }
    }
  }
  return null;
}

function loadLocalSheets(authoring) {
  const exportDir = path.resolve(rootDir, authoring.exportDir);
  return Object.entries(authoring.tables).map(([tableId, sheetName]) => {
    const filePath = path.join(exportDir, `${sheetName}.tsv`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`${tableId}: TSV がありません: ${path.relative(rootDir, filePath)}`);
    }

    const source = fs.readFileSync(filePath, "utf8");
    const errors = validateTsvSyntax(source);
    if (errors.length) throw new Error(`${tableId}: ${errors.join(" ")}`);
    return {
      tableId,
      sheetName,
      rows: parseTsv(source)
    };
  });
}

async function main() {
  validateSheetsArguments(process.argv.slice(2));
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

  const sheets = loadLocalSheets(authoring);
  const credentials = readJson(credentialsPath);
  const token = await accessToken(credentials);
  const mismatches = [];

  for (const sheet of sheets) {
    const remote = await sheetValues(spreadsheetId, token, sheet.sheetName);
    const rowCount = sheet.rows.length;
    const columnCount = maxColumns(sheet.rows);
    const localNormalized = normalizeMatrix(sheet.rows, rowCount, columnCount);
    const remoteNormalized = normalizeMatrix(remote, rowCount, columnCount);
    const diff = firstDiff(localNormalized, remoteNormalized);
    const extras = extraRemoteCells(remote, rowCount, columnCount);

    if (diff || extras.length) {
      mismatches.push({ sheetName: sheet.sheetName, diff, extras });
      continue;
    }

    console.log(`${sheet.sheetName}: OK (${rowCount} rows x ${columnCount} cols)`);
  }

  if (mismatches.length) {
    for (const mismatch of mismatches) {
      console.error(`${mismatch.sheetName}: mismatch`);
      if (mismatch.diff) {
        console.error(
          `  first diff R${mismatch.diff.row}C${mismatch.diff.column}: local=${JSON.stringify(
            mismatch.diff.localValue
          )} remote=${JSON.stringify(mismatch.diff.remoteValue)}`
        );
      }
      if (mismatch.extras.length) {
        const extra = mismatch.extras[0];
        console.error(`  extra remote value R${extra.row}C${extra.column}: ${JSON.stringify(extra.value)}`);
      }
    }
    throw new Error(`${mismatches.length} sheet(s) do not match local TSV.`);
  }

  console.log(`Google Spreadsheet とローカル TSV は一致しています: ${spreadsheetId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
