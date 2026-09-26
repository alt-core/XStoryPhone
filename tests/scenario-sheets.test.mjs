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

// CLIと読み手を直接パイプでつなぎ、未送出のstdoutが残る状態での終了を検証する。
const slowOutputPipe = `
import { spawn } from "node:child_process";
const reader = spawn(process.execPath, ["-e", "setTimeout(() => process.stdin.pipe(process.stdout), 300)"], {
  stdio: ["pipe", "inherit", "inherit"]
});
const writer = spawn(process.execPath, process.argv.slice(1), { stdio: ["ignore", reader.stdin, "inherit"] });
// 親側の複製だけを閉じる。end()ではwriter側の送出も止まるため使わない。
reader.stdin.destroy();
writer.on("exit", code => { if (code !== 0) process.exitCode = code ?? 1; });
reader.on("exit", code => { if (code !== 0) process.exitCode = code ?? 1; });
`;

const preload = `
import fs from "node:fs";
const config = JSON.parse(fs.readFileSync(process.env.SHEETS_FIXTURE_CONFIG, "utf8"));
const calls = [];
const titles = config.initialTitles ?? [...new Set([...Object.keys(config.rows ?? {}), ...Object.keys(config.cells ?? {})])];
const asCells = rows => rows.map(row => row.map(value => ({ formattedValue: String(value), userEnteredValue: { stringValue: String(value) } })));
const sheets = titles.map((title, index) => ({
  properties: { title, sheetId: config.ids?.[title] ?? index + 1, gridProperties: { rowCount: 100, columnCount: 26, frozenRowCount: 0 } },
  cells: config.cells?.[title] ?? asCells(config.rows?.[title] ?? [])
}));
let written = false;
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
    if (config.batchStatus) return reply({ error: "fixture_write_failed" }, config.batchStatus);
    for (const request of body.requests) {
      if (request.addSheet) {
        const properties = request.addSheet.properties;
        if (sheets.some(sheet => sheet.properties.sheetId === properties.sheetId)) throw new Error("Sheet IDが重複しています。");
        sheets.push({ properties, cells: [] });
      } else if (request.updateSheetProperties) {
        const properties = request.updateSheetProperties.properties;
        const sheet = sheets.find(sheet => sheet.properties.sheetId === properties.sheetId);
        Object.assign(sheet.properties, properties);
      } else if (request.updateCells) {
        const update = request.updateCells;
        if (update.fields !== "userEnteredValue" || update.start) throw new Error("全範囲の値だけを更新してください。");
        const sheet = sheets.find(sheet => sheet.properties.sheetId === update.range.sheetId);
        if (!sheet) throw new Error("存在しないSheetです。");
        sheet.cells = Array.from({ length: update.range.endRowIndex }, (_, r) =>
          Array.from({ length: update.range.endColumnIndex }, (_, c) => {
            const value = update.rows[r]?.values[c]?.userEnteredValue;
            if (value && typeof value.stringValue !== "string") throw new Error("TSVは文字列として書き込んでください。");
            return value ? { userEnteredValue: value, formattedValue: value.stringValue } : {};
          }));
      } else if (!request.updateDimensionProperties) throw new Error("未定義のbatch requestです。");
    }
    written = true;
    return reply({ replies: [] });
  }
  if (target.searchParams.has("fields")) {
    const ranges = target.searchParams.getAll("ranges");
    if (!ranges.length) return reply({ sheets: sheets.map(({ properties }) => ({ properties })) });
    if (written && config.verifyStatus) return reply({ error: "fixture_verify_failed" }, config.verifyStatus);
    const names = ranges.map(range => range.slice(1, -1).replaceAll("''", "'"));
    if (names.includes(config.failedSheet)) return reply({ error: "fixture_read_failed" }, 503);
    return reply({ sheets: names.map(name => {
      const sheet = sheets.find(sheet => sheet.properties.title === name);
      if (!sheet) throw new Error("取得対象のSheetがありません。");
      const cells = written && config.verifyRows?.[name] ? asCells(config.verifyRows[name]) : sheet.cells;
      return { properties: sheet.properties, data: [{ rowData: cells.map(values => ({ values })) }] };
    }) });
  }
  if (target.pathname.includes("/values/") && method === "GET") {
    const range = decodeURIComponent(target.pathname.split("/values/")[1]);
    const quoted = range.slice(0, range.lastIndexOf("!"));
    const title = quoted.slice(1, -1).replaceAll("''", "'");
    if (title === config.failedSheet) return reply({ error: "fixture_read_failed" }, 503);
    return reply({ values: config.rows?.[title] ?? [] });
  }
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
    function execute(action, config = {}, args = [], extraEnv = {}, slowOutput = false) {
      fs.writeFileSync(configFile, JSON.stringify(config));
      fs.writeFileSync(logFile, "[]");
      const cliArgs = [
        "--import", pathToFileURL(preloadFile).href,
        path.join(root, "scripts", `scenario-sheets-${action}.mjs`), ...args
      ];
      const result = spawnSync(process.execPath, slowOutput
        ? ["--input-type=module", "--eval", slowOutputPipe, "--", ...cliArgs]
        : cliArgs, {
        cwd: temporary,
        encoding: "utf8",
        timeout: slowOutput ? 10000 : undefined,
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
  assert.match(different.stdout, /First R2C2 変更/u);
  assert.match(different.stdout, /Second R1C3 削除/u);
  assert.ok(different.calls.slice(1).every((call) => call.method === "GET"));
  for (const title of ["First", "Second"]) assert.equal(fs.readFileSync(path.join(exports, `${title}.tsv`), "utf8"), source);
}));

for (const action of ["compare", "put"]) {
  test(`${action}の不一致終了でも、遅いパイプへ全差分を出力する`, () => withFixture(({ exports, execute }) => {
    const count = 6000;
    const local = [["id", "value"], ...Array.from({ length: count }, (_, i) => [String(i), `new-value-${i}`])];
    const remote = local.map((row, i) => i === 0 ? row : [row[0], `old-value-${i - 1}`]);
    const source = local.map(row => row.join("\t")).join("\n") + "\n";
    fs.writeFileSync(path.join(exports, "First.tsv"), source);
    // putは事前比較を一致させ、verifyで大量差分を検出して終了する経路を通す。
    const config = action === "put"
      ? { rows: { First: local }, verifyRows: { First: remote } }
      : { rows: { First: remote } };
    const result = execute(action, config, ["--tables", "first", ...(action === "put" ? [confirm, "--verify"] : [])], {}, true);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, action === "put" ? /投入後の1表/u : /1 sheet\(s\) do not match/u);
    assert.equal(result.stdout.match(/^First R\d+C2 変更:/gmu)?.length, count);
    assert.ok(result.stdout.includes(`First R${count + 1}C2 変更:`));
    assert.equal(result.calls.filter(call => call.url.endsWith(":batchUpdate")).length, action === "put" ? 1 : 0);
    assert.equal(fs.readFileSync(path.join(exports, "First.tsv"), "utf8"), source);
  }));
}

test("Sheets投入は全表create・resize・値置換・列幅設定を一つのbatchで行う", () => withFixture(({ exports, execute }) => {
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
  assert.equal(batches.length, 1);
  assert.equal(result.calls.length, 4, "通常putはOAuth・metadata・内容読取・batchだけ");
  const requests = batches[0].body.requests;
  const created = requests.find(request => request.addSheet).addSheet.properties;
  assert.equal(created.title, "Second");
  assert.equal(created.gridProperties.frozenRowCount, 1);
  const resized = requests.find(request => request.updateSheetProperties).updateSheetProperties.properties;
  assert.deepEqual(resized.gridProperties, { rowCount: 2, columnCount: 3, frozenRowCount: 1 });
  const writes = requests.filter(request => request.updateCells).map(request => request.updateCells);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].rows.map(row => row.values.map(cell => cell.userEnteredValue.stringValue)), parseTsv(text));
  assert.equal(writes[1].range.sheetId, created.sheetId);
  assert.equal(result.calls.filter(call => call.url.endsWith(":clear")).length, 0);
  const widths = requests.filter(request => request.updateDimensionProperties);
  assert.equal(widths.length, 5);
  assert.equal(widths[0].updateDimensionProperties.properties.pixelSize, 32);
}));

test("compareとputは指定表だけを読み、追加・変更・余剰セルの削除を最後まで表示する", () => withFixture(({ exports, execute }) => {
  const text = 'id\tvalue\n001\t"新しい本文\n次の行"\n002\t追加\n';
  fs.writeFileSync(path.join(exports, "First.tsv"), text);
  // 対象外のローカルTSVは壊れていても読み込まない。
  fs.writeFileSync(path.join(exports, "Second.tsv"), 'id\n"未終了');
  const config = { rows: { First: [["id", "value", "余剰列"], ["001", "以前", "余剰セル"], [], ...Array.from({ length: 120 }, (_, i) => [`余剰行${i}`])], Second: [["対象外"]] } };
  for (const action of ["compare", "put"]) {
    const result = execute(action, config, ["--tables", "first", ...(action === "put" ? [confirm] : [])]);
    assert.equal(result.status, action === "compare" ? 1 : 0, result.stderr);
    for (const position of ["R1C3 削除", "R2C2 変更", "R2C3 削除", "R3C1 追加", "R3C2 追加", "R123C1 削除"]) assert.ok(result.stdout.includes(position), position);
    assert.ok(result.stdout.includes(JSON.stringify("新しい本文\n次の行")));
    assert.ok(!result.stdout.includes("対象外"));
    const reads = result.calls.filter(call => new URL(call.url).searchParams.has("ranges"));
    assert.equal(reads.length, 1);
    assert.deepEqual(new URL(reads[0].url).searchParams.getAll("ranges"), ["'First'"]);
    assert.ok(new URL(reads[0].url).searchParams.get("fields").includes("userEnteredValue(formulaValue)"), "表示値と数式だけ読み、通常の長文を二重取得しない");
    const batch = result.calls.find(call => call.url.endsWith(":batchUpdate"));
    if (batch) assert.ok(batch.body.requests.every(request => JSON.stringify(request).includes('"sheetId":1')));
    assert.equal(fs.readFileSync(path.join(exports, "First.tsv"), "utf8"), text);
  }
}));

test("put dry-runは確認flagなしで新Sheetもプレビューし、remoteへ一切書き込まない", () => withFixture(({ exports, execute }) => {
  fs.writeFileSync(path.join(exports, "First.tsv"), "id\n001\n");
  for (const flags of [["--dry-run"], ["--dry-run", confirm]]) {
    for (const exists of [false, true]) {
      const config = exists ? { rows: { First: [["id"], ["old"]] } } : { initialTitles: ["Second"] };
      const result = execute("put", config, ["--tables", "first", ...flags]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, exists ? /remote="old"/u : /作成対象/u);
      assert.match(result.stdout, /dry-run/u);
      assert.equal(result.calls.length, exists ? 3 : 2, "新Sheetにはmetadata以外の読取りも不要");
      assert.ok(result.calls.slice(1).every(call => call.method === "GET"));
    }
  }
}));

test("put verifyは対象だけを一度再取得し、失敗しても自動で再上書きしない", () => withFixture(({ exports, execute }) => {
  fs.writeFileSync(path.join(exports, "First.tsv"), "id\n001\n");
  const config = { rows: { First: [["id"], ["old"], ["余剰"]], Second: [["対象外"]] } };
  for (const mismatch of [false, true]) {
    const result = execute("put", { ...config, ...(mismatch ? { verifyRows: { First: [["id"], ["wrong"], ["extra"]] } } : {}) }, [confirm, "--verify", "--tables", "first"]);
    assert.equal(result.status, mismatch ? 1 : 0, result.stderr);
    assert.equal(result.calls.filter(call => call.url.endsWith(":batchUpdate")).length, 1);
    assert.equal(result.calls.length, 5);
    const reads = result.calls.filter(call => new URL(call.url).searchParams.has("ranges"));
    assert.equal(reads.length, 2);
    assert.ok(reads.every(call => new URL(call.url).searchParams.get("ranges") === "'First'"));
    if (mismatch) {
      assert.match(result.stdout, /remote="wrong"/u);
      assert.match(result.stdout, /remote="extra"/u);
      assert.match(result.stderr, /自動で再上書きはしません/u);
    } else assert.match(result.stdout, /verify: 対象の全表/u);
  }
}));

test("同じ表示値の数式も置換として表示し、先頭ゼロ・数式風の文字列はRAW相当で保持する", () => withFixture(({ exports, execute }) => {
  fs.writeFileSync(path.join(exports, "First.tsv"), "id\ttext\n001\t=1+1\n");
  const config = { cells: { First: [
    [{ formattedValue: "id" }, { formattedValue: "text" }],
    [{ formattedValue: "001", userEnteredValue: { formulaValue: '=TEXT(1,"000")' } }, { formattedValue: "=1+1" }]
  ] } };
  const compared = execute("compare", config, ["--tables", "first"]);
  assert.equal(compared.status, 1);
  assert.match(compared.stdout, /R2C1 数式を文字列へ変更/u);
  assert.ok(compared.stdout.includes(JSON.stringify('=TEXT(1,"000")')));
  const result = execute("put", config, [confirm, "--tables", "first", "--verify"]);
  assert.equal(result.status, 0, result.stderr);
  const rows = result.calls.find(call => call.url.endsWith(":batchUpdate")).body.requests.find(request => request.updateCells).updateCells.rows;
  assert.deepEqual(rows[1].values.map(cell => cell.userEnteredValue), [{ stringValue: "001" }, { stringValue: "=1+1" }]);
}));

test("空TSVとヘッダーだけのTSVも余剰セルを消し、差分なしのputでも既存の整形を保つ", () => withFixture(({ exports, execute }) => {
  for (const source of ["", "id\n", "id\n001\n"]) {
    fs.writeFileSync(path.join(exports, "First.tsv"), source);
    const result = execute("put", { rows: { First: [["id", "extra"], ["001", "余剰"], ["old"]] } }, [confirm, "--tables", "first", "--verify"]);
    assert.equal(result.status, 0, result.stderr);
    const requests = result.calls.find(call => call.url.endsWith(":batchUpdate")).body.requests;
    const grid = requests.find(request => request.updateSheetProperties).updateSheetProperties.properties.gridProperties;
    assert.equal(grid.rowCount, source ? 2 : 1);
    assert.equal(grid.columnCount, 1);
    assert.equal(grid.frozenRowCount, source ? 1 : 0);
  }
  const unchanged = execute("put", { rows: { First: [["id"], ["001"]] } }, [confirm, "--tables", "first"]);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /First: OK/u);
  assert.ok(unchanged.calls.find(call => call.url.endsWith(":batchUpdate")).body.requests.some(request => request.updateDimensionProperties));
}));

test("新SheetのIDは対象外も含めて衝突を避け、引用符を含むSheet名でもverifyできる", () => {
  withFixture(({ exports, execute }) => {
    fs.writeFileSync(path.join(exports, "作者's notes.tsv"), "id\n001\n");
    const result = execute("put", { initialTitles: ["Other", "First"], ids: { Other: 0, First: 1 } }, [confirm, "--verify"]);
    assert.equal(result.status, 0, result.stderr);
    const properties = result.calls.find(call => call.url.endsWith(":batchUpdate")).body.requests[0].addSheet.properties;
    assert.equal(properties.sheetId, 2);
    assert.equal(properties.title, "作者's notes");
    assert.equal(new URL(result.calls.at(-1).url).searchParams.get("ranges"), "'作者''s notes'");
  }, { tables: { note: "作者's notes" } });
});

test("putの読取り・一括書込み・verifyの失敗はその場で止まり、消去や再試行を追加しない", () => withFixture(({ exports, execute }) => {
  for (const title of ["First", "Second"]) fs.writeFileSync(path.join(exports, `${title}.tsv`), "id\nnew\n");
  for (const failure of [{ failedSheet: "Second" }, { batchStatus: 400 }, { verifyStatus: 503 }]) {
    const result = execute("put", { rows: { First: [["old"]], Second: [["old"]] }, ...failure }, [confirm, "--verify"]);
    assert.equal(result.status, 1);
    assert.equal(result.calls.filter(call => call.url.endsWith(":batchUpdate")).length, failure.failedSheet ? 0 : 1);
    assert.equal(result.calls.filter(call => call.url.endsWith(":clear")).length, 0);
    assert.equal(result.calls.length, failure.failedSheet ? 3 : failure.batchStatus ? 4 : 5);
  }
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
  for (const action of ["pull", "compare", "put"]) {
    for (const args of [["--tables", "typo"], ["--tables", "toString"], ["--tables", ","], ["--tables", "first,first"], ["--tablse", "first"], ["--tables"]]) {
      const result = execute(action, {}, [...(action === "put" ? [confirm] : []), ...args]);
      assert.equal(result.status, 1);
      assert.deepEqual(result.calls, []);
    }
  }
  for (const args of [["--dry-run", "--verify"], ["--dry-run", "--dry-run"], ["--verify"]]) {
    const result = execute("put", {}, args);
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
