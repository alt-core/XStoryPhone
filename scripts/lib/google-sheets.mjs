import { createSign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const tokenUrl = "https://oauth2.googleapis.com/token";
const sheetsScope = "https://www.googleapis.com/auth/spreadsheets";

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readSheetsAuthoring(manifestFile) {
  const source = readJson(manifestFile);
  const authoring = source.scenarioAuthoring;
  if (!authoring || typeof authoring.exportDir !== "string" || !authoring.exportDir.trim()
    || !authoring.tables || typeof authoring.tables !== "object" || Array.isArray(authoring.tables)
    || !Object.keys(authoring.tables).length) {
    throw new Error("scenarioAuthoring.exportDir / tables がありません。");
  }
  const names = new Set();
  for (const [tableId, sheetName] of Object.entries(authoring.tables)) {
    if (!tableId.trim() || typeof sheetName !== "string" || !sheetName.trim()
      || /[\/\\\u0000-\u001f\u007f]/u.test(sheetName) || [".", ".."].includes(sheetName)
      || names.has(sheetName)) {
      throw new Error(`Sheet名が不正、または重複しています: ${tableId}`);
    }
    names.add(sheetName);
  }
  return { ...authoring, exportDir: path.resolve(path.dirname(manifestFile), authoring.exportDir) };
}

export function validateSheetsArguments(args, { tables = false, overwrite = false } = {}) {
  const valued = new Set(["--scenario", "--credentials", "--spreadsheet-id", ...(tables ? ["--tables"] : [])]);
  const flags = new Set(overwrite ? ["--yes-overwrite-google-sheets-with-local-tsv", "--dry-run", "--verify"] : []);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if ((!valued.has(name) && !flags.has(name)) || seen.has(name)) throw new Error(`未対応または重複した引数です: ${name}`);
    seen.add(name);
    if (flags.has(name)) continue;
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`引数の値がありません: ${name}`);
  }
  if (seen.has("--dry-run") && seen.has("--verify")) throw new Error("--dry-runと--verifyは同時に指定できません。");
}

export function selectedTables(tables, value = "") {
  if (!value) return Object.entries(tables);
  const ids = value.split(",").map(id => id.trim());
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error("--tablesには空欄・重複なしでtable IDをカンマ区切りにしてください。");
  const missing = ids.filter(id => !Object.hasOwn(tables, id));
  if (missing.length) throw new Error(`未定義の table ID です: ${missing.join(", ")}`);
  return Object.entries(tables).filter(([id]) => ids.includes(id));
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: sheetsScope,
    aud: tokenUrl,
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key);
  return `${unsigned}.${base64Url(signature)}`;
}

export async function accessToken(credentials) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: signJwt(credentials)
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token request failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Google OAuth token response に access_token がありません。");
  }
  return payload.access_token;
}

export async function sheetsRequest(spreadsheetId, token, suffix, init = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${suffix}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Google Sheets request failed: ${response.status} ${await response.text()}`);
  }

  return response.status === 204 ? null : response.json();
}

export function quoteSheetName(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export function maxColumns(rows) {
  return Math.max(1, ...rows.map((row) => row.length));
}

export async function spreadsheetMetadata(spreadsheetId, token) {
  return sheetsRequest(spreadsheetId, token, "?fields=sheets(properties(sheetId,title,gridProperties))");
}

export async function sheetValues(spreadsheetId, token, sheetName) {
  const quoted = quoteSheetName(sheetName);
  const payload = await sheetsRequest(
    spreadsheetId,
    token,
    `/values/${encodeURIComponent(`${quoted}!A1:ZZZ`)}?valueRenderOption=FORMATTED_VALUE`
  );
  return payload.values ?? [];
}
