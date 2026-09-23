import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { D1Store } from "../src/platform/cloudflare/d1Store.ts";
import { SEARCH_AGENT_STREAM_ID } from "../src/shared/searchAgent.ts";
import { searchAgentPlayerMessageEvent } from "../src/worker/talkEvents.ts";
import { createInitialPlayerState } from "../src/worker/scenario.ts";
import { createApp } from "../src/server/app.ts";
import { workerScenario } from "../src/generated/workerScenario.generated.ts";
import { scenarioHookHandlers } from "../src/generated/scenarioHooks.generated.ts";

const sqlite = await import("node:sqlite").catch(() => null);
const reviewTest = sqlite ? test : test.skip;

class LocalStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalStatement(this.database, this.sql, values);
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class LocalD1 {
  constructor({ audioMigration = true } = {}) {
    this.lastBatchSql = [];
    this.database = new sqlite.DatabaseSync(":memory:");
    this.database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0002_player_access_code.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0003_player_transcripts.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0004_access_code_attempts.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0005_talk_events.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0006_hook_llm_results.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0007_generated_audio_intent.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0008_player_session_generation.sql", import.meta.url), "utf8"));
    if (audioMigration) this.database.exec(readFileSync(new URL("../migrations/0009_generated_audio_browser.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0010_access_code_management.sql", import.meta.url), "utf8"));
  }

  prepare(sql) {
    return new LocalStatement(this.database, sql);
  }

  async batch(statements) {
    this.lastBatchSql = statements.map((statement) => statement.sql);
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

reviewTest("補助音声migrationは既存jobの台本とindex・一意性を維持する", async () => {
  const local = new LocalD1({ audioMigration: false });
  const store = new D1Store(local);
  const session = await store.createPasscodeSession("1234", null, []);
  const job = { id: "existing", audioId: "voice", provider: "fixture", externalJobId: "external", inputHash: "hash", inputText: "保存済み台本", outputKey: "/ready.wav", status: "ready", errorCode: null, createdAt: "2020-01-01", completedAt: "2020-01-02" };
  await store.saveGeneratedAudioJob(session.playerId, job);
  local.database.exec(readFileSync(new URL("../migrations/0009_generated_audio_browser.sql", import.meta.url), "utf8"));
  assert.deepEqual(await store.generatedAudioJob(session.playerId, "voice"), job);
  assert.ok(local.database.prepare("PRAGMA index_list(generated_audio_jobs)").all().some(row => row.name === "idx_generated_audio_jobs_player"));
  assert.equal(local.database.prepare("PRAGMA foreign_key_list(generated_audio_jobs)").all().length, 0);
});

reviewTest("D1はplayer行なしの補助音声jobを保存し、明示再試行と遅い応答を区別する", async () => {
  const local = new LocalD1();
  local.database.exec("PRAGMA foreign_keys=ON");
  const store = new D1Store(local);
  const job = { id: "old", audioId: "voice", provider: "fixture", externalJobId: "external", inputHash: "hash", inputText: "保持する台本", outputKey: null, status: "running", errorCode: null, createdAt: "2020-01-01", completedAt: null };
  await store.saveGeneratedAudioJob("browser-player", job);
  assert.equal(local.database.prepare("SELECT COUNT(*) AS n FROM players").get().n, 0);
  const next = { ...job, id: "new", createdAt: "2026-09-23", status: "queued", externalJobId: null };
  assert.equal(await store.replaceGeneratedAudioJob("browser-player", "old", next), true);
  assert.equal(await store.updateGeneratedAudioJob("browser-player", { ...job, status: "ready", outputKey: "/old.wav" }), false);
  assert.equal(await store.updateGeneratedAudioJob("browser-player", { ...next, status: "ready", outputKey: "/new.wav" }), true);
  assert.equal(await store.updateGeneratedAudioJob("browser-player", { ...next, status: "running" }), false);
  const ready = await store.generatedAudioJob("browser-player", "voice");
  assert.equal(ready.outputKey, "/new.wav");
  assert.equal(ready.createdAt, next.createdAt);
  assert.equal(ready.inputText, job.inputText);
  assert.equal(await store.replaceGeneratedAudioJob("browser-player", "new", { ...next, id: "again" }), false);
  await store.saveGeneratedAudioJob("browser-player", { ...next, id: "replacement", createdAt: "2027-01-01" });
  assert.equal((await store.generatedAudioJob("browser-player", "voice")).id, "replacement");
});

reviewTest("D1の開始失敗・PIN・reset・再開始は同じ初期化を使い、旧sessionと遅着を隔離する", async () => {
  const original = structuredClone(workerScenario);
  const store = new D1Store(new LocalD1());
  let loadedCalls=0, startedCalls=0, fail=true;
  try {
    workerScenario.playerMode="server";
    workerScenario.project.lockScreen={method:"fixed-pin",pin:"0042"};
    workerScenario.stateVariables.reset_capture="開始前";
    workerScenario.stateVariableDefinitions.reset_capture={type:"string"};
    workerScenario.stateVariableParts.reset_capture="base";
    workerScenario.talkBlocks.find(block=>block.id==="guide::intro").messages[0].body="{{reset_capture}}";
    workerScenario.hooks=[
      {event:"part_loaded",target:"base",handler:"reset_fixture_loaded",cond:"",part:"base",order:0,llm:false},
      {event:"session_started",target:"",handler:"reset_fixture_started",cond:"",part:"base",order:1,llm:false}
    ];
    scenarioHookHandlers.reset_fixture_loaded=()=>{loadedCalls++; if(fail) throw new Error("開始失敗fixture");};
    scenarioHookHandlers.reset_fixture_started=context=>{startedCalls++;context.state.set("reset_capture","開始hook後");};
    const app=createApp({store,config:{appEnv:"dev",llm:{},playerInputLogging:false}});
    const post=(path, body={},token="")=>app.request(`http://localhost/api/${path}`,{
      method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)
    });
    const identity=await store.createPasscodeSession("1234",null);
    assert.equal((await post("player-state",{},identity.sessionToken)).status,409);
    assert.equal((await post("session/start",{serialCode:"1234"})).status,400,"PIN前は開始しない");
    assert.equal(loadedCalls,0);
    assert.equal((await post("session/start",{serialCode:"1234",pin:"0042"})).status,500);
    assert.equal((await store.playerForSession(identity.sessionToken)).state,null);
    assert.equal(startedCalls,0);
    fail=false;
    const first=await (await post("session/start",{serialCode:"1234",pin:"0042"})).json();
    assert.equal(first.ok,true);
    assert.equal(loadedCalls,2,"失敗したbase hookは通常開始で再試行する");
    const stale=await store.playerForSession(first.sessionToken);
    assert.equal(stale.state.talks.guide.initialFormatEnv.reset_capture,"開始前");
    await store.queueScheduledEvent(stale.id,"fixture","fixture",{},"2000-01-01T00:00:00.000Z");
    const oldEvent=(await store.dueScheduledEvents(stale.id,new Date().toISOString()))[0];
    await store.claimScheduledEvent(stale.id,oldEvent.id);
    const reset=await post("reset-for-testing",{},first.sessionToken);
    assert.deepEqual(await reset.json(),{ok:true});
    assert.equal(loadedCalls,2); assert.equal(startedCalls,1,"reset自体はhookを呼ばない");
    assert.equal(await store.playerForSession(first.sessionToken),null,"他タブの旧sessionも失効する");
    assert.equal(await store.savePlayer(stale,stale.state),false,"読み込み済み旧操作はCASで失敗する");
    const next=await (await post("session/start",{serialCode:"1234",pin:"0042"})).json();
    assert.equal(next.ok,true);
    const current=await store.playerForSession(next.sessionToken);
    assert.equal(current.id,stale.id,"同じプレイヤー行を使う");
    assert.equal(loadedCalls,3); assert.equal(startedCalls,2);
    const withoutStreamKey=talks=>Object.fromEntries(Object.entries(talks).map(([id,{transcriptKey,...talk}])=>[id,talk]));
    assert.deepEqual(withoutStreamKey(current.state.talks),withoutStreamKey(stale.state.talks),"初期env・turn・履歴配置を共通経路で作る");
    assert.notEqual(current.state.talks.search_agent.transcriptKey,stale.state.talks.search_agent.transcriptKey);
    await store.queueScheduledEvent(current.id,"fixture","fixture",{},"2000-01-01T00:00:00.000Z");
    const newEvent=(await store.dueScheduledEvents(current.id,new Date().toISOString()))[0];
    await store.completeScheduledEvent(current.id,oldEvent.id);
    assert.equal((await store.dueScheduledEvents(current.id,new Date().toISOString()))[0].id,newEvent.id);
  } finally {
    Object.assign(workerScenario,original);
    delete scenarioHookHandlers.reset_fixture_loaded;delete scenarioHookHandlers.reset_fixture_started;
  }
});

reviewTest("D1のreset CAS敗者は資源を消さず、古い生成音声結果も新jobを上書きしない",async()=>{
  const store=new D1Store(new LocalD1());
  const session=await store.createPasscodeSession("cas-reset",createInitialPlayerState());
  const stale=await store.playerForSession(session.sessionToken);
  await store.savePlayer(stale,stale.state);
  await store.queueScheduledEvent(stale.id,"still-needed","event",{},"2099-01-01T00:00:00.000Z");
  assert.equal(await store.resetPlayerProgress(stale),false);
  assert.equal(await store.nextScheduledWakeAt(stale.id),"2099-01-01T00:00:00.000Z");
  const job={id:"old",audioId:"audio",provider:"static",externalJobId:null,inputHash:"same",inputText:null,outputKey:null,status:"queued",errorCode:null,createdAt:new Date().toISOString(),completedAt:null};
  await store.saveGeneratedAudioJob(stale.id,{...job,id:"new"});
  assert.equal(await store.updateGeneratedAudioJob(stale.id,{...job,status:"ready"}),false);
  assert.equal((await store.generatedAudioJob(stale.id,"audio")).id,"new");
});

reviewTest("会話・開始hook・初期予約がない作品も開始を確定する",async()=>{
  const original=structuredClone(workerScenario);
  try {
    Object.assign(workerScenario,{playerMode:"server",talks:[],hooks:[],initialSchedules:[]});
    const store=new D1Store(new LocalD1());
    const app=createApp({store,config:{appEnv:"dev",llm:{},playerInputLogging:false}});
    const response=await app.request("http://localhost/api/session/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({serialCode:"1234"})});
    assert.equal(response.status,200);
    const started=await response.json();
    assert.ok((await store.playerForSession(started.sessionToken)).state);
    assert.equal((await app.request("http://localhost/api/player-state",{method:"POST",headers:{authorization:`Bearer ${started.sessionToken}`}})).status,200);
  }finally{Object.assign(workerScenario,original);}
});

reviewTest("D1版は新規playerと初期scheduleを同じbatchで作成する", async () => {
  const local = new LocalD1();
  const store = new D1Store(local);
  const initialSchedule = {
    id: "initial-schedule",
    eventId: "show_demo_call",
    fields: { source: "initial" },
    dueAt: "2099-01-01T00:00:00.000Z"
  };
  const created = await store.createPasscodeSession("initial-schedule-code", createInitialPlayerState(), [initialSchedule]);
  assert.equal(created.created, true);
  assert.equal(local.lastBatchSql.length, 2);
  assert.match(local.lastBatchSql[0], /INSERT INTO players/u);
  assert.match(local.lastBatchSql[1], /INSERT INTO scheduled_events/u);
  assert.deepEqual(
    { ...local.database.prepare("SELECT schedule_id, event_id, payload_json, due_at, status FROM scheduled_events").get() },
    {
      schedule_id: initialSchedule.id,
      event_id: initialSchedule.eventId,
      payload_json: JSON.stringify(initialSchedule.fields),
      due_at: initialSchedule.dueAt,
      status: "queued"
    }
  );

  const reopened = await store.createPasscodeSession("initial-schedule-code", createInitialPlayerState(), [{
    ...initialSchedule,
    id: "must-not-be-added"
  }]);
  assert.equal(reopened.created, false);
  assert.equal(local.database.prepare("SELECT COUNT(*) AS count FROM scheduled_events").get().count, 1);
});

reviewTest("D1版はlast-seen更新失敗で取得済みplayerを失わない", async () => {
  const local = new LocalD1();
  const store = new D1Store(local);
  const session = await store.createPasscodeSession("last-seen-code", createInitialPlayerState());
  const originalPrepare = local.prepare.bind(local);
  local.prepare = (sql) => {
    if (/^UPDATE sessions SET last_seen_at/u.test(sql)) {
      return {
        bind() {
          return { async run() { throw new Error("last_seen_failed"); } };
        }
      };
    }
    return originalPrepare(sql);
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal((await store.playerForSession(session.sessionToken))?.id, session.playerId);
  } finally {
    console.error = originalConsoleError;
  }
});

reviewTest("D1版search agent履歴は既存JSON streamへ絶対seqのcompact eventを保存する", async () => {
  const local = new LocalD1();
  const store = new D1Store(local);
  const session = await store.createPasscodeSession("12345678", createInitialPlayerState());
  const player = await store.playerForSession(session.sessionToken);
  assert.ok(player);
  const transcript = {
    streamId: SEARCH_AGENT_STREAM_ID,
    transcriptKey: "search-agent-key",
    messages: [
      searchAgentPlayerMessageEvent({ id: "search-1", seq: 1, body: "古いメモ", deliveredAt: "2026-08-14T00:00:00.000Z" }),
      searchAgentPlayerMessageEvent({ id: "search-2", seq: 2, body: "記録", deliveredAt: "2026-08-14T00:00:01.000Z" })
    ]
  };

  assert.equal(await store.savePlayer(player, player.state, [transcript]), true);
  assert.deepEqual(await store.loadTranscript(player.id, SEARCH_AGENT_STREAM_ID, transcript.transcriptKey), transcript);
  assert.equal(local.database.prepare("SELECT COUNT(*) AS count FROM talk_events").get().count, 0);
  assert.equal(local.database.prepare(
    "SELECT COUNT(*) AS count FROM player_transcripts WHERE stream_id = ?"
  ).get(SEARCH_AGENT_STREAM_ID).count, 1);
  assert.equal(await store.savePlayer(player, player.state, [transcript]), false);
  assert.deepEqual(await store.loadTranscript(player.id, SEARCH_AGENT_STREAM_ID, transcript.transcriptKey), transcript);
  const currentPlayer = await store.playerForSession(session.sessionToken);
  assert.equal(await store.savePlayer(currentPlayer, currentPlayer.state, [{
    ...transcript,
    messages: [{ ...transcript.messages[1], body: "同じseqの異なる本文" }]
  }]), false);
});

reviewTest("D1版talk履歴はNPC本文を展開せずblock参照のcompact eventを保存する", async () => {
  const local = new LocalD1();
  const store = new D1Store(local);
  const session = await store.createPasscodeSession("87654321", createInitialPlayerState());
  const player = await store.playerForSession(session.sessionToken);
  assert.ok(player);
  const transcriptKey = "talk-transcript-key";
  const events = [
    {
      id: "sms_player_turn",
      kind: "sms",
      talk_id: "guide",
      event_type: "player_message",
      body: "入力本文",
      block_id: null,
      format_env_json: null,
      delivered_at: "2026-08-20T00:00:00.000Z"
    },
    {
      id: "sms_block_turn_1",
      kind: "sms",
      talk_id: "guide",
      event_type: "message_block",
      body: null,
      block_id: "guide::message_reply",
      format_env_json: JSON.stringify({ player_name: "田中" }),
      delivered_at: "2026-08-20T00:00:01.000Z"
    }
  ];
  assert.equal(await store.savePlayer(player, player.state, [{
    streamId: "talk:guide",
    transcriptKey,
    messages: events
  }]), true);
  assert.deepEqual((await store.loadTranscript(player.id, "talk:guide", transcriptKey)).messages, events);

  const currentPlayer = await store.playerForSession(session.sessionToken);
  const nextEvent = {
    ...events[0],
    id: "sms_player_turn_2",
    body: "次の入力",
    delivered_at: "2026-08-20T00:00:02.000Z"
  };
  assert.equal(await store.savePlayer(currentPlayer, currentPlayer.state, [{
    streamId: "talk:guide",
    transcriptKey,
    messages: [nextEvent]
  }]), true);
  assert.equal(local.lastBatchSql.filter((sql) => /INSERT OR IGNORE INTO talk_events/u.test(sql)).length, 1);
  assert.deepEqual((await store.loadTranscript(player.id, "talk:guide", transcriptKey)).messages, [...events, nextEvent]);

  const stored = local.database.prepare(
    "SELECT event_type, body, block_id, format_env_json FROM talk_events ORDER BY delivered_at, id"
  ).all().map((row) => ({ ...row }));
  assert.deepEqual(stored, [
    { event_type: "player_message", body: "入力本文", block_id: null, format_env_json: null },
    { event_type: "message_block", body: null, block_id: "guide::message_reply", format_env_json: JSON.stringify({ player_name: "田中" }) },
    { event_type: "player_message", body: "次の入力", block_id: null, format_env_json: null }
  ]);
  assert.equal(local.database.prepare("SELECT COUNT(*) AS count FROM player_transcripts WHERE stream_id = 'talk:guide'").get().count, 0);

  assert.equal(await store.resetPlayerProgress(await store.playerForSession(session.sessionToken)), true);
  assert.equal(local.database.prepare("SELECT COUNT(*) AS count FROM talk_events").get().count, 0);
});

reviewTest("D1版のコード記録は20回で15分ロックし、期限後の成功で失敗回数だけを解除する", async () => {
  const store = new D1Store(new LocalD1());
  const at = "2026-08-17T00:00:00.000Z";
  for (let index = 0; index < 20; index += 1) await store.recordAccessCodeAttempt("0042", false, at);
  assert.equal((await store.accessCode("0042")).lockedUntil, "2026-08-17T00:15:00.000Z");
  assert.equal(await store.recordAccessCodeAttempt("0042", true, at), false);
  assert.equal(await store.recordAccessCodeAttempt("0042", true, "2026-08-17T00:16:00.000Z"), true);
  assert.equal((await store.accessCode("0042")).lockedUntil, null);
  assert.equal((await store.accessCode("0042")).successCount, 1);
  await store.setAccessCodeDisabled("0042", true, "2026-08-17T00:17:00.000Z");
  assert.equal(await store.recordAccessCodeAttempt("0042", true, "2026-08-17T00:18:00.000Z"), false);
  await store.recordAccessCodeAttempt("0042", false, "2026-08-17T00:18:00.000Z");
  assert.equal((await store.accessCode("0042")).disabled, true);
  await store.setAccessCodeDisabled("0001", false, at);
  const first = await store.accessCodes("", 1);
  assert.equal(first.items[0].counter, "0001");
  assert.equal(first.nextCursor, "0001");
  assert.equal((await store.accessCodes(first.nextCursor, 1)).items[0].counter, "0042");
  await Promise.all(Array.from({ length: 20 }, () => store.recordAccessCodeAttempt("0001", true, at)));
  assert.equal((await store.accessCode("0001")).successCount, 20);
});

reviewTest("D1版の入力ログ確認は会話入力の本文で絞り込む", async () => {
  const store = new D1Store(new LocalD1());
  await store.recordInputEvent({
    playerId: "player-1",
    requestKey: "search-1",
    talkId: "search_agent",
    fromId: "intro",
    userInput: "黄色い灯り",
    status: "completed",
    matched: true,
    responseSnapshot: { resultCount: 1 }
  }, true);
  await store.recordInputEvent({
    playerId: "player-1",
    requestKey: "talk-1",
    appId: "messages",
    talkId: "guide",
    fromId: "start",
    userInput: "別の入力",
    status: "completed",
    matched: false
  }, true);
  const { items: rows } = await store.playerInputEvents({ playerId: "player-1", query: "灯り", limit: 100 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userInput, "黄色い灯り");
  assert.equal(rows[0].appId, null);
  assert.deepEqual(rows[0].responseSnapshot, { resultCount: 1 });
});

reviewTest("D1版hook LLM cacheは先勝ち・期限・player resetを守る", async () => {
  const store = new D1Store(new LocalD1());
  const session = await store.createPasscodeSession("11223344", createInitialPlayerState());
  const record = {
    cacheKey: "cache-key",
    taskId: "task",
    kind: "extract",
    modelVersion: "fast:model:none",
    inputHash: "input",
    promptHash: "prompt",
    schemaHash: "schema",
    status: "ready",
    output: { value: "first" },
    errorCode: null,
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
  assert.deepEqual((await store.saveHookLlmResultIfAbsent(session.playerId, record)).output, { value: "first" });
  assert.deepEqual((await store.saveHookLlmResultIfAbsent(session.playerId, { ...record, output: { value: "second" } })).output, { value: "first" });
  assert.deepEqual((await store.loadHookLlmResult(session.playerId, record.cacheKey, "2026-01-01T00:00:00.000Z"))?.output, { value: "first" });
  assert.equal(await store.loadHookLlmResult(session.playerId, record.cacheKey, "2100-01-01T00:00:00.000Z"), null);
  const expired = {
    ...record,
    cacheKey: "expired-cache-key",
    output: { value: "expired" },
    expiresAt: "2000-01-01T00:00:00.000Z"
  };
  await store.saveHookLlmResultIfAbsent(session.playerId, expired);
  const refreshed = { ...expired, output: { value: "refreshed" }, expiresAt: "2099-01-01T00:00:00.000Z" };
  assert.deepEqual((await store.saveHookLlmResultIfAbsent(session.playerId, refreshed)).output, { value: "refreshed" });
  assert.deepEqual((await store.loadHookLlmResult(session.playerId, expired.cacheKey, "2026-01-01T00:00:00.000Z"))?.output, { value: "refreshed" });
  assert.equal(await store.resetPlayerProgress(await store.playerForSession(session.sessionToken)), true);
  assert.equal(await store.loadHookLlmResult(session.playerId, record.cacheKey, "2026-01-01T00:00:00.000Z"), null);
});

reviewTest("D1版はscheduleと生成音声intentをstate CASと同じbatchへ入れる", async () => {
  const local = new LocalD1();
  const store = new D1Store(local);
  const session = await store.createPasscodeSession("44332211", createInitialPlayerState());
  const player = await store.playerForSession(session.sessionToken);
  const audioJob = {
    id: "audio-job",
    audioId: "demo_voice",
    provider: "static",
    externalJobId: null,
    inputHash: "hash",
    inputText: "生成前の入力",
    outputKey: null,
    status: "queued",
    errorCode: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    completedAt: null
  };
  assert.equal(await store.savePlayer(player, player.state, [], {
    schedules: [{ type: "queue", id: "schedule", eventId: "show_demo_call", fields: {}, dueAt: "2099-01-01T00:00:00.000Z" }],
    generatedAudioJobs: [audioJob]
  }), true);
  assert.equal(local.database.prepare("SELECT status FROM scheduled_events WHERE schedule_id = 'schedule'").get().status, "queued");
  assert.equal(local.database.prepare("SELECT input_text FROM generated_audio_jobs WHERE audio_id = 'demo_voice'").get().input_text, "生成前の入力");
  assert.equal(await store.savePlayer(player, player.state, [], {
    schedules: [{ type: "queue", id: "stale", eventId: "show_demo_call", fields: {}, dueAt: "2099-01-01T00:00:00.000Z" }]
  }), false);
  assert.equal(local.database.prepare("SELECT COUNT(*) AS count FROM scheduled_events WHERE schedule_id = 'stale'").get().count, 0);
});

reviewTest("D1版も監修クラスタを同じグループ単位で置換する", async () => {
  const store = new D1Store(new LocalD1());
  await store.replaceReviewClusters("talk-1", "from-1", "rule-1", "revision-1", [{
    id: "cluster-1",
    fit: "blue",
    representativeInput: "最初",
    sourceEventIds: ["event-1"],
    summaryJson: JSON.stringify({ reason: "適合" }),
    analysisVersion: "v1"
  }]);
  await store.replaceReviewClusters("talk-1", "from-1", "rule-1", "revision-1", [{
    id: "cluster-2",
    fit: "yellow",
    representativeInput: "更新後",
    sourceEventIds: ["event-2"],
    summaryJson: JSON.stringify({ reason: "要確認" }),
    analysisVersion: "v1"
  }]);

  const clusters = await store.reviewClusters("talk-1", "from-1", "revision-1");
  assert.deepEqual(clusters.map((cluster) => ({
    id: cluster.id,
    fit: cluster.fit,
    sourceEventIds: cluster.sourceEventIds,
    inputsJson: cluster.inputsJson
  })), [{ id: "cluster-2", fit: "yellow", sourceEventIds: ["event-2"], inputsJson: "[]" }]);
});

reviewTest("D1版の監修指示更新もtalk・from・idをキーとして扱う", async () => {
  const store = new D1Store(new LocalD1());
  const judgment = {
    id: "judgment-1",
    scope: "branch",
    sourceEventIds: [],
    clusterId: null,
    talkId: "talk-1",
    fromId: "from-1",
    actualRuleId: "rule-1",
    expectedRuleId: null,
    judgment: "comment_only",
    comment: "最初",
    newBranchNote: "",
    reviewerLabel: "reviewer",
    scenarioRevision: "revision-1",
    status: "open",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
  await store.saveReviewJudgment(judgment);
  await store.updateReviewJudgment("talk-1", "from-1", "judgment-1", {
    comment: "更新後",
    newBranchNote: "",
    reviewerLabel: "reviewer",
    updatedAt: "2026-08-13T01:00:00.000Z"
  });
  await store.updateReviewJudgment("wrong-talk", "from-1", "judgment-1", {
    comment: "誤更新",
    newBranchNote: "",
    reviewerLabel: "reviewer",
    updatedAt: "2026-08-13T02:00:00.000Z"
  });

  const rows = await store.reviewJudgments({ talkId: "talk-1", fromId: "from-1", status: "open" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].comment, "更新後");
});
