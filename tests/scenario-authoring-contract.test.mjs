import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadTsvSheet } from "../scripts/lib/tsv-utils.mjs";

const scenarioLib = pathToFileURL(path.resolve("scripts/scenario-lib.mjs")).href;
const validator = path.resolve("scripts/scenario-validate.mjs");

function withAuthoring(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-authoring-contract-"));
  try {
    fs.cpSync("scenario/demo", directory, { recursive: true });
    function edit(table, mutate) {
      const file = path.join(directory, "authoring", `${table}.tsv`);
      const sheet = loadTsvSheet(file, { trimHeaders: true, normalizeNewlines: true });
      mutate(sheet.rows, sheet.headers);
      const cell = (value) => {
        const text = String(value ?? "");
        return /[\t\r\n]/u.test(text) || text.startsWith('"') ? `"${text.replaceAll('"', '""')}"` : text;
      };
      fs.writeFileSync(file, [sheet.headers.join("\t"), ...sheet.rows.map((row) => sheet.headers.map((header) => cell(row[header])).join("\t")), ""].join("\n"));
    }
    function invoke(expression) {
      const args = expression ? ["--input-type=module", "--eval", `import { loadAndValidateScenario } from ${JSON.stringify(scenarioLib)}; const result = loadAndValidateScenario(); ${expression}`] : [validator];
      return spawnSync(process.execPath, args, { env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: directory }, encoding: "utf8" });
    }
    return run({ directory, edit, invoke });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("選択先の実TSV定数から作品名とpublic/private境界を生成する", () => withAuthoring(({ edit, invoke }) => {
  edit("project_constants", (rows) => {
    rows.find((row) => row.key === "project.name").value = "選択先のTSV作品";
    rows.push({ key: "fixture.public", value: "公開fixture値", exposure: "public" });
    rows.push({ key: "fixture.private", value: "非公開fixture値", exposure: "private" });
  });
  const result = invoke('console.log(JSON.stringify({name:result.worker.project.name,publicValue:result.projectConstants["fixture.public"],privateInWorker:JSON.stringify(result.worker).includes("非公開fixture値"),privateInClient:JSON.stringify(result.projectConstants).includes("非公開fixture値")}));');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    name: "選択先のTSV作品", publicValue: "公開fixture値", privateInWorker: true, privateInClient: false
  });
}));

test("元TSVの素材typeと予定dateの空欄継承を生成まで保持する", () => withAuthoring(({ edit, invoke }) => {
  edit("attachments", (rows) => rows.push(
    { id: "fixture_image_one", type: "image", asset: "/fixture/one.webp" },
    { id: "fixture_image_two", type: "", asset: "/fixture/two.webp" }
  ));
  edit("calendar_items", (rows) => rows.push(
    { id: "fixture_day_one", title: "予定1", date: "2026-09-20", time: "10:00" },
    { id: "fixture_day_two", title: "予定2", date: "", time: "11:00" }
  ));
  const result = invoke('console.log(JSON.stringify({type:result.worker.attachments.find(x=>x.id==="fixture_image_two").type,date:result.worker.contents.find(x=>x.id==="fixture_day_two").record.date}));');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { type: "image", date: "2026-09-20" });
}));

test("空のパスワードを成功したbuildとして解錠不能な状態へ出力しない", () => withAuthoring(({ edit, invoke }) => {
  edit("passwords", (rows) => { rows.find((row) => !row.comment).password = ""; });
  const result = invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /password|パスワード/u);
}));

test("passwordsの前後空白だけを除き、先頭0と内部空白を保持してhash化する", () => withAuthoring(({ edit, invoke }) => {
  edit("passwords", (rows) => { rows.find((row) => !row.comment).password = "  00 42  "; });
  const result = invoke('console.log(JSON.stringify(result.worker.lockedContentPasswords.map(x=>x.passwordHash)));');
  assert.equal(result.status, 0, result.stderr);
  const expected = createHash("sha256").update("00 42".normalize("NFKC")).digest("hex");
  assert.ok(JSON.parse(result.stdout).includes(expected));
}));

test("integer stateの指数・16進・小数表記を元の整数literalとして受理しない", () => {
  for (const initial of ["1e3", "0x10", "3.0"]) withAuthoring(({ edit, invoke }) => {
    edit("state_vars", (rows) => rows.push({ id: "fixture_integer", type: "integer", initial }));
    const result = invoke();
    assert.notEqual(result.status, 0, initial);
    assert.match(result.stderr, /integer|整数/u);
  });
});

test("空の予約遅延を暗黙の0msへ変換しない", () => withAuthoring(({ edit, invoke }) => {
  edit("schedules", (rows) => rows.push({ id: "fixture_delay", event: "show_demo_call", delay_ms: "" }));
  const result = invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /delay|遅延|整数/u);
}));
