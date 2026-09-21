import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadScenarioAuthoring } from "../scripts/lib/scenario-authoring.mjs";
import { loadTsvSheet, activeRows } from "../scripts/lib/tsv-utils.mjs";
import { applyScenarioAuthoringInheritance } from "../scripts/lib/scenario-authoring-inheritance.mjs";
import { collectScopedTalkBlocks } from "../scripts/lib/talk-blocks.mjs";
import { assignRuleIds } from "../scripts/lib/rule-ids.mjs";
import { scenarioForParts } from "../src/worker/scenarioParts.ts";
import { createScenarioRuntime } from "../src/worker/scenarioRuntime.ts";
import { buildStaticScenario, staticPartLocators } from "../scripts/lib/static-scenario.mjs";
import { validateScenarioParts } from "../scripts/lib/scenario-parts.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-parts-tsv-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync("scenario/demo", root, { recursive: true });
  return {
    root,
    edit(table, change) {
      const file = path.join(root, "authoring", `${table}.tsv`);
      const sheet = loadTsvSheet(file);
      change(sheet.rows, sheet.headers);
      const quote = value => /[\t\r\n"]/u.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
      fs.writeFileSync(file, [sheet.headers, ...sheet.rows.map(row => sheet.headers.map(key => String(row[key] ?? "")))].map(row => row.map(quote).join("\t")).join("\n") + "\n");
    },
    build() {
      const module = pathToFileURL(path.resolve("scripts/scenario-lib.mjs")).href;
      return spawnSync(process.execPath, ["--input-type=module", "-e", `import {loadAndValidateScenario} from ${JSON.stringify(module)};console.log(JSON.stringify(loadAndValidateScenario().worker));`], {
        encoding: "utf8", env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: root }
      });
    }
  };
}

test("static locatorの紛失を自動補完せず、新part追加でも既存取得先を維持する", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-locators-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => staticPartLocators(root, "fixture", ["base", "evidence"]), /取得先対応がありません/u);
  const first = { ...staticPartLocators(root, "fixture", ["base", "evidence"], true) };
  const second = staticPartLocators(root, "fixture", ["base", "evidence", "next"]);
  assert.equal(second.evidence, first.evidence);
  assert.match(second.next, /^[a-f0-9]{32}$/u);
  assert.notEqual(second.next, first.evidence);
  assert.throws(() => staticPartLocators(root, "別作品", ["base"]), /project対応がありません/u);
});

