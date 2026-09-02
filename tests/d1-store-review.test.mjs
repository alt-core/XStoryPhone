import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { D1Store } from "../src/platform/cloudflare/d1Store.ts";
import { SEARCH_AGENT_STREAM_ID } from "../src/shared/searchAgent.ts";
import { searchAgentPlayerMessageEvent } from "../src/worker/talkEvents.ts";
import { createInitialPlayerState } from "../src/worker/scenario.ts";

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
  constructor() {
    this.lastBatchSql = [];
    this.database = new sqlite.DatabaseSync(":memory:");
    this.database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0002_player_access_code.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0003_player_transcripts.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0004_access_code_attempts.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0005_talk_events.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0006_hook_llm_results.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0007_generated_audio_intent.sql", import.meta.url), "utf8"));
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

reviewTest("D1版talk履歴は展開済みNPC本文ではなく正本形式のeventを保存する", async () => {
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

  await store.clearPlayerRuntimeJobs(player.id);
  assert.equal(local.database.prepare("SELECT COUNT(*) AS count FROM talk_events").get().count, 0);
});

reviewTest("D1版のアクセスコード失敗記録は20回で15分ロックし、成功時に削除する", async () => {
  const store = new D1Store(new LocalD1());
  const at = "2026-08-17T00:00:00.000Z";
  for (let index = 0; index < 20; index += 1) await store.recordAccessCodeAttempt("0042", false, at);
  assert.equal(await store.isAccessCodeLocked("0042", "2026-08-17T00:01:00.000Z"), true);
  assert.equal(await store.isAccessCodeLocked("0042", "2026-08-17T00:16:00.000Z"), false);
  await store.recordAccessCodeAttempt("0042", true, at);
  assert.equal(await store.isAccessCodeLocked("0042", "2026-08-17T00:01:00.000Z"), false);
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
  const rows = await store.playerInputEvents({ playerId: "player-1", query: "灯り", limit: 100 });
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
  await store.clearPlayerRuntimeJobs(session.playerId);
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
