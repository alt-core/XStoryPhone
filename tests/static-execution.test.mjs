import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { buildStaticScenario, staticPartLocators } from "../scripts/lib/static-scenario.mjs";
import { createStaticPlayerExecution } from "../src/static/playerExecution.ts";
import { openPlayerRecordDatabase, readPlayerRecords } from "../src/client/system/playerRecordDatabase.ts";
import { auditStaticDistribution } from "../scripts/lib/static-audit.mjs";

function scenarioFixture() {
  const scenario = loadAndValidateScenario();
  const worker = scenario.worker;
  worker.playerMode = "static";
  worker.parts = ["base", "evidence"];
  worker.stateVariables.part_seen = false;
  worker.stateVariableDefinitions.part_seen = { type: "boolean" };
  worker.stateVariableParts.part_seen = "evidence";
  worker.publicStateVariables.push("part_seen");
  const talk = worker.talks.find(item => item.kind === "search_agent");
  const block = (key, body) => ({
    id: `search_agent::${key}`, talkId: "search_agent", blockKey: key, part: "evidence", order: 1000,
    messages: [{ id: key, sender: "search_agent", body, attachmentId: "", sentAt: "", notes: "作者専用メモ", updatedAt: "", source: "" }]
  });
  worker.talkBlocks.push(block("secret_reply", "未到達の本文マーカー7391"), block("part_notice", "取得完了の案内マーカー8426"));
  talk.rules.unshift({
    id: "private-secret-rule", order: 0, type: "secret", part: "base", from: talk.initialFrom, isDefault: false, cond: "", intent: "秘密の解答", criteria: '"虹の鍵"\n"ＲＡＩＮＢＯＷ"', match: "",
    outputSteps: [{ kind: "block", blockId: "search_agent::secret_reply" }], nextBlocks: ["search_agent::secret_reply"], nextFromId: "search_agent::secret_reply",
    loadParts: ["evidence"], set: [], mode: "stay", notes: "制作メモを配布しない", example: "虹の鍵"
  });
  worker.contents.push({ id: "secret_note", publicId: "c_secret_note", appId: "notes", initialState: "repairable", repairLabel: "破損データ", part: "evidence", order: 1000, cond: "", search: ["秘密の記録"], record: { title: "秘密の記録", body: "未到達のメモマーカー9467" } });
  worker.publicIds.content.secret_note = "c_secret_note";
  worker.hooks.push({ event: "part_loaded", target: "evidence", cond: "!part_seen", handler: "static_part_notice", part: "evidence", order: 1000, llm: false });
  worker.hookTalkBlocks.search_agent.push("secret_reply", "part_notice");
  scenario.hookScripts.static_part_notice = 'state.set("part_seen", true); talk.addBlock("search_agent", "part_notice", {mode: "stay"});';
  return scenario;
}