test("part境界は既存の4種の継承を切り、通常コメントや明示解除の意味を変えない", () => {
  for (const [table, column] of [["talk_flow", "talk"], ["hooks", "event"], ["attachments", "type"], ["calendar_items", "date"]]) {
    const rows = applyScenarioAuthoringInheritance(table, [
      { comment: "", [column]: "first" }, { comment: "通常コメント" }, { comment: "", [column]: "" },
      { comment: "#evidence", [column]: "" }, { comment: "", [column]: "" }, { comment: "", [column]: "second" }, { comment: "", [column]: "-" }
    ]);
    assert.equal(rows[2][column], "first");
    assert.equal(rows[4][column], "");
    assert.equal(rows[4].__part, "evidence");
    assert.equal(rows[6][column], "");
  }
  for (const table of ["project_constants", "schedules"]) assert.throws(() => applyScenarioAuthoringInheritance(table, [{ comment: "#evidence" }]), /base専用/u);
  assert.throws(() => applyScenarioAuthoringInheritance("note_items", [{ comment: "#evidence", body: "同じ行に本文" }]), /A列だけ/u);
  assert.throws(() => applyScenarioAuthoringInheritance("note_items", [{ comment: "#not a part" }]), /A列だけ/u);
  assert.throws(() => applyScenarioAuthoringInheritance("note_items", [{ comment: "＃evidence" }]), /半角の #/u);
});

test("全制作表のpart所属を、TSV読込みと素材結合で落とさない", t => {
  const f = fixture(t);
  const mapping = {
    home_items: "apps", message_items: "talks", chat_items: "talks", note_items: "contents", photo_items: "contents",
    calendar_items: "contents", call_items: "contents", radio_items: "contents", mail_items: "contents", browser_items: "contents", project_items: "contents", talk_history: "contents",
    state_vars: "stateVariables", attachments: "attachments", talk_people: "talkPeople", incoming_calls: "incomingCalls",
    gen_audio: "generatedAudio", todo_items: "todos", notifications: "notifications", assistant_messages: "assistantMessages"
  };
  f.edit("project_items", rows => rows.push({ id: "part_fixture_item", app: "notes", record: '{"title":"確認","body":"本文"}' }));
  for (const table of [...Object.keys(mapping), "passwords", "hooks", "talk_flow", "talk_blocks"]) f.edit(table, rows => rows.unshift({ comment: "#evidence" }));
  const { source, workbook } = loadScenarioAuthoring(f.root);
  for (const [table, group] of Object.entries(mapping)) for (const row of activeRows(workbook[table].rows)) {
    assert.equal(source.partOwnership[group][row.id], "evidence", `${table}/${row.id}`);
  }
  assert.ok(Object.values(source.partOwnership.passwords).every(part => part === "evidence"));
  assert.ok(Object.values(source.partOwnership.hooks).every(part => part === "evidence"));
  assert.ok(activeRows(workbook.talk_flow.rows).every(row => row.__part === "evidence"));
  assert.ok([...collectScopedTalkBlocks(workbook.talk_blocks.rows).blockInfo.values()].every(block => block.part === "evidence"));
});

test("新列と候補内quote、正規表現extractを実TSVから共通モデルへ変換する", t => {
  const f = fixture(t);
  f.edit("state_vars", rows => rows.push({ id: "fixture_name", type: "string", initial: "" }));
  f.edit("talk_flow", rows => rows.unshift(
    { talk: "guide", from: "intro", type: "context", text: "入力の場面を説明する独立行" },
    { talk: "guide", from: "intro", type: "match", intent: "語句と抽出", text: '資料\n"鍵"', extract: '/^(?<name>.+)$/u', next: "message_reply", mode: "stay", set: "fixture_name=$extract.name" }
  ));
  const built = f.build();
  assert.equal(built.status, 0, built.stderr);
  const talk = JSON.parse(built.stdout).talks.find(item => item.id === "guide");
  const rule = talk.rules.find(item => item.intent === "語句と抽出");
  assert.equal(rule.type, "match");
  assert.equal(rule.criteria, '資料\n"鍵"');
  assert.equal(rule.match, '/^(?<name>.+)$/u');
  assert.equal(talk.rules.find(item => item.isDefault && item.from === talk.initialFrom).criteria, "入力の場面を説明する独立行");
});

test("loadはsecretの先頭だけに許し、defaultやcontextを空欄で推測しない", t => {
  const f = fixture(t);
  f.edit("talk_blocks", rows => rows.push({ comment: "#evidence" }));
  f.edit("talk_flow", rows => rows.unshift({ talk: "guide", from: "intro", type: "match", text: '"鍵"', next: "/load evidence\nmessage_reply", mode: "stay" }));
  assert.match(f.build().stderr, /\/loadはsecret行だけ/u);
  f.edit("talk_flow", rows => { rows[0].type = "secret"; });
  let built = f.build();
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(JSON.parse(built.stdout).talks.find(talk => talk.id === "guide").rules.find(rule => rule.type === "secret").loadParts, ["evidence"]);
  const report = path.join(f.root, "writer.md");
  const dumped = spawnSync(process.execPath, ["scripts/scenario-talk-flow-writer-review-dump.mjs", `--output=${report}`], {
    encoding: "utf8", env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: f.root }
  });
  assert.equal(dumped.status, 0, dumped.stderr);
  const review = fs.readFileSync(report, "utf8");
  assert.match(review, /part配布の確認（作品全体）/u);
  assert.match(review, /取得入口: talk_flow guide\/intro → \/load evidence/u);
  assert.match(review, /追加取得なしのpassword: sealed_note/u);
  f.edit("talk_flow", rows => { rows[0].next = "message_reply\n/load evidence"; });
  assert.match(f.build().stderr, /先頭へまとめて/u);
  f.edit("talk_flow", rows => { rows[0].type = ""; });
  assert.match(f.build().stderr, /typeは必須/u);
});

test("初期の表示条件と履歴envが後partの変数を黙って初期値扱いしない", t => {
  const f = fixture(t);
  f.edit("state_vars", rows => rows.push({ comment: "#evidence" }, { id: "late_flag", type: "boolean", initial: "false" }, { id: "late_text", type: "string", initial: "まだ読めない" }));
  f.edit("home_items", rows => { rows.find(row => row.id === "notes").cond = "late_flag"; });
  assert.match(f.build().stderr, /初期表示で使う変数はbase/u);
  f.edit("home_items", rows => { rows.find(row => row.id === "notes").cond = ""; });
  f.edit("talk_blocks", rows => { rows.find(row => row.body?.startsWith("メッセージアプリ固有")).body = "{{late_text}}"; });
  assert.match(f.build().stderr, /初期履歴env.*late_text/u);
});

