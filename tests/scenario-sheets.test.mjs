import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { parseTsv } from "../scripts/lib/tsv-utils.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const confirm = "--yes-overwrite-google-sheets-with-local-tsv";
// 実在accountや実秘密を使わず、OAuth署名の経路だけを通す一時鍵。
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const fakeKey = privateKey.export({ type: "pkcs8", format: "pem" });

const preload = `
import fs from "node:fs";
const config = JSON.parse(fs.readFileSync(process.env.SHEETS_FIXTURE_CONFIG, "utf8"));
const calls = [];
const titles = [...(config.initialTitles ?? [])];
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  const method = init.method ?? "GET";
  const oauth = target.hostname === "oauth2.googleapis.com";
  const body = oauth ? null : init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method, body });
  fs.writeFileSync(process.env.SHEETS_FIXTURE_LOG, JSON.stringify(calls));
  if (oauth) return config.oauthStatus ? reply({ error: "fixture_auth_denied" }, config.oauthStatus) : reply({ access_token: "fixture-token" });
  if (target.hostname !== "sheets.googleapis.com") throw new Error("このテストは外部通信を禁止しています。");
  if (config.apiStatus) return reply({ error: "fixture_api_denied" }, config.apiStatus);
  if (target.pathname.endsWith(":batchUpdate")) {
    for (const request of body.requests) if (request.addSheet) titles.push(request.addSheet.properties.title);
    return reply({ replies: [] });
  }
  if (target.searchParams.has("fields")) return reply({ sheets: titles.map((title, index) => ({ properties: { title, sheetId: index + 1 } })) });
  if (target.pathname.includes("/values/") && method === "GET") {
    const range = decodeURIComponent(target.pathname.split("/values/")[1]);
    const quoted = range.slice(0, range.lastIndexOf("!"));
    const title = quoted.slice(1, -1).replaceAll("''", "'");
    if (title === config.failedSheet) return reply({ error: "fixture_read_failed" }, 503);
    return reply({ values: config.rows?.[title] ?? [] });
  }
  if (target.pathname.includes("/values/") && ["POST", "PUT"].includes(method)) return reply({ updatedRows: body?.values?.length ?? 0 });
  throw new Error("未定義のmock requestです。");
};
`;

function withFixture(run, { tables = { first: "First", second: "Second" }, exportDir = "exports" } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-sheets-"));
  try {
    const scenarioDir = path.join(temporary, "nested", "story");
    fs.mkdirSync(scenarioDir, { recursive: true });
    const manifestFile = path.join(scenarioDir, "scenario.source.json");
    fs.writeFileSync(manifestFile, JSON.stringify({ scenarioAuthoring: {
      sourceMode: "tsv-export-first", spreadsheetId: "fixture-manifest", exportDir, tables
    } }));
    const exports = path.resolve(scenarioDir, exportDir);
    fs.mkdirSync(exports, { recursive: true });
    const credentials = path.join(temporary, "fake-credentials.json");
    fs.writeFileSync(credentials, JSON.stringify({ client_email: "fixture@example.invalid", private_key: fakeKey }));
    const preloadFile = path.join(temporary, "mock-fetch.mjs");
    fs.writeFileSync(preloadFile, preload);
    const configFile = path.join(temporary, "config.json");
    const logFile = path.join(temporary, "calls.json");
    function execute(action, config = {}, args = [], extraEnv = {}) {
      fs.writeFileSync(configFile, JSON.stringify(config));
      fs.writeFileSync(logFile, "[]");
      const result = spawnSync(process.execPath, [
        "--import", pathToFileURL(preloadFile).href,
        path.join(root, "scripts", `scenario-sheets-${action}.mjs`), ...args
      ], {
        cwd: temporary,
        encoding: "utf8",
        env: {
          ...process.env,
          XSTORYPHONE_SCENARIO_DIR: scenarioDir,
          XSTORYPHONE_SCENARIO_SPREADSHEET_ID: "",
          GOOGLE_APPLICATION_CREDENTIALS: credentials,
          SHEETS_FIXTURE_CONFIG: configFile,
          SHEETS_FIXTURE_LOG: logFile,
          ...extraEnv
        }
      });
      if (result.error) throw result.error;
      return { ...result, calls: JSON.parse(fs.readFileSync(logFile, "utf8")) };
    }
    return run({ temporary, scenarioDir, manifestFile, exports, credentials, execute });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test("Sheets pullはmanifest親相対へ保存し、引用符・改行・先頭0を保持する", () => withFixture(({ manifestFile, exports, execute }) => {
  const rows = [["comment", "id", "body"], ["", "0012", '先頭の"引用"\n次の行'], ["", "0007", '"quoted"']];
  const result = execute("pull", { rows: { First: rows, Second: [["id"], ["other"]] } }, ["--scenario", manifestFile]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseTsv(fs.readFileSync(path.join(exports, "First.tsv"), "utf8")), rows);
  assert.ok(fs.existsSync(path.join(exports, "Second.tsv")));
  assert.equal(result.calls.length, 3);
  assert.ok(result.calls.slice(1).every((call) => new URL(call.url).searchParams.get("valueRenderOption") === "FORMATTED_VALUE"));
}));

test("Sheets同期もリポジトリで選んだ作品を既定とする", () => withFixture(({ temporary, scenarioDir, exports, execute }) => {
  fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ xstoryphone: { scenarioDir: path.relative(temporary, scenarioDir) } }));
  const config = { rows: { First: [["id"], ["first"]], Second: [["id"], ["second"]] } };
  const pull = execute("pull", config, [], { XSTORYPHONE_SCENARIO_DIR: "" });
  assert.equal(pull.status, 0, pull.stderr);
  assert.ok(fs.readFileSync(path.join(exports, "First.tsv"), "utf8").includes("first"));
  const compare = execute("compare", config, [], { XSTORYPHONE_SCENARIO_DIR: "" });
  assert.equal(compare.status, 0, compare.stderr);
}));

