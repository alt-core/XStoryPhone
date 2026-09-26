import fs from "node:fs";
import path from "node:path";
import { maxColumns, quoteSheetName, sheetsRequest } from "./google-sheets.mjs";
import { parseTsv, validateTsvSyntax } from "./tsv-utils.mjs";

export function loadLocalSheets(authoring, entries) {
  return entries.map(([tableId, sheetName]) => {
    const filePath = path.join(authoring.exportDir, `${sheetName}.tsv`);
    if (!fs.existsSync(filePath)) throw new Error(`${tableId}: TSV がありません: ${filePath}`);
    const source = fs.readFileSync(filePath, "utf8");
    const errors = validateTsvSyntax(source);
    if (errors.length) throw new Error(`${tableId}: ${errors.join(" ")}`);
    return { tableId, sheetName, rows: parseTsv(source) };
  });
}

// 指定した表だけを一度に読む。表示値と数式を同じ応答で取得し、追加の照合通信はしない。
export async function readSheetCells(spreadsheetId, token, sheetNames) {
  if (!sheetNames.length) return new Map();
  const query = new URLSearchParams({
    fields: "sheets(properties(title),data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue(formulaValue)))))"
  });
  for (const name of sheetNames) query.append("ranges", quoteSheetName(name));
  const response = await sheetsRequest(spreadsheetId, token, `?${query}`);
  const sheets = new Map((response.sheets ?? []).map(sheet => {
    const cells = [];
    for (const grid of sheet.data ?? []) {
      for (const [rowIndex, row] of (grid.rowData ?? []).entries()) {
        const target = cells[(grid.startRow ?? 0) + rowIndex] ??= [];
        for (const [columnIndex, cell] of (row.values ?? []).entries()) target[(grid.startColumn ?? 0) + columnIndex] = cell;
      }
    }
    return [sheet.properties.title, { cells }];
  }));
  for (const name of sheetNames) if (!sheets.has(name)) throw new Error(`Google Sheetの取得結果がありません: ${name}`);
  return sheets;
}

export function existingSheetNames(metadata, sheets) {
  const existing = new Set(metadata.sheets.map(sheet => sheet.properties.title));
  return sheets.map(sheet => sheet.sheetName).filter(name => existing.has(name));
}

// 向きは常にremote→local。putで消える余剰セルも、同じ表示値の数式も省略しない。
export function printSheetDiff(sheet, remote) {
  const cells = remote?.cells ?? [];
  let count = 0;
  if (!remote) console.log(`${sheet.sheetName}: Google Sheetsに存在しません（作成対象）`);
  for (let row = 0; row < Math.max(sheet.rows.length, cells.length); row += 1) {
    const localRow = sheet.rows[row] ?? [];
    const remoteRow = cells[row] ?? [];
    for (let column = 0; column < Math.max(localRow.length, remoteRow.length); column += 1) {
      const localValue = String(localRow[column] ?? "");
      const remoteValue = String(remoteRow[column]?.formattedValue ?? "");
      const formula = remoteRow[column]?.userEnteredValue?.formulaValue;
      if (localValue === remoteValue && formula === undefined) continue;
      const kind = formula !== undefined ? "数式を文字列へ変更" : localValue === "" ? "削除" : remoteValue === "" ? "追加" : "変更";
      const formulaLabel = formula === undefined ? "" : ` formula=${JSON.stringify(formula)}`;
      console.log(`${sheet.sheetName} R${row + 1}C${column + 1} ${kind}: remote=${JSON.stringify(remoteValue)}${formulaLabel} → local=${JSON.stringify(localValue)}`);
      count += 1;
    }
  }
  console.log(count ? `${sheet.sheetName}: ${count}セルの差分` : `${sheet.sheetName}: ${remote ? "OK" : "値の差分なし"} (${sheet.rows.length} rows x ${maxColumns(sheet.rows)} cols)`);
  return !remote || count > 0;
}