test("列の改名と明示typeの追加だけで、既存regex/defaultの分岐IDを変えない", () => {
  const before = { talkId: "guide", from: "intro", isDefault: false, cond: "", intent: "確認", criteria: "/^確認$/u", match: "", outputSteps: [{ kind: "block", blockId: "reply" }], set: [], mode: "stay" };
  const id = rule => assignRuleIds([rule])[0].id;
  assert.equal(id(before), id({ ...before, type: "match", part: "base", loadParts: [] }));
  const fallback = { ...before, isDefault: true, intent: "", criteria: "同じ現在場面" };
  assert.equal(id(fallback), id({ ...fallback, type: "default", part: "base", contextPart: "base", loadParts: [] }));
  assert.notEqual(id(before), id({ ...before, type: "secret", criteria: '"確認"', loadParts: ["evidence"] }));
});

test("別partの素材URLを制作時の結合で漏らさず、取得後に共通runtimeで解決する", async t => {
  const f = fixture(t);
  const url = "/fixture/hidden-image-73da28.webp";
  f.edit("attachments", rows => rows.push({ comment: "#evidence" }, { id: "future_image", type: "image", asset: url }));
  f.edit("photo_items", rows => rows.push({ id: "cross_part_photo", image: "future_image", title: "後読み画像", initial: "repairable", repair_label: "破損データ", search: "後読み画像" }));
  const result = f.build();
  assert.equal(result.status, 0, result.stderr);
  const worker = JSON.parse(result.stdout);
  const content = worker.contents.find(item => item.id === "cross_part_photo");
  assert.equal(content.record.imageAttachmentId,"future_image");
  assert.equal(content.record.imageUrl,undefined,"private定義もURLでなく素材IDを保持する");
  const before = scenarioForParts(worker, ["base"]);
  assert.equal(before.contents.find(item => item.id === content.id).record.imageAttachmentId,"future_image");
  const runtime = createScenarioRuntime(before);
  const state = runtime.createInitialPlayerState();
  state.repairedContentIds.push(content.id);
  assert.throws(() => runtime.validatePartState(state), /素材のpartが未取得/u);
  const after = scenarioForParts(worker, ["base", "evidence"]);
  assert.equal(createScenarioRuntime(after).searchScenario("後読み画像",state).find(item=>item.contentId===content.publicId).thumbnailUrl,url);
  worker.playerMode = "static";
  const outputDir = path.join(f.root, "dist"); fs.mkdirSync(outputDir);
  staticPartLocators(f.root, worker.project.id, worker.parts, true);
  const manifest = await buildStaticScenario({ root: f.root, outputDir, scenario: { worker, hookScripts: loadScenarioAuthoring(f.root).hookScripts } });
  assert.ok(!fs.readFileSync(path.join(outputDir, manifest.base), "utf8").includes(url));
});

test("ruleのないblockを読み取り専用の終点にでき、未取得defaultと区別する",async t=>{
  const f=fixture(t);
  f.edit("talk_flow",rows=>{
    const rule=rows.find(row=>row.talk==="guide" && row.type==="default");
    assert.ok(rule);
    rule.next="message_reply";rule.mode="";
    rows.unshift({talk:"search_agent",from:"intro",type:"match",text:"/^終点$/u",next:"hint_first"});
  });
  const result=f.build();assert.equal(result.status,0,result.stderr);
  const worker=JSON.parse(result.stdout);
  const block=worker.talkBlocks.find(block=>block.id==="guide::message_reply");
  assert.equal(block.acceptsInput,false);
  const runtime=createScenarioRuntime(scenarioForParts(worker,["base"]));
  const state=(await runtime.reconcileScenarioState(runtime.createInitialPlayerState(),"terminal")).state;
  state.talks.guide.from=block.id;
  assert.doesNotThrow(()=>runtime.validateTalkContinuation("guide",block.id,state));
  assert.equal(runtime.talkCanPost(runtime.talkByInternalId("guide"),state),false);
  state.talks.search_agent.from="search_agent::hint_first";
  assert.doesNotThrow(()=>runtime.validateTalkContinuation("search_agent",state.talks.search_agent.from,state));
  assert.equal(runtime.talkCanPost(runtime.talkByInternalId("search_agent"),state),false);
  const output = path.join(f.root,"endings.md");
  const dumped = spawnSync(process.execPath,["scripts/scenario-talk-flow-writer-review-dump.mjs",`--output=${output}`],{
    encoding:"utf8",env:{...process.env,XSTORYPHONE_SCENARIO_DIR:f.root}
  });
  assert.equal(dumped.status,0,dumped.stderr);
  const report=fs.readFileSync(output,"utf8");
  assert.match(report,/読み取り専用の終点/u);
  assert.match(report,/guide\/message_reply（到達元: talk_flow\.tsv:\d+/u);
  assert.match(report,/search_agent\/hint_first（到達元: talk_flow\.tsv:\d+/u);
});