async function filesFixture(t, mutate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-static-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "public");
  fs.mkdirSync(outputDir);
  const scenario = scenarioFixture();
  mutate(scenario);
  staticPartLocators(root, scenario.worker.project.id, scenario.worker.parts, true);
  const manifest = await buildStaticScenario({ root, outputDir, scenario });
  const requests = [];
  const rootUrl = "https://static.example/games/example/";
  const options = {
    projectId: scenario.worker.project.id, clientRevision: scenario.worker.clientRevision,
    entryUrl: rootUrl + "static-entry.json", storage: { mode: "memory", prefix: "static-test" }, resetForTesting: true,
    wait: async () => {},
    fetch: async url => {
      requests.push(url);
      assert.ok(url.startsWith(rootUrl), "APIや別originへ接続しない");
      const file = path.join(outputDir, url.slice(rootUrl.length));
      return fs.existsSync(file) ? new Response(fs.readFileSync(file), { headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
    },
    module: async url => import(pathToFileURL(path.join(outputDir, url.slice(rootUrl.length).split("?")[0])).href)
  };
  return { root, outputDir, scenario, manifest, requests, options };
}

async function request(execution, route, body = {}) {
  const response = await execution.request(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

async function send(execution, state, message) {
  const talk = state.talks.find(item => item.kind === "search_agent");
  return request(execution, "/api/talk/send", { talkId: talk.talkId, turnKey: talk.turnKey, message });
}

test("APIなしのmemory実行は誤答で取得せず、secret取得・hook・修復・再読込を共通処理で進める", async t => {
  const f = await filesFixture(t);
  const base = fs.readFileSync(path.join(f.outputDir, f.manifest.base), "utf8");
  assert.ok(!base.includes(f.scenario.worker.revision));
  assert.ok(!base.includes(f.scenario.worker.transcriptRevision));
  assert.ok(!base.includes("private-secret-rule"));
  for (const secret of ["虹の鍵", "未到達の本文マーカー7391", "未到達のメモマーカー9467", "制作メモを配布しない"]) assert.ok(!base.includes(secret));
  const execution = createStaticPlayerExecution(f.options);
  await execution.initialize();
  let state = (await request(execution, "/api/session/start")).playerState;
  assert.equal(state.projectState.part_seen, undefined);
  assert.ok(!JSON.stringify(state).includes("未到達のメモマーカー9467"));
  const count = f.requests.length;
  state = (await send(execution, state, "これは誤答です")).playerState;
  assert.equal(f.requests.length, count, "誤答では403/404を発生させない");
  state = (await send(execution, state, "rainbow")).playerState;
  assert.equal(state.projectState.part_seen, true);
  const text = state.searchAgentMessages.filter(item => item.kind === "message").map(item => item.body);
  assert.ok(text.indexOf("未到達の本文マーカー7391") < text.indexOf("取得完了の案内マーカー8426"));
  assert.equal(text.filter(body => body === "取得完了の案内マーカー8426").length, 1);
  state = (await send(execution, state, "秘密の記録")).playerState;
  const result = state.searchAgentMessages.filter(item => item.kind === "search_results").at(-1).results.find(item => item.contentId === "c_secret_note");
  assert.ok(result);
  const opened = await request(execution, "/api/content/opened", { appId: "notes", contentId: result.contentId, source: "search" });
  assert.ok(JSON.stringify(opened.playerState).includes("未到達のメモマーカー9467"));
  const reloaded = await request(execution, "/api/player-state");
  assert.equal(reloaded.playerState.searchAgentMessages.filter(item => item.body === "取得完了の案内マーカー8426").length, 1);
  assert.ok(f.requests.every(url => !url.includes("/api/")));
});

test("staticのpersistent保存はcompact eventを保持し、再開・別tab競合・resetを守る", async t => {
  const f = await filesFixture(t);
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  t.after(() => { globalThis.indexedDB = previous; });
  const options = { ...f.options, storage: { mode: "persistent", prefix: "static-compact" } };
  const first = createStaticPlayerExecution(options);
  await first.initialize();
  let state = (await request(first, "/api/session/start")).playerState;
  state = (await send(first, state, "虹の鍵")).playerState;
  const database = await openPlayerRecordDatabase(`static-compact:xstoryphone-static-player-${f.scenario.worker.project.id}`, 1, "records");
  const savedRecords = await readPlayerRecords(database, "records");
  database.close();
  assert.ok(!JSON.stringify(savedRecords).includes("未到達の本文マーカー7391"), "NPC本文を展開済みで保存しない");
  assert.ok(savedRecords.some(record => record.messages?.some(event => event.event_type === "message_block" && event.display_block_id)));
  const second = createStaticPlayerExecution(options);
  await second.initialize();
  const resumed = await request(second, "/api/player-state");
  assert.equal(resumed.playerState.projectState.part_seen, true);
  assert.deepEqual(resumed.playerState.searchAgentMessages, state.searchAgentMessages);
  await send(second, resumed.playerState, "こんにちは");
  await assert.rejects(() => send(first, state, "古いタブ"), error => error.kind === "conflict");
  const reset = await request(second, "/api/reset-for-testing");
  assert.deepEqual(reset, {ok:true});
  assert.equal(second.marker(), undefined);
  const restarted = (await request(second, "/api/session/start")).playerState;
  assert.equal(restarted.projectState.part_seen, undefined);
  assert.ok(!restarted.searchAgentMessages.some(item => item.body === "未到達の本文マーカー7391"));
});

test("passwordの複数候補はsecretと同じ照合で、必要partの取得後にだけ本文を解錠する", async t => {
  const f = await filesFixture(t, ({ worker }) => {
    const attachment = worker.attachments.find(item => item.content === "sealed_note");
    attachment.part = "evidence"; attachment.type = "document"; attachment.body = "passwordの未取得本文7733"; delete attachment.asset;
    worker.contents.find(item => item.id === "sealed_note").part = "evidence";
    worker.contents.find(item => item.id === "sealed_note").cond = "";
    const password = worker.lockedContentPasswords.find(item => item.contentId === "sealed_note");
    password.answers = ["unlock", "鍵"]; password.loadParts = ["evidence"];
    worker.talkBlocks.find(item => item.id === "guide::intro").messages[0].attachmentId = attachment.id;
  });
  assert.ok(!fs.readFileSync(path.join(f.outputDir, f.manifest.base), "utf8").includes("passwordの未取得本文7733"));
  const execution = createStaticPlayerExecution(f.options);
  await execution.initialize();
  await request(execution, "/api/session/start");
  const contentId = f.scenario.worker.publicIds.content.sealed_note;
  const count = f.requests.length;
  const wrong = await execution.request("/api/content/unlock", { method: "POST", body: JSON.stringify({ contentId, password: "違う" }) });
  assert.equal(wrong.status, 400);
  assert.equal(f.requests.length, count);
  const unlocked = await request(execution, "/api/content/unlock", { contentId, password: " ＵＮＬＯＣＫ " });
  assert.equal(unlocked.playerState.unlockedAttachments.find(item => item.contentId === contentId).body, "passwordの未取得本文7733");
  assert.equal(unlocked.playerState.projectState.part_seen, true);
});

test("load_part空欄のpasswordも回答JSONで照合し、先行配布の演出用途を禁止しない", async t => {
  const f = await filesFixture(t, ({ worker }) => {
    const attachment = worker.attachments.find(item => item.content === "sealed_note");
    attachment.type = "document"; attachment.body = "baseの演出用本文"; delete attachment.asset;
    worker.contents.find(item => item.id === "sealed_note").cond = "";
    worker.talkBlocks.find(item => item.id === "guide::intro").messages[0].attachmentId = attachment.id;
  });
  assert.ok(fs.readFileSync(path.join(f.outputDir, f.manifest.base), "utf8").includes("baseの演出用本文"));
  const execution = createStaticPlayerExecution(f.options);
  await execution.initialize();
  await request(execution, "/api/session/start");
  const count = f.requests.length;
  const unlocked = await request(execution, "/api/content/unlock", { contentId: f.scenario.worker.publicIds.content.sealed_note, password: "0420" });
  assert.equal(unlocked.playerState.unlockedAttachments[0].body, "baseの演出用本文");
  assert.equal(f.requests.length, count + 1);
  assert.ok(f.requests.at(-1).includes("/answers/"));
  assert.equal(unlocked.playerState.projectState.part_seen, undefined);
});

test("非baseのpassword入口は次のpartの鍵付き添付の枠を持ち、正答後だけ本文を得る", async t => {
  const f = await filesFixture(t, scenario => {
    const {worker}=scenario;
    worker.parts.push("vault");
    const attachment=worker.attachments.find(item=>item.content==="sealed_note");
    attachment.part="vault"; attachment.type="document"; attachment.body="後段password本文"; delete attachment.asset;
    const content=worker.contents.find(item=>item.id==="sealed_note");content.part="vault";content.cond="";
    const password=worker.lockedContentPasswords.find(item=>item.contentId==="sealed_note");password.part="evidence";password.loadParts=["vault"];
    const block=worker.talkBlocks.find(item=>item.id==="guide::message_reply");block.part="evidence";block.messages[0].attachmentId=attachment.id;
    scenario.hookScripts.static_part_notice += ' talk.addBlock("guide", "message_reply", {mode:"stay"});';
    // IDの接頭辞が一致しても、本文や素材URLの漏洩とはみなさない。
    for (const id of ["evidence_asset", "evidence_asset2"]) {
      worker.attachments.push({id,type:"image",part:"vault",asset:`/fixture/${id}-secret.webp`});
      worker.publicIds.attachment[id]=`a_${id}`;
    }
    worker.contents.push(
      {id:"earlier_photo",publicId:"c_earlier_photo",appId:"photos",part:"base",initialState:"repairable",cond:"",search:[],repairLabel:"破損データ",record:{title:"先行する枠",imageAttachmentId:"evidence_asset2"}},
      {id:"later_photo",publicId:"c_later_photo",appId:"photos",part:"vault",initialState:"normal",cond:"",search:[],record:{title:"後から読む画像の検証用名称",imageAttachmentId:"evidence_asset"}}
    );
    worker.publicIds.content.earlier_photo="c_earlier_photo";
    worker.publicIds.content.later_photo="c_later_photo";
  });
  fs.mkdirSync(path.join(f.outputDir,"assets"));
  fs.writeFileSync(path.join(f.outputDir,"index.html"), '<script src="/assets/probe.js"></script>');
  const engineFile=path.join(f.outputDir,"assets/probe.js");
  fs.writeFileSync(engineFile,'console.log("engine");');
  assert.deepEqual(auditStaticDistribution(f.outputDir,f.scenario.worker,f.scenario.hookScripts),[]);
  for (const secret of ["後段password本文", "/fixture/evidence_asset-secret.webp"]) {
    fs.writeFileSync(engineFile,`console.log(${JSON.stringify(secret)});`);
    assert.ok(auditStaticDistribution(f.outputDir,f.scenario.worker,f.scenario.hookScripts).some(error=>error.includes(secret)),secret);
  }
  fs.writeFileSync(engineFile,'console.log("engine");');
  const execution=createStaticPlayerExecution(f.options);await execution.initialize();
  let state=(await request(execution,"/api/session/start")).playerState;
  assert.ok(!JSON.stringify(state).includes("後段password本文"));
  state=(await send(execution,state,"虹の鍵")).playerState;
  assert.ok(state.smsMessages.some(message=>message.attachment?.kind==="locked"));
  assert.ok(!JSON.stringify(state).includes("後段password本文"));
  const unlocked=await request(execution,"/api/content/unlock",{contentId:f.scenario.worker.publicIds.content.sealed_note,password:"0420"});
  assert.equal(unlocked.playerState.unlockedAttachments[0].body,"後段password本文");
});

test("通常会話でもoptional抽出値はtemplateの空値として扱う", async t => {
  const f=await filesFixture(t,({worker})=>{
    const talk=worker.talks.find(item=>item.id==="guide");
    const block=worker.talkBlocks.find(item=>item.id==="guide::message_reply");block.messages[0].body="任意:{{suffix}}";
    const rule={...talk.rules.find(item=>item.isDefault&&item.from===talk.initialFrom),id:"optional-extraction",type:"match",criteria:"/^x$/u",isDefault:false,match:"/^(?<main>x)(?<suffix>y)?$/u",nextBlocks:[block.id],outputSteps:[{kind:"block",blockId:block.id}],mode:"stay",set:[]};
    talk.rules.unshift(rule);
  });
  const execution=createStaticPlayerExecution(f.options);await execution.initialize();
  const state=(await request(execution,"/api/session/start")).playerState;
  const talk=state.talks.find(item=>item.talkId===f.scenario.worker.publicIds.talk.guide);
  const sent=await request(execution,"/api/talk/send",{talkId:talk.talkId,turnKey:talk.turnKey,message:"x"});
  assert.ok(sent.playerState.smsMessages.some(message=>message.body==="任意:"));
});

test("body読取りとmoduleの一時障害も操作全体の2回予算を共用する", async t => {
  const f=await filesFixture(t);const waits=[],moduleUrls=[];let brokenBody=true,brokenModule=true;
  const execution=createStaticPlayerExecution({...f.options,wait:async ms=>{waits.push(ms);},fetch:async(url,init)=>{
    if(brokenBody&&url.includes("/parts/")){brokenBody=false;return {ok:true,status:200,json:async()=>{throw new TypeError("bodyの通信断");}};}
    return f.options.fetch(url,init);
  },module:async url=>{
    if(url.includes("/parts/")) moduleUrls.push(url);
    if(brokenModule&&url.includes("/parts/")){brokenModule=false;throw new TypeError("moduleの通信断");}
    return f.options.module(url);
  }});
  await execution.initialize();const before=(await request(execution,"/api/session/start")).playerState;
  assert.equal((await send(execution,before,"虹の鍵")).playerState.projectState.part_seen,true);
  assert.deepEqual(waits,[1000,3000]);
  assert.equal(moduleUrls.length,2);
  assert.equal(new URL(moduleUrls[0]).search,"");
  assert.equal(new URL(moduleUrls[1]).search,"?retry=1","失敗importを記憶するブラウザーでも再取得できるURLにする");
});

test("固定PINは先頭0を維持し、開始前の確認と開始処理で同じ取得先を使う", async t => {
  const f = await filesFixture(t, ({ worker }) => { worker.project.lockScreen = { method: "fixed-pin", pin: "0042", loadParts: ["evidence"] }; });
  const execution = createStaticPlayerExecution(f.options);
  await execution.initialize();
  const count = f.requests.length;
  assert.equal((await execution.request("/api/device-pin/verify", { method: "POST", body: JSON.stringify({ pin: "42" }) })).status, 400);
  assert.equal(f.requests.length, count);
  const verified = await request(execution, "/api/device-pin/verify", { pin: "0042" });
  assert.equal(verified.playerState, undefined);
  const started = await request(execution, "/api/session/start", { pin: "0042" });
  assert.equal(started.playerState.projectState.part_seen, true);
  const resumed = await request(execution, "/api/player-state");
  assert.equal(resumed.playerState.searchAgentMessages.filter(item => item.body === "取得完了の案内マーカー8426").length, 1);
});

test("固定PINで読むpartに初期台本を置いても、テスト用resetから再開できる", async t => {
  const f = await filesFixture(t, ({ worker }) => {
    worker.parts.push("startup");
    worker.project.lockScreen = { method: "fixed-pin", pin: "0042", loadParts: ["startup"] };
    worker.talkBlocks.find(block => block.id === "search_agent::intro").part = "startup";
  });
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  t.after(() => { globalThis.indexedDB = previous; });
  const options = { ...f.options, storage: { mode: "persistent", prefix: "static-pin-reset" } };
  const execution = createStaticPlayerExecution(options);
  await execution.initialize();
  const started = await request(execution, "/api/session/start", { pin: "0042" });
  assert.equal((await send(execution, started.playerState, "虹の鍵")).playerState.projectState.part_seen, true);
  const resumed = createStaticPlayerExecution(options);
  await resumed.initialize();
  await request(resumed, "/api/reset-for-testing");
  await request(resumed, "/api/device-pin/verify", { pin: "0042" });
  assert.equal(resumed.marker(), undefined, "PIN検証だけでは初期化しない");
  const state = (await request(resumed, "/api/session/start", { pin: "0042" })).playerState;
  assert.equal(state.projectState.part_seen, undefined, "開始用part以外の進行はリセットする");
  assert.ok(state.searchAgentMessages.some(message => message.body?.includes("検索とデモ全体の案内")));
});

test("part_loadedの拒否・終端指定では取得済集合と返信を部分保存しない", async t => {
  for (const script of ['form.deny("今回は開けません");', 'effectSequence.gameOver("ここでは禁止");']) {
    const f = await filesFixture(t, scenario => { scenario.hookScripts.static_part_notice = script; });
    const execution = createStaticPlayerExecution(f.options);
    await execution.initialize();
    const before = (await request(execution, "/api/session/start")).playerState;
    const talk = before.talks.find(item => item.kind === "search_agent");
    const response = await execution.request("/api/talk/send", { method: "POST", body: JSON.stringify({ talkId: talk.talkId, turnKey: talk.turnKey, message: "虹の鍵" }) });
    assert.equal(response.status, script.startsWith("form") ? 422 : 500);
    const after = (await request(execution, "/api/player-state")).playerState;
    assert.equal(after.projectState.part_seen, undefined);
    assert.deepEqual(after.searchAgentMessages, before.searchAgentMessages);
    assert.equal(after.talks.find(item => item.kind === "search_agent").turnKey, talk.turnKey);
  }
});

test("staticは操作前に確定した予約を残し、拒否されたpart候補だけを捨てる",async t=>{
  const f=await filesFixture(t,scenario=>{
    const w=scenario.worker;
    w.stateVariables.scheduled_probe=0;w.stateVariableDefinitions.scheduled_probe={type:"integer"};w.stateVariableParts.scheduled_probe="base";
    w.publicStateVariables.push("scheduled_probe");
    w.initialSchedules=[{id:"probe",eventId:"probe",delayMs:0,fields:{}}];
    w.hooks.push({event:"scheduled_event",target:"probe",handler:"scheduled_probe",cond:"",part:"base",order:999,llm:false});
    w.publicIds.scenarioEvent.probe="e_probe";
    scenario.hookScripts.scheduled_probe='state.apply(["scheduled_probe += 1"]);';
    scenario.hookScripts.static_part_notice='form.deny("読み込まない");';
  });
  const execution=createStaticPlayerExecution(f.options);await execution.initialize();
  const before=(await request(execution,"/api/session/start")).playerState;
  const talk=before.talks.find(item=>item.kind==="search_agent");
  const failed=await execution.request("/api/talk/send",{method:"POST",body:JSON.stringify({talkId:talk.talkId,turnKey:talk.turnKey,message:"虹の鍵"})});
  assert.equal(failed.status,422);
  const result=await failed.json();
  assert.equal(result.playerState.projectState.scheduled_probe,1);
  assert.equal(result.playerState.projectState.part_seen,undefined);
  const after=(await request(execution,"/api/player-state")).playerState;
  assert.equal(after.projectState.scheduled_probe,1,"予約の確定を後段の拒否で取消さない");
  assert.equal(after.talks.find(item=>item.kind==="search_agent").turnKey,talk.turnKey);
});

test("static取得の一時障害は操作全体で2回まで再試行し、404は誤答へ倒さない", async t => {
  const f = await filesFixture(t);
  let failures = 2;
  const waits = [];
  const execution = createStaticPlayerExecution({ ...f.options, wait: async ms => { waits.push(ms); }, fetch: async (url, init) => {
    if (url.includes("/parts/") && failures-- > 0) return new Response("", { status: 503 });
    return f.options.fetch(url, init);
  } });
  await execution.initialize();
  const before = (await request(execution, "/api/session/start")).playerState;
  const after = (await send(execution, before, "虹の鍵")).playerState;
  assert.equal(after.projectState.part_seen, true);
  assert.deepEqual(waits, [1_000, 3_000]);
  const failed = createStaticPlayerExecution({ ...f.options, fetch: async (url, init) => url.includes("/answers/") ? new Response("", { status: 404 }) : f.options.fetch(url, init) });
  await failed.initialize();
  const initial = (await request(failed, "/api/session/start")).playerState;
  const talk = initial.talks.find(item => item.kind === "search_agent");
  const response = await failed.request("/api/talk/send", { method: "POST", body: JSON.stringify({ talkId: talk.talkId, turnKey: talk.turnKey, message: "虹の鍵" }) });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).retryable, false);
  assert.deepEqual((await request(failed, "/api/player-state")).playerState.searchAgentMessages, initial.searchAgentMessages);
});

test("後読みする破損履歴も初期seqと開始時のtemplate envを維持する", async t => {
  let history;
  const f = await filesFixture(t, ({ worker }) => {
    const initialBlock = worker.talks.find(talk => talk.id === "guide").startBlocks[0];
    history = worker.contents.find(content => content.record.talk === "guide" && content.record.block === initialBlock);
    assert.ok(history);
    history.part = "evidence"; history.search = ["過去の会話"];
    const block = worker.talkBlocks.find(item => item.id === history.record.block);
    block.part = "evidence"; block.messages[0].body = "{{fixture_name}}の記録";
    worker.stateVariables.fixture_name = "開始時";
    worker.stateVariableDefinitions.fixture_name = { type: "string" };
    worker.stateVariableParts.fixture_name = "base";
    worker.talks.find(item => item.kind === "search_agent").rules.find(rule => rule.type === "secret").set = ['fixture_name="変更後"'];
  });
  const execution = createStaticPlayerExecution(f.options);
  await execution.initialize();
  let state = (await request(execution, "/api/session/start")).playerState;
  const before = state.visibleDeviceState.messages.find(talk => talk.id === f.scenario.worker.publicIds.talk.guide);
  assert.ok(before.brokenHistoryRanges.length);
  state = (await send(execution, state, "虹の鍵")).playerState;
  assert.ok(!state.visibleDeviceState.messages.find(talk => talk.id === before.id).messages.some(message => message.body === "開始時の記録"));
  state = (await send(execution, state, "過去の会話")).playerState;
  const result = state.searchAgentMessages.filter(item => item.kind === "search_results").at(-1).results[0];
  state = (await request(execution, "/api/content/opened", { contentId: result.contentId, appId: result.appId, source: "search" })).playerState;
  const restored = state.visibleDeviceState.messages.find(talk => talk.id === before.id).messages.find(message => message.seq === 1);
  assert.equal(restored.body, "開始時の記録");
  assert.ok(!JSON.stringify(state.visibleDeviceState.messages).includes("変更後の記録"));
});

test("通常更新は安定locatorで新しい本文を復元し、旧tabの後着保存を拒否する", async t => {
  const f = await filesFixture(t);
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  t.after(() => { globalThis.indexedDB = previous; });
  const options = { ...f.options, storage: { mode: "persistent", prefix: "static-update" } };
  const oldPage = createStaticPlayerExecution(options);
  await oldPage.initialize();
  let oldState = (await request(oldPage, "/api/session/start")).playerState;
  oldState = (await send(oldPage, oldState, "虹の鍵")).playerState;
  const locatorsBefore = fs.readFileSync(path.join(f.root, ".secrets/static-parts.json"), "utf8");
  f.scenario.worker.revision = "通常更新の版";
  f.scenario.worker.talkBlocks.find(block => block.id === "search_agent::secret_reply").messages[0].body = "更新後の本文";
  await buildStaticScenario({ root: f.root, outputDir: f.outputDir, scenario: f.scenario });
  assert.equal(fs.readFileSync(path.join(f.root, ".secrets/static-parts.json"), "utf8"), locatorsBefore);
  const newPage = createStaticPlayerExecution(options);
  await newPage.initialize();
  const resumed = (await request(newPage, "/api/player-state")).playerState;
  assert.equal(resumed.projectState.part_seen, true);
  assert.ok(resumed.searchAgentMessages.some(message => message.body === "更新後の本文"));
  assert.equal(resumed.searchAgentMessages.filter(message => message.body === "取得完了の案内マーカー8426").length, 1);
  await assert.rejects(() => send(oldPage, oldState, "旧版からの送信"), error => error.kind === "conflict");
});

test("clear後の遅着応答は進行を復活させず、memoryは保存APIを参照しない", async t => {
  const f = await filesFixture(t);
  const descriptors = new Map(["indexedDB", "localStorage", "sessionStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of descriptors.keys()) Object.defineProperty(globalThis, key, { configurable: true, get() { assert.fail(`${key}へアクセスしない`); } });
  t.after(() => { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  let release, started;
  const paused = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const execution = createStaticPlayerExecution({ ...f.options, fetch: async (url, init) => {
    if (url.includes("/answers/")) { started(); await gate; }
    return f.options.fetch(url, init);
  } });
  await execution.initialize();
  const state = (await request(execution, "/api/session/start")).playerState;
  const pending = send(execution, state, "虹の鍵");
  await paused;
  await execution.clear();
  release();
  await assert.rejects(pending, error => error.kind === "conflict");
  assert.equal(execution.marker(), undefined);
  const separate = createStaticPlayerExecution(f.options);
  await separate.initialize();
  assert.equal(separate.marker(), undefined);
});

test("配布監査は実際の先行取得範囲と秘密locatorを確認する", async t => {
  const f = await filesFixture(t);
  fs.mkdirSync(path.join(f.outputDir, "assets"));
  fs.writeFileSync(path.join(f.outputDir, "index.html"), '<script type="module" src="/assets/main.js"></script>');
  fs.writeFileSync(path.join(f.outputDir, "assets/main.js"), 'console.log("engine");');
  assert.deepEqual(auditStaticDistribution(f.outputDir, f.scenario.worker, f.scenario.hookScripts), []);
  const hookFile = path.join(f.outputDir, path.dirname(f.manifest.base), "hooks.js");
  const originalHook = fs.readFileSync(hookFile, "utf8");
  fs.writeFileSync(hookFile, originalHook + '\nexport const secret = "後partから混入した実行コード";\n');
  assert.ok(auditStaticDistribution(f.outputDir, f.scenario.worker, f.scenario.hookScripts).some(error => error.includes("hook module")));
  fs.writeFileSync(hookFile, originalHook);
  const mapping = JSON.parse(fs.readFileSync(path.join(f.root, ".secrets/static-parts.json"), "utf8"));
  fs.writeFileSync(path.join(f.outputDir, "assets/main.js"), `console.log(${JSON.stringify(mapping[f.scenario.worker.project.id].evidence)});`);
  assert.ok(auditStaticDistribution(f.outputDir, f.scenario.worker).some(error => error.includes("秘密の取得先")));
  fs.writeFileSync(path.join(f.outputDir, "assets/main.js"), 'console.log("未到達の本文マーカー7391");');
  assert.ok(auditStaticDistribution(f.outputDir, f.scenario.worker).some(error => error.includes("先行取得範囲へ混入")));
});

test("複数partの一部取得失敗後も両方を初回通知し、hook行順を取得順へ変えない", async t => {
  const f = await filesFixture(t, scenario => {
    const worker = scenario.worker;
    worker.parts.push("second");
    worker.stateVariables.trace = ""; worker.stateVariableDefinitions.trace = { type: "string" }; worker.stateVariableParts.trace = "base"; worker.publicStateVariables.push("trace");
    worker.talks.find(talk => talk.id === "search_agent").rules.find(rule => rule.type === "secret").loadParts = ["second", "evidence"];
    for (const [part, letter, order] of [["evidence", "A", 2001], ["second", "B", 2002]]) {
      for (const event of ["part_loaded", "talk_turn_completed"]) {
        const handler = `${part}_${event}`;
        worker.hooks.push({ event, target: event === "part_loaded" ? part : "search_agent", cond: "", handler, part, order: order + (event === "part_loaded" ? 10 : 0), llm: false });
        scenario.hookScripts[handler] = `state.set("trace", state.get("trace") + ${JSON.stringify(event === "part_loaded" ? letter.toLowerCase() : letter)});`;
      }
    }
  });
  const locators = JSON.parse(fs.readFileSync(path.join(f.root, ".secrets/static-parts.json"), "utf8"))[f.scenario.worker.project.id];
  let fail = true, secondFetches = 0;
  const execution = createStaticPlayerExecution({ ...f.options, fetch: async (url, init) => {
    if (url.includes(locators.second)) secondFetches += 1;
    if (fail && url.includes(locators.evidence)) return new Response("", { status: 404 });
    return f.options.fetch(url, init);
  } });
  await execution.initialize();
  const state = (await request(execution, "/api/session/start")).playerState;
  const talk = state.talks.find(item => item.kind === "search_agent");
  const rejected = await execution.request("/api/talk/send", { method: "POST", body: JSON.stringify({ talkId: talk.talkId, turnKey: talk.turnKey, message: "虹の鍵" }) });
  assert.equal(rejected.status, 502);
  assert.equal((await request(execution, "/api/player-state")).playerState.projectState.trace, "");
  fail = false;
  const accepted = await send(execution, state, "虹の鍵");
  assert.equal(accepted.playerState.projectState.trace, "baAB");
  assert.equal(secondFetches, 1, "物理cacheは再利用しても論理的な初回通知を省略しない");
});

test("static保存transactionの途中失敗は状態・履歴・取得済partを全て取消す", async t => {
  const f = await filesFixture(t);
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  t.after(() => { globalThis.indexedDB = previous; });
  const options = { ...f.options, storage: { mode: "persistent", prefix: "static-abort" } };
  const execution = createStaticPlayerExecution(options);
  await execution.initialize();
  const before = (await request(execution, "/api/session/start")).playerState;
  const put = IDBObjectStore.prototype.put;
  let writes = 0;
  IDBObjectStore.prototype.put = function (...args) {
    if (++writes === 2) throw new DOMException("容量不足の再現", "QuotaExceededError");
    return put.apply(this, args);
  };
  try { await assert.rejects(() => send(execution, before, "虹の鍵"), error => error.kind === "unavailable"); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.ok(writes >= 2, "一部書込みを発行してからtransactionを失敗させる");
  const resumed = createStaticPlayerExecution(options);
  await resumed.initialize();
  const after = (await request(resumed, "/api/player-state")).playerState;
  assert.equal(after.projectState.part_seen, undefined);
  assert.deepEqual(after.searchAgentMessages, before.searchAgentMessages);
  const retried = (await send(resumed, after, "虹の鍵")).playerState;
  assert.equal(retried.searchAgentMessages.filter(message => message.body === "取得完了の案内マーカー8426").length, 1);
});

test("secretのgame_overもpart通知とsetを保存し、一時返信・from・完了hookの契約を変えない", async t => {
  let talkId, from;
  const f = await filesFixture(t, scenario => {
    const worker = scenario.worker;
    const talk = worker.talks.find(item => item.id === "guide");
    talkId = talk.publicId; from = talk.initialFrom;
    const blockId = "guide::static_game_over";
    worker.talkBlocks.push({ id: blockId, talkId: "guide", blockKey: "static_game_over", part: "evidence", order: 2000,
      messages: [{ id: "game-over-reply", sender: "guide", body: "一時表示の終端返信", attachmentId: "", sentAt: "" }] });
    talk.rules.unshift({ ...worker.talks.find(item => item.id === "search_agent").rules.find(rule => rule.type === "secret"),
      id: "secret-game-over", from, mode: "game_over", nextFromId: blockId, nextBlocks: [blockId], outputSteps: [{ kind: "block", blockId }] });
    worker.hooks.push({ event: "talk_turn_completed", target: "guide", cond: "", part: "evidence", order: 2000, handler: "unexpected_completion", llm: false });
    scenario.hookScripts.unexpected_completion = 'throw new Error("game_overでは呼ばない");';
  });
  const execution = createStaticPlayerExecution(f.options);
  await execution.initialize();
  const before = (await request(execution, "/api/session/start")).playerState;
  const talk = before.talks.find(item => item.talkId === talkId);
  const result = await request(execution, "/api/talk/send", { talkId, turnKey: talk.turnKey, message: "虹の鍵" });
  assert.equal(result.presentation.sequence.type, "game_over");
  assert.ok(result.presentation.sequence.talk.messages.some(message => message.body === "一時表示の終端返信"));
  assert.equal(result.playerState.projectState.part_seen, true);
  assert.ok(!result.playerState.smsMessages.some(message => message.body === "一時表示の終端返信"));
  assert.deepEqual(result.playerState.smsMessages, before.smsMessages);
  assert.notEqual(result.playerState.talks.find(item => item.talkId === talkId).turnKey, talk.turnKey);
  // 同じ入力地点に留まり、同じsecretをもう一度選べる（part通知だけは繰り返さない）。
  const repeated = await request(execution, "/api/talk/send", { talkId, turnKey: result.playerState.talks.find(item => item.talkId === talkId).turnKey, message: "虹の鍵" });
  assert.equal(repeated.presentation.sequence.type, "game_over");
  assert.equal(repeated.playerState.searchAgentMessages.filter(message => message.body === "取得完了の案内マーカー8426").length, 1);
});

test("secretの抽出不成立ではpartを取得せずdefaultへ戻り、取得待ちは返信時刻を先行させない", async t => {
  const f = await filesFixture(t, ({ worker }) => {
    const secret = worker.talks.find(item => item.id === "search_agent").rules.find(rule => rule.type === "secret");
    secret.match = '/^(?<name>虹の鍵)$/u';
    secret.set = ['fixture_extracted=$extract.name'];
    worker.stateVariables.fixture_extracted = ""; worker.stateVariableDefinitions.fixture_extracted = { type: "string" }; worker.stateVariableParts.fixture_extracted = "base";
  });
  let partReadyAt = 0;
  const execution = createStaticPlayerExecution({ ...f.options, fetch: async (url, init) => {
    if (url.includes("/parts/")) { await new Promise(resolve => setTimeout(resolve, 30)); partReadyAt = Date.now(); }
    return f.options.fetch(url, init);
  } });
  await execution.initialize();
  let state = (await request(execution, "/api/session/start")).playerState;
  state = (await send(execution, state, "rainbow")).playerState;
  assert.equal(state.projectState.part_seen, undefined);
  assert.ok(!f.requests.some(url => url.includes("/parts/")), "正答でも抽出不成立なら先行取得しない");
  state = (await send(execution, state, "虹の鍵")).playerState;
  assert.equal(state.projectState.part_seen, true);
  const reply = state.searchAgentMessages.find(message => message.body === "未到達の本文マーカー7391");
  assert.ok(Date.parse(reply.deliveredAt ?? reply.sentAt) >= partReadyAt);
});

test("回答JSON・partの不正形式と版違いは誤答や初期化へ倒さない", async t => {
  const f = await filesFixture(t);
  for (const broken of ["answer-json", "answer-release", "part-release", "hook-module"]) {
    const execution = createStaticPlayerExecution({ ...f.options, fetch: async (url, init) => {
      const response = await f.options.fetch(url, init);
      if (broken === "answer-json" && url.includes("/answers/")) return new Response("<html>fallback</html>");
      if ((broken === "answer-release" && url.includes("/answers/")) || (broken === "part-release" && url.includes("/parts/"))) {
        const data = await response.json(); data.releaseId = "別の配布版"; return Response.json(data);
      }
      return response;
    }, module: async url => {
      if (broken === "hook-module" && url.includes("/parts/")) throw new Error("module failure");
      return f.options.module(url);
    } });
    await execution.initialize();
    const before = (await request(execution, "/api/session/start")).playerState;
    const talk = before.talks.find(item => item.kind === "search_agent");
    const response = await execution.request("/api/talk/send", { method: "POST", body: JSON.stringify({ talkId: talk.talkId, turnKey: talk.turnKey, message: "虹の鍵" }) });
    assert.equal(response.status, 502, broken);
    assert.deepEqual((await request(execution, "/api/player-state")).playerState.searchAgentMessages, before.searchAgentMessages);
  }
});
