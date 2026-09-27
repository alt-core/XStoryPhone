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

test("案内triggerは対象アプリと文脈を検査し、共通行を未取得partや条件で隠せない", () => withAuthoring(({ edit, invoke }) => {
  edit("assistant_messages", rows => rows.push({id:"event_hint",trigger:"app_unavailable:messages",body:"アプリ案内"}));
  assert.equal(invoke().status,0);
  for (const trigger of ["home","screen:unknown","search_open_failed:messages"]) {
    edit("assistant_messages", rows => {rows.find(row=>row.id==="event_hint").trigger=trigger;});
    assert.match(invoke().stderr,/triggerが不正/u);
  }
  edit("assistant_messages", rows => {rows.find(row=>row.id==="event_hint").trigger="app_unavailable:messages";});
  for (const trigger of ["blocked_link","search_open_failed","album_added","repaired","history_repaired"]) {
    edit("assistant_messages", rows => {rows.find(row=>row.trigger===trigger).cond="false";});
    assert.match(invoke().stderr,new RegExp(`trigger=${trigger}.*共通行`,"u"));
    edit("assistant_messages", rows => {rows.find(row=>row.trigger===trigger).cond="";});
  }
  edit("assistant_messages", rows => {const index=rows.findIndex(row=>row.trigger==="search_open_failed"); const [row]=rows.splice(index,1); rows.push({comment:"#later"},row);});
  assert.match(invoke().stderr,/trigger=search_open_failed.*共通行/u);
}));

test("案内のweightは0を許可し、負数と全て無効な共通案内を制作時に拒否する", () => withAuthoring(({ edit, invoke }) => {
  edit("assistant_messages", rows => rows.push({id:"inactive_hint",trigger:"screen:home",body:"停止中の案内",weight:"0"}));
  assert.equal(invoke().status, 0);
  edit("assistant_messages", rows => {rows.find(row=>row.id==="inactive_hint").weight="-1";});
  assert.match(invoke().stderr, /weight は0以上の有限数/u);
  edit("assistant_messages", rows => {
    rows.find(row=>row.id==="inactive_hint").weight="0";
    rows.find(row=>row.trigger==="blocked_link").weight="0";
  });
  assert.match(invoke().stderr, /trigger=blocked_link.*weightが正/u);
}));

test("開錠対象の重複とapp/contentのID衝突を制作時に拒否する", () => withAuthoring(({ edit, invoke }) => {
  edit("attachments", rows => rows.push({id:"other_file",type:"document",content:"sealed_note",lock:"password",body:"別の文書"}));
  assert.match(invoke().stderr,/開錠content=sealed_noteに複数の添付/u);
  edit("attachments", rows => rows.splice(rows.findIndex(row=>row.id==="other_file"),1));
  edit("note_items", rows => rows.push({id:"photos",title:"同名",body:"本文"}));
  assert.match(invoke().stderr,/content id がapp idと重複/u);
}));

test("空欄で全対象にできるhookは明示的な全対象も同じ意味で受け付ける", () => withAuthoring(({ edit, invoke }) => {
  edit("hooks", rows=>rows.push({event:"content_opened",target:"*",script:'state.set("session_started", true);'}));
  assert.equal(invoke().status,0);
  edit("hooks", rows=>{rows[rows.length-1].event="scheduled_event";});
  assert.match(invoke().stderr,/schedule targetが不正/u);
}));

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
  assert.equal(invoke('console.log(result.projectConstants["talk.clock"]);').stdout.trim(), "real");
  edit("project_constants", rows => {
    rows.push({ key: "talk.clock", value: "scenario", exposure: "private" });
    rows.push({ key: "fixture.private", value: "非公開の制作値", exposure: "private" });
  });
  const accepted = invoke('console.log(JSON.stringify([result.worker.project.talkClock, result.projectConstants["talk.clock"], result.projectConstants["fixture.private"] ?? null]));');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), ["scenario", "scenario", null], "表示時計のモードだけを公開し、ほかのprivate定数を混ぜない");
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

