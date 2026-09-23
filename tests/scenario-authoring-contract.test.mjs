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

test("会話の表示時計は任意設定で、未知の値を制作時に拒否する", () => withAuthoring(({ edit, invoke }) => {
  edit("project_constants", rows => rows.push({ key: "talk.clock", value: "scenario", exposure: "private" }));
  const accepted = invoke('console.log(result.worker.project.talkClock);');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout.trim(), "scenario");
  edit("project_constants", rows => { rows.find(row => row.key === "talk.clock").value = "scenerio"; });
  const rejected = invoke();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /talk.clock.*real\/scenario/u);
}));

test("初期UIの追加設定は公開指定を要求し、作品定数として生成する", () => withAuthoring(({ edit, invoke }) => {
  const keys = ["search_agent.sprite_url", "effect.game_over_image_url", "effect.all_clear_image_url", "start_confirmation.notices"];
  edit("project_constants", rows => keys.forEach(key => rows.push({ key, value: key.endsWith("notices") ? "**注意**\n追加の告知" : "/custom/image.png", exposure: "public" })));
  const accepted = invoke(`console.log(JSON.stringify(${JSON.stringify(keys)}.map(key => result.projectConstants[key])));`);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), ["/custom/image.png", "/custom/image.png", "/custom/image.png", "**注意**\n追加の告知"]);
  for (const key of keys) {
    edit("project_constants", rows => { rows.find(row => row.key === key).exposure = "private"; });
    const rejected = invoke();
    assert.notEqual(rejected.status, 0);
    assert.ok(rejected.stderr.includes(key));
    edit("project_constants", rows => { rows.find(row => row.key === key).exposure = "public"; });
  }
}));

test("親アプリ修復の定数は新しい列なしでboolean設定へ変換され、誤記を拒否する", () => withAuthoring(({ edit, invoke }) => {
  const defaults = invoke('console.log(JSON.stringify([result.worker.project.repairParentApp, result.worker.project.talkClock]));');
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(JSON.parse(defaults.stdout), [false, "real"]);
  edit("project_constants", rows => rows.push({ key: "content.repair_parent_app", value: "true", exposure: "private" }));
  const accepted = invoke('console.log(JSON.stringify(result.worker.project.repairParentApp));');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout), true);
  edit("project_constants", rows => { rows.find(row => row.key === "content.repair_parent_app").value = "yes"; });
  const rejected = invoke();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /content.repair_parent_app.*true\/false/u);
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

test("project.idの前後空白は自動変更せず拒否し、既存の文字種は制限しない", () => withAuthoring(({ edit, invoke }) => {
  for (const id of [" demo", "demo ", "\u3000demo", "demo\n"]) {
    edit("project_constants", (rows) => { rows.find(row => row.key === "project.id").value = id; });
    const result = invoke();
    assert.notEqual(result.status, 0, JSON.stringify(id));
    assert.match(result.stderr, /project.id.*前後.*空白/u);
  }
  edit("project_constants", (rows) => { rows.find(row => row.key === "project.id").value = "作品-ID.v1"; });
  const result = invoke('console.log(JSON.stringify(result.worker.project.id));');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), "作品-ID.v1");
}));

test("初期公開が必要な検索案内文はprivate指定を黙って公開しない", () => withAuthoring(({ edit, invoke }) => {
  for (const key of ["search_agent.broken_link_tutorial_body", "search_agent.broken_link_body"]) {
    edit("project_constants", rows => { rows.find(row => row.key === key).exposure = "private"; });
    const rejected = invoke();
    assert.notEqual(rejected.status, 0);
    assert.ok(rejected.stderr.includes(key));
    assert.match(rejected.stderr, /exposureをpublic/u);
    edit("project_constants", rows => { rows.find(row => row.key === key).exposure = "public"; });
  }
  assert.equal(invoke().status, 0);
}));