test("開始時の確実な素材不足は行付きエラーにし、破損枠と条件付き表示は警告に留める", t => {
  const f=fixture(t);
  f.edit("attachments", rows=>rows.push({comment:"#evidence"},{id:"later_image",type:"image",asset:"/later-image.webp"}));
  f.edit("photo_items", rows=>rows.push({id:"later_photo",image:"later_image",initial:"normal",title:"後の画像"}));
  assert.match(f.build().stderr,/photo_items\.tsv:\d+.*開始時.*part evidence/u);
  f.edit("photo_items",rows=>{rows.find(row=>row.id==="later_photo").initial="repairable";});
  const result=f.build();assert.equal(result.status,0,result.stderr);
  const authoring=loadScenarioAuthoring(f.root);
  const warnings=validateScenarioParts(JSON.parse(result.stdout),authoring);
  assert.ok(warnings.some(warning=>/photo_items\.tsv:\d+.*part evidence/u.test(warning)));
});

test("入口の取得後集合でpart_loadedを検査し、正当な別partの変数・予約を拒否しない", t => {
  const f=fixture(t);
  f.edit("state_vars",rows=>rows.push({comment:"#evidence"},{id:"later_flag",type:"boolean",initial:"true"}));
  f.edit("talk_flow",rows=>rows.unshift({talk:"guide",from:"intro",type:"secret",text:'"鍵"',next:"/load evidence\n/load handlers\nmessage_reply",mode:"stay"}));
  f.edit("hooks",rows=>rows.push({comment:"#base"},{id:"cross_part_probe",event:"part_loaded",target:"evidence",cond:"later_flag",script:'if(state.get("later_flag")) schedule.after("cross_part_event", 100);'},
    {comment:"#handlers"},{id:"cross_part_receiver",event:"scheduled_event",target:"cross_part_event",script:'state.set("later_flag", false);'}));
  const result=f.build();assert.equal(result.status,0,result.stderr);
  const authoring=loadScenarioAuthoring(f.root);
  const warnings=validateScenarioParts(JSON.parse(result.stdout),authoring);
  assert.ok(!warnings.some(warning=>warning.startsWith(`hooks.tsv:${authoring.workbook.hooks.rows.find(row=>row.id==="cross_part_probe").__rowNumber} `)));
  // 同じpartへの別入口では不足の可能性を警告するが、前段での取得を否定しない。
  f.edit("talk_flow",rows=>rows.unshift({talk:"guide",from:"intro",type:"secret",text:'"別の鍵"',next:"/load evidence\nmessage_reply",mode:"stay"}));
  const second=f.build();assert.equal(second.status,0,second.stderr);
  assert.ok(validateScenarioParts(JSON.parse(second.stdout),loadScenarioAuthoring(f.root)).some(warning=>warning.includes("cross_part_event")));
});

