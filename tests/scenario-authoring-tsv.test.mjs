import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadScenarioAuthoring, compileScenarioAuthoring } from "../scripts/lib/scenario-authoring.mjs";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { assignRuleIds } from "../scripts/lib/rule-ids.mjs";
import { resolveMediaRecord } from "../src/shared/scenarioMedia.ts";

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-all-tables-"));
  try { fs.cpSync("scenario/demo", dir, { recursive: true }); return run(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const loadInChild = (dir) => spawnSync(process.execPath, [path.resolve("scripts/scenario-validate.mjs")], {
  env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: dir }, encoding: "utf8"
});

test("Google Sheets原本の全表を取得TSVとして読み込み、JSONを読まない", () => fixture((dir) => {
  const { workbook, source, hookScripts } = loadScenarioAuthoring(dir);
  assert.equal(Object.keys(workbook).length, 26);
  for (const id of ["project_constants", "state_vars", "home_items", "message_items", "chat_items", "call_items", "gen_audio", "incoming_calls", "todo_items", "hooks", "passwords", "calendar_items", "photo_items", "note_items", "radio_items", "notifications", "talk_people", "talk_flow", "talk_blocks", "assistant_messages", "attachments"]) assert.ok(workbook[id], id);
  assert.equal(source.contents.find(c => c.id === "old_note").record.title, "古いメモ");
  assert.equal(resolveMediaRecord(source.contents.find(c => c.id === "rainy_window").record,source.attachments).imageUrl, "/demo/album/rainy-window.webp");
  assert.ok(hookScripts.mark_session_started.includes('state.set("session_started", true)'));
  assert.equal(source.talkPeople.find(p => p.id === "guide").name, "デモ連絡先");
  fs.writeFileSync(path.join(dir, "scenario.json"), "壊れた旧形式は原本として読まない");
  assert.equal(loadInChild(dir).status, 0);
}));

test("メモ本文の改行・quoteと素材参照、stateの型・空欄継承を保持する", () => {
  const { workbook } = loadScenarioAuthoring("scenario/demo");
  const copy = structuredClone(workbook);
  copy.note_items.rows[0].body = '一行目\n"引用"と二行目';
  copy.state_vars.rows.push({ id: "fixture_name", type: "string", initial: "0012", public: "true", comment: "" });
  const { source } = compileScenarioAuthoring(copy);
  assert.equal(source.contents.find(c => c.id === copy.note_items.rows[0].id).record.body, '一行目\n"引用"と二行目');
  assert.equal(source.stateVariables.fixture_name.initial, "0012");
  assert.ok(source.publicStateVariables.includes("fixture_name"));
  const attachment = copy.attachments.rows.find(a => a.type === "image");
  attachment.asset = "/fixture/unreached-image.webp";
  const photo = copy.photo_items.rows.find(p => p.image === attachment.id);
  const updated=compileScenarioAuthoring(copy).source;
  assert.equal(resolveMediaRecord(updated.contents.find(c => c.id === photo.id).record,updated.attachments).imageUrl, "/fixture/unreached-image.webp");
});

test("TSVの表・列・素材参照を欠落させても成功扱いにしない", () => fixture((dir) => {
  const note = path.join(dir, "authoring/note_items.tsv");
  const before = fs.readFileSync(note, "utf8");
  fs.writeFileSync(note, before.replace("\tbody\t", "\tbodi\t"));
  assert.throws(() => loadScenarioAuthoring(dir), /必須headerがありません: body/u);
  fs.writeFileSync(note, before);
  const photo = path.join(dir, "authoring/photo_items.tsv");
  const photoBefore = fs.readFileSync(photo, "utf8");
  fs.writeFileSync(photo, photoBefore.replace("rainy_window_image", "missing_attachment"));
  assert.throws(() => loadScenarioAuthoring(dir), /素材参照が不正/u);
  fs.writeFileSync(photo, photoBefore);
  fs.unlinkSync(note);
  assert.throws(() => loadScenarioAuthoring(dir), /ENOENT/u);
}));

test("制作者定数を変更でき、private定数・正解・本文を初期clientへ配らない", () => {
  const { source } = loadScenarioAuthoring("scenario/demo");
  source.projectConstants["search_agent.broken_link_body"] = "別の口調の修復案内";
  source.projectConstants["private.fixture"] = "未到達の固有ヒント";
  source.publicProjectConstants["public.fixture"] = "公開する短いラベル";
  const result = loadAndValidateScenario({ source });
  assert.equal(result.projectConstants["searchAgent.broken_link_body"], "別の口調の修復案内");
  assert.equal(result.projectConstants["public.fixture"], "公開する短いラベル");
  assert.equal(JSON.stringify(result.projectConstants).includes("未到達の固有ヒント"), false);
  assert.deepEqual(result.deviceState.notes, []);
  assert.deepEqual(result.deviceState.photos, []);
});

test("行位置・notes・exampleでIDを変えず、異なる分岐定義を区別する", () => {
  const rule = { talkId: "talk", from: "from", isDefault: false, cond: "flag", intent: "yes", criteria: "/yes/u", match: "", outputSteps: [{ kind: "block", blockId: "ok" }], mode: "", set: ["flag = true"], order: 2, notes: "メモ", example: "yes" };
  const id = value => assignRuleIds([value])[0].id;
  assert.match(id(rule), /^rule_[0-9a-f]{16}$/u);
  assert.equal(id(rule).length, 21);
  assert.equal(id(rule), id({ ...rule, order: 123, notes: "編集", example: "変更" }));
  for (const change of [{ cond: "!flag" }, { criteria: "/no/u" }, { mode: "stay" }, { set: [] }, { match: '{"name":"名前"}' }, { outputSteps: [{ kind: "input", action: "hide" }] }]) assert.notEqual(id(rule), id({ ...rule, ...change }));
  assert.equal(new Set(assignRuleIds([rule, rule]).map(r => r.id)).size, 2, "完全重複の記述を勝手に禁止しない");
  assert.throws(() => assignRuleIds([rule, { ...rule, cond: "!flag" }], () => "forced_collision"), /衝突/u);
});

test("空の初期履歴とsystem発話者を作者が定義できる", () => {
  const { source } = loadScenarioAuthoring("scenario/demo");
  source.talkPeople.push({ id: "system_notice", name: "システム", role: "system" });
  source.talks.push({ id: "empty_room", kind: "sms", appId: "messages", label: "履歴なし", startBlocks: [] });
  const result = loadAndValidateScenario({ source });
  assert.equal(result.worker.talks.find(t => t.id === "empty_room").initialFrom, "");
  assert.equal(result.worker.talkPeople.find(p => p.id === "system_notice").role, "system");
});

test("空欄継承の明示解除を二重適用で復活させず、空行を誤った有効行にしない", () => fixture((dir) => {
  const file = path.join(dir, "authoring/talk_flow.tsv");
  const original = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, original + "\n\n");
  assert.equal(loadInChild(dir).status, 0);
  const lines = original.split("\n");
  const first = lines.findIndex(line => line.startsWith("\tguide\tintro\t"));
  assert.ok(first > 0);
  const cells = lines[first].split("\t");
  cells[1] = "-";
  lines.splice(first + 1, 0, cells.join("\t"));
  fs.writeFileSync(file, lines.join("\n"));
  const result = loadInChild(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /talkは必須/u);
}));

test("hookの参照IDを生成前に検査し、任意のclient定数まで予約しない", () => fixture((dir) => {
  const constants = path.join(dir, "authoring/project_constants.tsv");
  fs.appendFileSync(constants, '\n\tclient.author_label\t作者の設定\tprivate\t\n');
  assert.equal(loadInChild(dir).status, 0);
  const hooks = path.join(dir, "authoring/hooks.tsv");
  const original = fs.readFileSync(hooks, "utf8");
  fs.writeFileSync(hooks, original.replace('todo.add(""find_old_note"")', 'todo.add(""missing_todo"")'));
  const result = loadInChild(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /todo.addのIDが未定義です: missing_todo/u);
}));
