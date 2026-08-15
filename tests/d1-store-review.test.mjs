import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { D1Store } from "../src/platform/cloudflare/d1Store.ts";
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
    this.database = new sqlite.DatabaseSync(":memory:");
    this.database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0002_player_access_code.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0003_player_transcripts.sql", import.meta.url), "utf8"));
  }

  prepare(sql) {
    return new LocalStatement(this.database, sql);
  }

  async batch(statements) {
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

reviewTest("D1版は進行状態と変更された会話ストリームを同じbatchで保存する", async () => {
  const store = new D1Store(new LocalD1());
  const session = await store.createPasscodeSession("12345678", createInitialPlayerState());
  const player = await store.playerForSession(session.sessionToken);
  assert.ok(player);
  const transcript = {
    streamId: "search",
    transcriptKey: player.state.searchTranscriptKey,
    messages: [{
      seq: 1,
      id: "search-1",
      requestId: "request-1",
      role: "user",
      body: "古いメモ",
      sentAt: "2026-08-14T00:00:00.000Z"
    }]
  };

  assert.equal(await store.savePlayer(player, player.state, [transcript]), true);
  assert.deepEqual(await store.loadTranscript(player.id, "search", transcript.transcriptKey), transcript);
  const staleTranscript = {
    ...transcript,
    messages: [{ ...transcript.messages[0], body: "競合で保存されてはいけない本文" }]
  };
  assert.equal(await store.savePlayer(player, player.state, [staleTranscript]), false);
  assert.deepEqual(await store.loadTranscript(player.id, "search", transcript.transcriptKey), transcript);
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
