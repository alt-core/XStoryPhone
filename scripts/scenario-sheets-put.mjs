import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { selectedScenarioDir } from "./lib/scenario-directory.mjs";
import {
  accessToken,
  maxColumns,
  readJson,
  readSheetsAuthoring,
  selectedTables,
  sheetsRequest,
  spreadsheetMetadata,
  validateSheetsArguments
} from "./lib/google-sheets.mjs";
import { existingSheetNames, loadLocalSheets, printSheetDiff, readSheetCells } from "./lib/sheets-sync.mjs";

const rootDir = process.cwd();
const defaultScenarioPath = path.join(selectedScenarioDir(), "scenario.source.json");
const defaultCredentialsPath = "";
const requiredConfirmFlag = "--yes-overwrite-google-sheets-with-local-tsv";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}

function textVisualLength(value) {
  return Math.max(
    0,
    ...String(value ?? "")
      .split(/\r?\n/)
      .map((line) =>
        Array.from(line).reduce((total, char) => total + (char.charCodeAt(0) <= 0x7f ? 1 : 2), 0)
      )
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateColumnWidthPx(header, values) {
  const normalizedHeader = String(header ?? "").trim();
  if (normalizedHeader === "comment") {
    return 32;
  }

  const compactHeaders = new Set(["order", "required", "duration_ms", "delay_ms", "photo_count"]);
  if (compactHeaders.has(normalizedHeader)) {
    return 72;
  }

  const mediumHeaders = new Set([
    "app",
    "avatar",
    "audio",
    "block",
    "contact",
    "from",
    "icon",
    "id",
    "image",
    "kind",
    "mode",
    "name",
    "next",
    "sender",
    "status",
    "start",
    "title",
    "to",
    "talk",
    "target",
    "type"
  ]);
  const wideHeaders = new Set(["body", "cond", "content", "extract", "query", "script", "set", "start", "text"]);
  const maxLength = Math.max(textVisualLength(normalizedHeader), ...values.map(textVisualLength));

  if (wideHeaders.has(normalizedHeader)) {
    return clamp(maxLength * 7 + 36, 180, 440);
  }
  if (mediumHeaders.has(normalizedHeader)) {
    return clamp(maxLength * 7 + 28, 88, 220);
  }
  return clamp(maxLength * 7 + 28, 88, 300);
}

function columnWidthRequests(sheetId, rows) {
  return (rows[0] ?? []).map((header, columnIndex) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: columnIndex,
        endIndex: columnIndex + 1
      },
      properties: {
        pixelSize: estimateColumnWidthPx(
          header,
          rows.slice(1).map((row) => row[columnIndex] ?? "")
        )
      },
      fields: "pixelSize"
    }
  }));
}

function putRequests(metadata, sheets) {
  const propertiesByTitle = new Map(metadata.sheets.map(sheet => [sheet.properties.title, sheet.properties]));
  const usedIds = new Set(metadata.sheets.map(sheet => sheet.properties.sheetId));
  let nextId = 0;
  const requests = [];
  for (const { sheetName, rows } of sheets) {
    const existing = propertiesByTitle.get(sheetName);
    while (usedIds.has(nextId)) nextId += 1;
    const sheetId = existing?.sheetId ?? nextId;
    usedIds.add(sheetId);
    const gridProperties = { rowCount: Math.max(rows.length ? 2 : 1, rows.length), columnCount: maxColumns(rows), frozenRowCount: rows.length ? 1 : 0 };
    const previous = existing?.gridProperties;
    console.log(`${sheetName}: ${existing ? "更新" : "作成"} ${previous ? `${previous.rowCount} rows x ${previous.columnCount} cols → ` : ""}${gridProperties.rowCount} rows x ${gridProperties.columnCount} cols、先頭行固定=${gridProperties.frozenRowCount}、列幅を調整`);
    requests.push(existing ? {
      updateSheetProperties: { properties: { sheetId, gridProperties }, fields: "gridProperties(rowCount,columnCount,frozenRowCount)" }
    } : { addSheet: { properties: { sheetId, title: sheetName, gridProperties } } });
    // 空欄を含む全範囲の値を置換する。消去だけが先に確定する通信を作らない。
    requests.push({ updateCells: {
      range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endRowIndex: gridProperties.rowCount, endColumnIndex: gridProperties.columnCount },
      rows: rows.map(row => ({ values: row.map(value => ({ userEnteredValue: { stringValue: value } })) })),
      fields: "userEnteredValue"
    } }, ...columnWidthRequests(sheetId, rows));
  }
  return requests;
}

async function main() {
  validateSheetsArguments(process.argv.slice(2), { tables: true, overwrite: true });
  if (!hasArg("--dry-run") && !hasArg(requiredConfirmFlag)) {
    throw new Error(
      `Google Spreadsheet をローカル TSV で上書きする危険な操作です。実行する場合は ${requiredConfirmFlag} を明示してください。`
    );
  }

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
  console.log(`投入先: ${spreadsheetId} / 対象: ${sheets.map(sheet => `${sheet.tableId} (${sheet.sheetName})`).join(", ")}`);
  for (const sheet of sheets) printSheetDiff(sheet, remote.get(sheet.sheetName));
  const requests = putRequests(metadata, sheets);
  if (hasArg("--dry-run")) {
    console.log("dry-run: Google Sheetsへ書き込んでいません。");
    return;
  }
  await sheetsRequest(spreadsheetId, token, ":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  console.log(`Google Spreadsheet へ TSV を投入しました: ${spreadsheetId}`);
  if (hasArg("--verify")) {
    const verified = await readSheetCells(spreadsheetId, token, sheets.map(sheet => sheet.sheetName));
    console.log("投入後の再比較:");
    let mismatches = 0;
    for (const sheet of sheets) if (printSheetDiff(sheet, verified.get(sheet.sheetName))) mismatches += 1;
    if (mismatches) throw new Error(`投入後の${mismatches}表がローカルTSVと一致しません。自動で再上書きはしません。`);
    console.log("verify: 対象の全表がローカルTSVと一致しました。");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