test("生成音声fallbackは音声添付IDだけを受理し、素材URLを定義へ複製しない", () => withAuthoring(({ edit, invoke }) => {
  edit("gen_audio", (rows, headers) => {
    if (!headers.includes("fallback")) headers.push("fallback");
    rows[0].fallback = "fallback_fixture";
  });
  edit("attachments", rows => rows.push({ id: "fallback_fixture", type: "audio", asset: "/fixture/fallback-private.wav" }));
  const accepted = invoke('console.log(JSON.stringify(result.worker.generatedAudio[0]));');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).fallbackAttachmentId, "fallback_fixture");
  assert.equal(accepted.stdout.includes("fallback-private.wav"), false);
  edit("attachments", rows => { rows.find(row => row.id === "fallback_fixture").type = "image"; });
  const rejected = invoke();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /fallback.*audio attachment/u);
}));

test("browser入場コードの設定は既定noneで、requiredをstaticへ持ち込めない", () => withAuthoring(({ edit, invoke }) => {
  assert.equal(invoke('console.log(result.worker.project.accessCode);').stdout.trim(), "none");
  edit("project_constants", rows => rows.push({ key: "player.access_code", value: "required", exposure: "private" }));
  const enabled = invoke('console.log(result.projectConstants["player.access_code"]);');
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal(enabled.stdout.trim(), "required");
  edit("project_constants", rows => { rows.find(row => row.key === "player.mode").value = "static"; });
  assert.match(invoke().stderr, /入場認証/u);
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

test("案内のhide列はauto/close/neverで、誤記を拒否する", () => withAuthoring(({ edit, invoke }) => {
  const read = 'console.log(JSON.stringify(result.worker.assistantMessages.map((item) => [item.id, item.hide])));';
  const defaults = invoke(read);
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.equal(JSON.parse(defaults.stdout)[1][1], "auto", "空欄はauto");
  edit("assistant_messages", (rows, headers) => {
    rows[0].hide = "never";
    rows[1].hide = "close";
  });
  const accepted = JSON.parse(invoke(read).stdout);
  assert.deepEqual(accepted.slice(0, 2).map(([, hide]) => hide), ["never", "close"]);
  edit("assistant_messages", rows => { rows[0].hide = "yes"; });
  const rejected = invoke();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /hide.*auto\/close\/never/u);
}));

test("廃止した案内特例・列は黙って無視せず、新しい指定へ誘導する", () => withAuthoring(({ edit, invoke }) => {
  edit("assistant_messages", (_rows, headers) => headers.push("sticky"));
  assert.match(invoke().stderr, /未知または廃止済み.*sticky/u);
  edit("assistant_messages", (_rows, headers) => headers.splice(headers.indexOf("sticky"), 1));
  edit("hooks", (_rows, headers) => headers.push("llm"));
  assert.match(invoke().stderr, /未知または廃止済み.*llm/u);
  edit("hooks", (_rows, headers) => headers.splice(headers.indexOf("llm"), 1));
  edit("project_constants", rows => rows.push({ key: "search_agent.broken_link_tutorial_body", value: "旧案内", exposure: "public" }));
  assert.match(invoke().stderr, /初回案内はassistant_messages/u);
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

test("廃止した検索案内定数を互換読込みせず表のtriggerへ誘導する", () => withAuthoring(({ edit, invoke }) => {
  edit("project_constants", rows => rows.push({key:"search_agent.broken_link_body",value:"旧設定",exposure:"public"}));
  const rejected = invoke();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /trigger=blocked_link/u);
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
      { id: "fixture_image", type: "image", asset: "/fixture/image.webp" },
      { id: "fixture_audio", type: "audio", asset: "/fixture/audio.wav", poster: "fixture_image", content: "fixture_still", search: "資料 写真", search_app: "messages", cond: "session_started" }
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
    attachment:result.worker.attachments.find(x=>x.id==='fixture_audio'),
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
  assert.equal(actual.attachment.poster, "fixture_image");
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
    row.needs_ai = "true";
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

test("作品アプリのiconはregistryを使い、標準アプリのiconはTSVで指定する", () => withAuthoring(({ edit, invoke }) => {
  edit("home_items", rows => rows.push({ id: "case_files", label: "資料", accent: "#888888", initial: "normal", icon: "" }));
  const result = invoke('console.log(JSON.stringify(result.worker.apps.find(app=>app.id==="case_files")));');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).icon, "FolderSearch");
  edit("home_items", rows => { rows.find(row => row.id === "photos").icon = ""; });
  assert.match(invoke().stderr, /home_items!\d+: iconは必須/u);
}));

test("使用されないセルは警告し、参照先の不備は無視しない", () => withAuthoring(({ edit, invoke }) => {
  edit("attachments", rows => rows.push({ id: "fixture_audio", type: "audio", asset: "/fixture/audio.wav" }));
  edit("photo_items", rows => { rows.find(row => row.id === "demo_video").audio = "fixture_audio"; });
  edit("state_vars", rows => rows.push({ id: "fixture_name", type: "string", initial: "", values: "残置した値" }));
  const accepted = invoke();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stderr, /photo_items!\d+.*音声差替えは行いません/u);
  assert.match(accepted.stderr, /state_vars!\d+.*valuesはenum以外では使用しません/u);
  edit("photo_items", rows => { rows.find(row => row.id === "demo_video").audio = "missing_audio"; });
  assert.match(invoke().stderr, /素材参照が不正.*missing_audio/u);
}));

test("ラジオはaudioの一列で固定・単独生成・連結を記述し、fallbackと投稿専用も保つ", () => withAuthoring(({ edit, invoke }) => {
  edit("attachments", rows => rows.push({ id: "fixture_audio", type: "audio", asset: "/fixture/audio.wav" }));
  edit("gen_audio", (rows, headers) => {
    if (!headers.includes("fallback")) headers.push("fallback");
    rows.push({ id: "fixture_job", title: "音声", provider: "fixture", fallback: "fixture_audio" });
  });
  edit("radio_items", rows => rows.push({ id: "fixture_radio", title: "再生", audio: "fixture_audio" }));
  assert.equal(invoke().status, 0);
  edit("radio_items", rows => { rows.find(row => row.id === "fixture_radio").audio = "fixture_audio\ngen_audio:fixture_job\nfixture_audio"; });
  const playlist = invoke('console.log(JSON.stringify(result.worker.contents.find(item=>item.id==="fixture_radio").record));');
  assert.equal(playlist.status, 0, playlist.stderr);
  assert.equal(JSON.parse(playlist.stdout).audioSegments.length, 3);
  edit("radio_items", rows => { rows.find(row => row.id === "fixture_radio").audio = "gen_audio:fixture_job"; });
  const single = invoke('console.log(JSON.stringify(result.worker.contents.find(item=>item.id==="fixture_radio").record));');
  assert.equal(single.status, 0, single.stderr);
  assert.equal(JSON.parse(single.stdout).genAudioId, "fixture_job");
  assert.equal(JSON.parse(single.stdout).audioSegments, undefined);
  edit("radio_items", rows => { Object.assign(rows.find(row => row.id === "fixture_radio"), { audio: "", form_kind: "html", form_id: "fixture_form", form_label: "投稿", form_url: "/fixture/form.html" }); });
  assert.equal(invoke().status, 0, "音声なしのフォーム専用は不具合として禁止しない");
  edit("radio_items", (_rows, headers) => headers.push("gen_audio"));
  assert.match(invoke().stderr, /廃止済みのheader.*gen_audio/u);
}));

test("通話履歴とrecord経由でも固定音声を暗黙のfallbackへ変えない", () => withAuthoring(({ edit, invoke }) => {
  edit("attachments", rows => rows.push({ id: "fixture_audio", type: "audio", asset: "/fixture/audio.wav" }));
  edit("gen_audio", (rows, headers) => {
    if (!headers.includes("fallback")) headers.push("fallback");
    rows.push({ id: "fixture_job", title: "音声", provider: "fixture", fallback: "fixture_audio" });
  });
  edit("call_items", rows => rows.push({ id: "fixture_call", name: "履歴", kind: "incoming", duration: "0:30", audio: "fixture_audio\ngen_audio:fixture_job" }));
  assert.match(invoke().stderr, /audioは一つだけ/u);
  edit("call_items", rows => { rows.find(row => row.id === "fixture_call").audio = "gen_audio:fixture_job"; });
  assert.equal(invoke().status, 0);
  edit("project_items", rows => rows.push({ id: "fixture_raw", app: "radio", record: JSON.stringify({ programTitle: "音声", audioUrl: "/fixture/a.wav", genAudioId: "fixture_job" }) }));
  assert.match(invoke().stderr, /fixture_raw.*同時指定できません/u);
}));

test("hookのLLM依存は実呼出しを見て、コメント・文字列・fallbackと区別する", () => withAuthoring(({ edit, invoke }) => {
  edit("project_constants", rows => { rows.find(row => row.key === "player.mode").value = "static"; });
  const setHook = (script, needsAi = "") => edit("hooks", rows => {
    const row = rows.find(row => row.id === "mark_session_started");
    row.script = script; row.needs_ai = needsAi;
  });
  for (const script of ['// llm.screen("check", options)\nstate.set("session_started", true);', 'const sample = "llm.extract()"; state.set("session_started", true);']) {
    setHook(script);
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
  }
  const options = '{instructions:"判定", schema:{accepted:"boolean"}}';
  for (const call of ["llm.screen", "context.llm.extract", 'llm["screen"]']) {
    setHook(`${call}("check", ${options});`, "false");
    const declared = invoke();
    assert.equal(declared.status, 0, declared.stderr);
    assert.match(declared.stderr, /needs_ai=false.*静的に確認できません/u);
  }
  setHook(`llm.screen("check", ${options});`);
  assert.match(invoke().stderr, /LLM無効/u);
  const fallback = '{instructions:"判定", schema:{accepted:"boolean"}, fallback:{accepted:true}}';
  setHook(`const result = llm.screen("check", ${fallback}); state.set("session_started", result.accepted);`);
  const result = invoke('console.log(JSON.stringify(result.worker.hooks.find(hook=>hook.handler==="mark_session_started")));');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).needsAi, false);
  const executed = invoke(`
    const {compileScenarioHooks}=await import(${JSON.stringify(pathToFileURL(path.resolve("scripts/lib/scenario-hooks.mjs")).href)});
    const {createScenarioRuntime}=await import(${JSON.stringify(pathToFileURL(path.resolve("src/worker/scenarioRuntime.ts")).href)});
    const {createScenarioHooksRuntime}=await import(${JSON.stringify(pathToFileURL(path.resolve("src/worker/services/scenarioHooksRuntime.ts")).href)});
    const {scenarioHookHandlers}=await import('data:text/javascript,'+encodeURIComponent(compileScenarioHooks(result.hookScripts)));
    result.worker.hooks=result.worker.hooks.filter(hook=>hook.handler==='mark_session_started');
    const runtime=createScenarioRuntime(result.worker);
    const hooks=createScenarioHooksRuntime(runtime,scenarioHookHandlers,{});
    const finished=await hooks.runScenarioHooks(runtime.createInitialPlayerState(),{eventId:'session_started'});
    let calls=0;
    const online=[];
    result.worker.features.llm=true;
    for (const needsAi of [false,true]) {
      result.worker.hooks[0].needsAi=needsAi;
      const actual=await hooks.runScenarioHooks(runtime.createInitialPlayerState(),{eventId:'session_started'}, {
        llmProvider:{async completeJson(){calls+=1;return {ok:true,value:{accepted:false}};}}
      });
      online.push(actual.state.stateValues.session_started ?? result.worker.stateVariables.session_started);
    }
    console.log(JSON.stringify({offline:finished.state.stateValues.session_started,calls,online}));
  `);
  assert.equal(executed.status, 0, executed.stderr);
  assert.deepEqual(JSON.parse(executed.stdout), {offline:true,calls:2,online:[false,false]}, "needs_aiはAI使用禁止ではなく、providerなしの場合だけfallbackを使う");
  setHook(`const options = ${fallback}; llm.screen("check", options);`, "false");
  const dynamic = invoke();
  assert.equal(dynamic.status, 0, dynamic.stderr);
  assert.match(dynamic.stderr, /静的に確認できません/u);
  setHook(`if (false) { llm.screen("check", ${options}); }`, "false");
  assert.equal(invoke().status, 0, "作者の明示宣言を到達可能性の推測で覆さない");
  setHook(`if (false) { llm.screen("check", ${options}); }`, "true");
  assert.match(invoke().stderr, /needs_ai=true/u, "明示したAI必須は環境と照合する");
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