test("Sheets pullは指定tableだけ取得し、全取得が失敗したら既存TSVを更新しない", () => withFixture(({ exports, execute }) => {
  fs.writeFileSync(path.join(exports, "First.tsv"), "id\nold-first\n");
  fs.writeFileSync(path.join(exports, "Second.tsv"), "id\nold-second\n");
  const failed = execute("pull", { rows: { First: [["id"], ["new-first"]] }, failedSheet: "Second" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /503/u);
  assert.equal(fs.readFileSync(path.join(exports, "First.tsv"), "utf8"), "id\nold-first\n");
  assert.equal(fs.readFileSync(path.join(exports, "Second.tsv"), "utf8"), "id\nold-second\n");
  const selected = execute("pull", { rows: { First: [["id"], ["new-first"]] } }, ["--tables", "first"]);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.calls.length, 2);
  assert.equal(fs.readFileSync(path.join(exports, "Second.tsv"), "utf8"), "id\nold-second\n");
}));

test("Sheets比較は差分と余剰セルを検出し、ローカルにもremoteにも書き込まない", () => withFixture(({ exports, execute }) => {
  const source = "id\tvalue\n001\t同じ\n";
  for (const title of ["First", "Second"]) fs.writeFileSync(path.join(exports, `${title}.tsv`), source);
  const same = execute("compare", { rows: { First: [["id", "value"], ["001", "同じ"]], Second: [["id", "value"], ["001", "同じ"]] } });
  assert.equal(same.status, 0, same.stderr);
  const different = execute("compare", { rows: { First: [["id", "value"], ["001", "別"]], Second: [["id", "value", "余剰"], ["001", "同じ"]] } });
  assert.equal(different.status, 1);
  assert.match(different.stderr, /first diff/u);
  assert.match(different.stderr, /extra remote value/u);
  assert.ok(different.calls.slice(1).every((call) => call.method === "GET"));
  for (const title of ["First", "Second"]) assert.equal(fs.readFileSync(path.join(exports, `${title}.tsv`), "utf8"), source);
}));