test("初期表示で評価するcondの不足はTSVの位置を示して停止する", async t => {
  const cases = [
    ["note_items", "welcome_note"], ["message_items", "guide"], ["chat_items", "lobby"],
    ["assistant_messages", "home_hint"], ["hooks", "mark_session_started"],
    ["project_constants", "chat_auth.cond"]
  ];
  for (const [table, id] of cases) await t.test(table, () => {
    const f = fixture(t);
    f.edit("state_vars", rows => rows.push({comment:"#vault"}, {id:"late_flag",type:"boolean",initial:"false"}));
    f.edit(table, rows => {
      const row = rows.find(row => table === "project_constants" ? row.key === id : row.id === id);
      assert.ok(row);
      row[table === "project_constants" ? "value" : "cond"] = "late_flag";
      if (table === "note_items") row.initial = "hidden"; // 非表示でも条件自体は評価する。
    });
    const result = f.build();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${table}\\.tsv:\\d+.*開始時.*late_flag`, "u"));
  });
});

test("PINで取得する定義は初期condに使え、後partの通常condを一律禁止しない", t => {
  const f = fixture(t);
  f.edit("state_vars", rows => rows.push({comment:"#startup"}, {id:"startup_flag",type:"boolean",initial:"false"}));
  f.edit("project_constants", rows => {
    rows.find(row => row.key === "device.lock_method").value = "fixed-pin";
    rows.push({key:"device.lock_pin",value:"0042",exposure:"private"}, {key:"device.unlock_load_part",value:"startup",exposure:"private"});
  });
  f.edit("note_items", rows => { rows.find(row => row.id === "welcome_note").cond = "startup_flag"; });
  f.edit("state_vars", rows => rows.push({comment:"#vault"}, {id:"vault_flag",type:"boolean",initial:"true"}));
  f.edit("note_items", rows => rows.push({comment:"#vault"}, {id:"vault_note",initial:"normal",cond:"vault_flag",title:"後partのメモ",body:"後partの本文"}));
  const result = f.build();
  assert.equal(result.status, 0, result.stderr);
});

test("ruleのset・出力・添付・次の入力を取得後集合で警告し、明示loadで解消する", t => {
  const f = fixture(t);
  f.edit("state_vars", rows => rows.push({comment:"#vault"}, {id:"late_flag",type:"boolean",initial:"false"}));
  f.edit("attachments", rows => rows.push({comment:"#vault"}, {id:"late_image",type:"image",asset:"/fixture/late.webp"}));
  f.edit("talk_blocks", rows => rows.push({comment:"*guide"}, {comment:"part_reply"}, {sender:"guide",body:"{{late_flag}}",attachment:"late_image"}));
  f.edit("talk_flow", rows => rows.push(
    {comment:"#base"}, {talk:"guide",from:"intro",type:"match",text:"確認",set:"late_flag = true",next:"part_reply",intent:"part検査fixture"},
    {comment:"#vault"}, {talk:"guide",from:"part_reply",type:"default",next:"part_reply",mode:"stay"}
  ));
  const warnings = () => {
    const result = f.build(); assert.equal(result.status, 0, result.stderr);
    return validateScenarioParts(JSON.parse(result.stdout), loadScenarioAuthoring(f.root));
  };
  const before = warnings();
  for (const pattern of [/\.set.*late_flag/u, /\.template.*late_flag/u, /late_image/u, /遷移先.*default/u]) assert.ok(before.some(line => pattern.test(line)), before.join("\n"));
  f.edit("talk_flow", rows => {
    const rule = rows.find(row => row.intent === "part検査fixture");
    rule.type = "secret"; rule.text = '"確認"'; rule.next = "/load vault\npart_reply";
  });
  const result = f.build(); assert.equal(result.status, 0, result.stderr);
  const rule = JSON.parse(result.stdout).talks.find(talk => talk.id === "guide").rules.find(rule => rule.intent === "part検査fixture");
  assert.ok(!warnings().some(line => line.includes(rule.id)), "他の入口の警告は残し、取得する入口だけを解消する");
});

test("抽出値・鍵付き枠・検索結果の予約変数をpart不足と誤認しない", t => {
  const f = fixture(t);
  f.edit("state_vars", rows => rows.push({comment:"#vault"}, {id:"captured",type:"string",initial:""}));
  f.edit("attachments", rows => rows.push({comment:"#vault"}, {id:"later_doc",type:"document",content:"later_document",lock:"password",title:"資料",body:"非公開の本文"}));
  f.edit("passwords", rows => rows.push({content:"later_document",password:'"鍵"',load_part:"vault"}));
  f.edit("talk_blocks", rows => rows.push({comment:"*guide"}, {comment:"capture_reply"}, {sender:"guide",body:"{{captured}}",attachment:"later_doc"}));
  f.edit("talk_flow", rows => rows.unshift({talk:"guide",from:"intro",type:"match",text:"資料",extract:"/(?<captured>.+)/u",next:"capture_reply",mode:"stay"}));
  const result = f.build(); assert.equal(result.status, 0, result.stderr);
  const warnings = validateScenarioParts(JSON.parse(result.stdout),loadScenarioAuthoring(f.root));
  assert.deepEqual(warnings, []);
});
