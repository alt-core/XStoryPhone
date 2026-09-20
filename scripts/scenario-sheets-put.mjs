import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  accessToken,
  maxColumns,
  quoteSheetName,
  readJson,
  readSheetsAuthoring,
  sheetsRequest,
  spreadsheetMetadata,
  validateSheetsArguments
} from "./lib/google-sheets.mjs";
import { parseTsv, validateTsvSyntax } from "./lib/tsv-utils.mjs";

const rootDir = process.cwd();
const defaultScenarioPath = path.join(process.env.XSTORYPHONE_SCENARIO_DIR?.trim() || "scenario/demo", "scenario.source.json");
const defaultCredentialsPath = "";
const requiredConfirmFlag = "--yes-overwrite-google-sheets-with-local-tsv";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}

async function ensureSheets(spreadsheetId, token, sheetNames) {
  const metadata = await spreadsheetMetadata(spreadsheetId, token);
  const existing = new Set(metadata.sheets.map((sheet) => sheet.properties.title));
  const requests = sheetNames
    .filter((sheetName) => !existing.has(sheetName))
    .map((sheetName) => ({ addSheet: { properties: { title: sheetName } } }));

  if (requests.length) {
    await sheetsRequest(spreadsheetId, token, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests })
    });
  }

  return spreadsheetMetadata(spreadsheetId, token);
}

async function resizeSheets(spreadsheetId, token, metadata, sheets) {
  const sheetIdByTitle = new Map(metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  const requests = sheets.map(({ sheetName, rows }) => ({
    updateSheetProperties: {
      properties: {
        sheetId: sheetIdByTitle.get(sheetName),
        gridProperties: {
          rowCount: Math.max(rows.length ? 2 : 1, rows.length),
          columnCount: maxColumns(rows),
          frozenRowCount: rows.length ? 1 : 0
        }
      },
      fields: "gridProperties(rowCount,columnCount,frozenRowCount)"
    }
  }));

  await sheetsRequest(spreadsheetId, token, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests })
  });
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
  const wideHeaders = new Set(["body", "cond", "content", "criteria", "match", "query", "script", "set", "start", "text"]);
  const maxLength = Math.max(textVisualLength(normalizedHeader), ...values.map(textVisualLength));

  if (wideHeaders.has(normalizedHeader)) {
    return clamp(maxLength * 7 + 36, 180, 440);
  }
  if (mediumHeaders.has(normalizedHeader)) {
    return clamp(maxLength * 7 + 28, 88, 220);
  }
  return clamp(maxLength * 7 + 28, 88, 300);
}

function columnWidthRequests(metadata, sheets) {
  const sheetIdByTitle = new Map(metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  return sheets.flatMap(({ sheetName, rows }) => {
    const headers = rows[0] ?? [];
    const sheetId = sheetIdByTitle.get(sheetName);
    return headers.map((header, columnIndex) => ({
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
  });
}

async function updateColumnWidths(spreadsheetId, token, metadata, sheets) {
  const requests = columnWidthRequests(metadata, sheets);
  if (!requests.length) {
    return;
  }

  await sheetsRequest(spreadsheetId, token, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests })
  });
}

async function clearAndWriteSheet(spreadsheetId, token, sheetName, rows) {
  const quoted = quoteSheetName(sheetName);
  await sheetsRequest(spreadsheetId, token, `/values/${encodeURIComponent(`${quoted}!A:ZZZ`)}:clear`, {
    method: "POST",
    body: JSON.stringify({})
  });

  await sheetsRequest(
    spreadsheetId,
    token,
    `/values/${encodeURIComponent(`${quoted}!A1`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({
        range: `${quoted}!A1`,
        majorDimension: "ROWS",
        values: rows
      })
    }
  );
}

function loadSheets(authoring) {
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
  if (!hasArg(requiredConfirmFlag)) {
    throw new Error(
      `Google Spreadsheet をローカル TSV で上書きする危険な操作です。実行する場合は ${requiredConfirmFlag} を明示してください。`
    );
  }
  validateSheetsArguments(process.argv.slice(2), { overwrite: true });

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

  const sheets = loadSheets(authoring);
  const credentials = readJson(credentialsPath);
  const token = await accessToken(credentials);
  const metadata = await ensureSheets(spreadsheetId, token, sheets.map((sheet) => sheet.sheetName));
  await resizeSheets(spreadsheetId, token, metadata, sheets);

  for (const sheet of sheets) {
    await clearAndWriteSheet(spreadsheetId, token, sheet.sheetName, sheet.rows);
    console.log(`${sheet.sheetName}: ${sheet.rows.length} rows x ${maxColumns(sheet.rows)} cols`);
  }

  await updateColumnWidths(spreadsheetId, token, metadata, sheets);
  console.log(`Google Spreadsheet へ TSV を投入しました: ${spreadsheetId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