test("Sheets投入は明示確認後に全表create・resize・clear・RAW write・列幅設定を行う", () => withFixture(({ exports, execute }) => {
  const text = "comment\tid\tbody\n\t0012\t\"複数行\n本文\"\n";
  fs.writeFileSync(path.join(exports, "First.tsv"), text);
  fs.writeFileSync(path.join(exports, "Second.tsv"), "comment\tid\n\t0023\n");
  const denied = execute("put");
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /危険な操作/u);
  assert.deepEqual(denied.calls, []);
  const result = execute("put", { initialTitles: ["First"] }, [confirm]);
  assert.equal(result.status, 0, result.stderr);
  const batches = result.calls.filter((call) => call.url.endsWith(":batchUpdate"));
  assert.deepEqual(batches[0].body.requests, [{ addSheet: { properties: { title: "Second" } } }]);
  assert.equal(batches[1].body.requests.length, 2);
  assert.ok(batches[1].body.requests.every((request) => request.updateSheetProperties.properties.gridProperties.frozenRowCount === 1));
  const writes = result.calls.filter((call) => call.method === "PUT");
  assert.equal(writes.length, 2);
  assert.ok(writes.every((call) => new URL(call.url).searchParams.get("valueInputOption") === "RAW"));
  assert.deepEqual(writes[0].body.values, parseTsv(text));
  assert.equal(result.calls.filter((call) => call.url.endsWith(":clear")).length, 2);
  assert.equal(batches.at(-1).body.requests.length, 5);
  assert.equal(batches.at(-1).body.requests[0].updateDimensionProperties.properties.pixelSize, 32);
}));

test("Sheet名は安全な別名を保ち、traversalと重複を認証前に拒否する", () => {
  for (const sheetName of ["../outside", "dir/name", "dir\\name", "..", "."]) {
    withFixture(({ execute }) => {
      const result = execute("pull");
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Sheet名が不正/u);
      assert.deepEqual(result.calls, []);
    }, { tables: { first: sheetName } });
  }
  withFixture(({ execute }) => {
    const result = execute("pull");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /重複/u);
    assert.deepEqual(result.calls, []);
  }, { tables: { first: "Same", second: "Same" } });
  withFixture(({ exports, execute }) => {
    const result = execute("pull", { rows: { "作者's notes": [["id"], ["001"]] } });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(exports, "作者's notes.tsv")));
    assert.ok(decodeURIComponent(result.calls[1].url).includes("'作者''s notes'!A1:ZZZ"));
  }, { tables: { first: "作者's notes" }, exportDir: "../chosen-export" });
});

test("誤ったtable名・引数と壊れたTSVは認証やremote更新の前に拒否する", () => withFixture(({ exports, execute }) => {
  for (const args of [["--tables", "typo"], ["--tables", "toString"], ["--tablse", "first"], ["--tables"]]) {
    const result = execute("pull", {}, args);
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
  }
  fs.writeFileSync(path.join(exports, "First.tsv"), 'id\n"未終了');
  fs.writeFileSync(path.join(exports, "Second.tsv"), "id\n0001\n");
  for (const action of ["compare", "put"]) {
    const result = execute(action, {}, action === "put" ? [confirm] : []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /引用符が閉じていません/u);
    assert.deepEqual(result.calls, []);
  }
}));

test("OAuth/Sheets認証失敗はその場で止まり、別経路や後続sheetを試さない", () => withFixture(({ exports, execute }) => {
  for (const title of ["First", "Second"]) fs.writeFileSync(path.join(exports, `${title}.tsv`), "id\n001\n");
  for (const action of ["pull", "compare", "put"]) {
    const args = action === "put" ? [confirm] : [];
    const oauth = execute(action, { oauthStatus: 401 }, args);
    assert.equal(oauth.status, 1);
    assert.match(oauth.stderr, /401/u);
    assert.equal(oauth.calls.length, 1);
    const api = execute(action, { apiStatus: 403 }, args);
    assert.equal(api.status, 1);
    assert.match(api.stderr, /403/u);
    assert.equal(api.calls.length, 2);
  }
}));

test("Sheets接続先は明示引数、専用env、manifestの優先順で、credentialの自動探索をしない", () => withFixture(({ execute, credentials }) => {
  const config = { rows: { First: [["id"]], Second: [["id"]] } };
  const environment = execute("pull", config, [], { XSTORYPHONE_SCENARIO_SPREADSHEET_ID: "fixture-env" });
  assert.equal(environment.status, 0, environment.stderr);
  assert.ok(environment.calls[1].url.includes("/fixture-env/"));
  const explicit = execute("pull", config, ["--spreadsheet-id", "fixture-explicit", "--credentials", credentials], {
    XSTORYPHONE_SCENARIO_SPREADSHEET_ID: "fixture-env", GOOGLE_APPLICATION_CREDENTIALS: ""
  });
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.ok(explicit.calls[1].url.includes("/fixture-explicit/"));
  const missing = execute("pull", {}, [], { GOOGLE_APPLICATION_CREDENTIALS: "" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /credential がありません/u);
  assert.deepEqual(missing.calls, []);
}));