test("使用頻度の低いTSV列も素材・フォーム・宛先・入力UIへ変換される", () => withAuthoring(({ edit, invoke }) => {
  edit("home_items", rows => { rows.find(row => row.id === "notes").badge_cond = "session_started"; });
  for (const table of ["message_items", "chat_items"]) edit(table, rows => {
    const row = rows.find(row => !row.comment && row.id);
    row.input_visible = "false";
    row.input_enabled = "false";
  });
  edit("attachments", (rows, headers) => {
    if (!headers.includes("cond")) headers.push("cond");
    rows.push(
      { id: "fixture_image", type: "image", asset: "/fixture/image.webp", content: "fixture_still", search: "資料 写真", search_app: "messages", cond: "session_started" },
      { id: "fixture_audio", type: "audio", asset: "/fixture/audio.wav" }
    );
  });
  edit("photo_items", rows => rows.push({ id: "fixture_still", initial: "normal", image: "fixture_image", audio: "fixture_audio", title: "音声付き画像" }));
  edit("gen_audio", rows => rows.push({ id: "fixture_voice", title: "固定音声", provider: "static" }));
  edit("radio_items", rows => rows.push({
    id: "fixture_radio", initial: "normal", title: "音声確認", audio: "fixture_audio\ngen_audio:fixture_voice",
    form_kind: "html", form_id: "fixture_form", form_label: "投稿", form_url: "/fixture/form.html"
  }));
  edit("mail_items", rows => rows.push({ id: "fixture_mail", from: "差出人", to: "宛先", cc: "控えの宛先", subject: "件名", date: "2026-09-20", body: "本文" }));
  // project_itemsも正式な制作入口。cue.atをfixture専用と誤認して削除しない。
  edit("project_items", rows => rows.push({ id: "fixture_raw_radio", app: "radio", record: JSON.stringify({ programTitle: "時刻形式", audioCues: [{ id: "cue", at: "01:02.5" }] }) }));
  const result = invoke(`console.log(JSON.stringify({
    badge:result.worker.apps.find(x=>x.id==='notes').badgeCond,
    talks:['sms','chat'].map(kind=>{const x=result.worker.talks.find(x=>x.kind===kind);return [x.inputVisible,x.inputEnabled]}),
    attachment:result.worker.attachments.find(x=>x.id==='fixture_image'),
    photo:result.worker.contents.find(x=>x.id==='fixture_still').record,
    radio:result.worker.contents.find(x=>x.id==='fixture_radio').record,
    cc:result.worker.contents.find(x=>x.id==='fixture_mail').record.cc,
    cue:result.worker.contents.find(x=>x.id==='fixture_raw_radio').record.audioCues
  }));`);
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.badge, "session_started");
  assert.deepEqual(actual.talks, [[false, false], [false, false]]);
  assert.equal(actual.attachment.searchApp, "messages");
  assert.equal(actual.attachment.cond, "session_started");
  assert.deepEqual(actual.attachment.search, [["資料", "写真"]]);
  assert.equal(actual.photo.mediaKind, "still_video");
  assert.equal(actual.photo.imageAttachmentId, "fixture_image");
  assert.equal(actual.photo.audioAttachmentId, "fixture_audio");
  assert.deepEqual(actual.radio.audioSegments, [{ kind: "audio", audioAttachmentId: "fixture_audio" }, { kind: "generated", genAudioId: "fixture_voice" }]);
  assert.deepEqual(actual.radio.form, { id: "fixture_form", kind: "html", label: "投稿", url: "/fixture/form.html" });
  assert.equal(actual.cc, "控えの宛先");
  assert.deepEqual(actual.cue, [{ id: "cue", atMs: 62500 }]);
}));

test("hookのliteral schemaだけを実行時と共通の規則で制作検査する", () => withAuthoring(({ edit, invoke }) => {
  edit("project_constants", rows => { rows.find(row => row.key === "features.llm").value = "true"; });
  const setScript = (script) => edit("hooks", rows => {
    const row = rows.find(row => !row.comment && row.id);
    row.script = script;
    row.llm = "true";
  });
  for (const schema of ['{value:"strng"}', '{"bad-key":"string"}', '{}']) {
    setScript(`llm.extract("probe", {input:"入力", instructions:"抽出", schema:${schema}});`);
    const result = invoke();
    assert.notEqual(result.status, 0, schema);
    assert.match(result.stderr, /hooks\..*llm.extract.*schema/u);
  }
  const valid = '{name:"hiragana_1_5", text:"safe_reading_text", result:"string_max_12|null", count:"integer"}';
  for (const script of [
    `context.llm.screen("probe", {source:"作品独自field", instructions:"抽出", schema:${valid}});`,
    'const schema = {value:"string"}; llm.extract("probe", {instructions:"抽出", schema});',
    'const options = {schema:{value:"string"}}; llm.extract("probe", {instructions:"抽出", schema:{value:"strng"}, ...options});',
    'llm.extract("probe", {instructions:"抽出", schema:{value:event.fields.schema}});'
  ]) {
    setScript(script);
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
  }
}));

test("空のパスワードを成功したbuildとして解錠不能な状態へ出力しない", () => withAuthoring(({ edit, invoke }) => {
  edit("passwords", (rows) => { rows.find((row) => !row.comment).password = ""; });
  const result = invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /password|パスワード/u);
}));

test("passwordsはsecretと同じ正規化で、先頭0と内部空白を保持する", () => withAuthoring(({ edit, invoke }) => {
  edit("passwords", (rows) => { rows.find((row) => !row.comment).password = '"  00 42  "\n"ＡＢＣ"\n"abc"'; });
  const result = invoke('console.log(JSON.stringify(result.worker.lockedContentPasswords.flatMap(x=>x.answers)));');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["00 42", "abc"]);
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
