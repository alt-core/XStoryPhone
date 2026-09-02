import fs from "node:fs";

export function validateTsvSyntax(value) {
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"' && cell === "") quoted = true;
    else if (char === "\t" || char === "\n") cell = "";
    else if (char !== "\r") cell += char;
  }
  return quoted ? ["TSVの引用符が閉じていません。"] : [];
}

function parsedTsv(value) {
  const errors = validateTsvSyntax(value);
  if (errors.length) throw new Error(errors[0]);
  return parseTsv(value);
}

export function parseTsv(value) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"" && cell === "") {
      quoted = true;
    } else if (char === "\t") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function recordsFromRows(rows, { trimHeaders = false, normalizeNewlines = false, includeRowNumber = false } = {}) {
  const headers = trimHeaders ? rows[0]?.map((header) => header.trim()) ?? [] : rows[0] ?? [];
  const records = rows.slice(1).map((row, index) => {
    const record = includeRowNumber ? { __rowNumber: index + 2 } : {};
    for (const [columnIndex, header] of headers.entries()) {
      const value = row[columnIndex] ?? "";
      record[header] = normalizeNewlines ? value.replace(/\r\n/g, "\n") : value;
    }
    return record;
  });

  return { headers, records };
}

export function loadTsvRecords(filePath, options = {}) {
  const rows = parsedTsv(fs.readFileSync(filePath, "utf8"));
  return recordsFromRows(rows, options).records;
}

export function loadTsvSheet(filePath, options = {}) {
  const rows = parsedTsv(fs.readFileSync(filePath, "utf8"));
  const { headers, records } = recordsFromRows(rows, { ...options, includeRowNumber: true });
  return { headers, rows: records };
}

export function inheritColumns(rows, columns) {
  if (!columns.length) {
    return rows ?? [];
  }

  const currentValues = Object.fromEntries(columns.map((column) => [column, ""]));

  return (rows ?? []).map((row) => {
    const nextRow = { ...row };
    const comment = String(row.comment ?? "").trim();

    if (comment) {
      return nextRow;
    }

    for (const column of columns) {
      const value = text(row, column);
      if (value === "-") {
        currentValues[column] = "";
        nextRow[column] = "";
      } else if (value) {
        currentValues[column] = value;
        nextRow[column] = value;
      } else if (currentValues[column]) {
        nextRow[column] = currentValues[column];
      }
    }

    return nextRow;
  });
}

export function activeRows(rows) {
  return (rows ?? []).filter((row) => !String(row.comment ?? "").trim());
}

export function activeSheetRows(sheet) {
  return activeRows(sheet?.rows ?? []);
}

export function generatedSheetRows(sheet) {
  return (sheet?.rows ?? []).filter((row) => {
    const comment = String(row.comment ?? "").trim();
    return !comment || comment.startsWith("*");
  });
}

export function splitList(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function text(row, key) {
  return String(row[key] ?? "").trim();
}

export function optionalText(row, key) {
  const value = text(row, key);
  return value || undefined;
}

export function bool(row, key) {
  return text(row, key) === "true";
}

export function int(row, key) {
  return Number.parseInt(text(row, key), 10) || 0;
}

export function optionalInt(row, key) {
  const value = text(row, key);
  return value ? Number.parseInt(value, 10) || 0 : undefined;
}
