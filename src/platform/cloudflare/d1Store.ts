import type {
  AppStore,
  GeneratedAudioJob,
  InputEventRecord,
  PlayerInputReviewEvent,
  PlayerRecord,
  ReviewCluster,
  ReviewClusterReplacement,
  ReviewInputEvent,
  ReviewJudgment,
  ReviewJudgmentFilter,
  ReviewJudgmentStatus,
  ReviewTrialInput,
  ScheduledEvent,
  StoredPlayerState,
  StoredTranscript,
  TranscriptUpdate
} from "../../server/store.ts";
import {
  MAX_SESSIONS_PER_PLAYER,
  limitedTranscript,
  normalizeStoredState,
  nowIso,
  scheduledEventLeaseCutoff,
  scheduledEventLeaseWakeAt,
  sha256
} from "../../server/store.ts";
import { ACCESS_CODE_ATTEMPT_WINDOW_MS, ACCESS_CODE_MAX_FAILED_ATTEMPTS } from "../../server/accessCode.ts";

function stringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stringRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]))
      : {};
  } catch {
    return {};
  }
}

function jsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function generatedAudioJob(row: {
  id: string;
  audio_id: string;
  provider: string;
  external_job_id: string | null;
  input_hash: string;
  output_key: string | null;
  status: GeneratedAudioJob["status"];
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}): GeneratedAudioJob {
  return {
    id: row.id,
    audioId: row.audio_id,
    provider: row.provider,
    externalJobId: row.external_job_id,
    inputHash: row.input_hash,
    outputKey: row.output_key,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

export class D1Store implements AppStore {
  readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async createPasscodeSession(accessCode: string, initialState: StoredPlayerState) {
    const accessCodeHash = await sha256(`xstoryphone:access-code:v1:${accessCode}`);
    let player = await this.db.prepare("SELECT id FROM players WHERE access_code_hash = ?")
      .bind(accessCodeHash)
      .first<{ id: string }>();
    const playerBeforeInsert = player;

    if (!player) {
      const playerId = crypto.randomUUID();
      const now = nowIso();
      try {
        await this.db.prepare(
          "INSERT INTO players (id, access_code_hash, state_json, state_version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"
        ).bind(playerId, accessCodeHash, JSON.stringify(initialState), now, now).run();
        player = { id: playerId };
      } catch (error) {
        // 同じコードの初回作成が競合した場合は、先に作成されたプレイヤーを使う。
        player = await this.db.prepare("SELECT id FROM players WHERE access_code_hash = ?")
          .bind(accessCodeHash)
          .first<{ id: string }>();
        if (!player) throw error;
      }
    }

    const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/gu, "");
    const tokenHash = await sha256(sessionToken);
    const now = nowIso();
    await this.db.prepare("INSERT INTO sessions (token_hash, player_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)")
      .bind(tokenHash, player.id, now, now)
      .run();
    await this.prunePlayerSessions(player.id, tokenHash)
      .catch((error) => console.error("[sessions:prune]", error));
    return { playerId: player.id, sessionToken, created: !playerBeforeInsert };
  }

  async isAccessCodeLocked(counter: string, at: string) {
    const row = await this.db.prepare("SELECT locked_until FROM access_code_attempts WHERE counter_text = ?")
      .bind(counter)
      .first<{ locked_until: string | null }>();
    return Boolean(row?.locked_until && Date.parse(row.locked_until) > Date.parse(at));
  }

  async recordAccessCodeAttempt(counter: string, success: boolean, at: string) {
    if (success) {
      await this.db.prepare("DELETE FROM access_code_attempts WHERE counter_text = ?").bind(counter).run();
      return;
    }
    const current = await this.db.prepare("SELECT failed_count, updated_at FROM access_code_attempts WHERE counter_text = ?")
      .bind(counter)
      .first<{ failed_count: number; updated_at: string }>();
    const atMs = Date.parse(at);
    const withinWindow = current && atMs - Date.parse(current.updated_at) < ACCESS_CODE_ATTEMPT_WINDOW_MS;
    const failedCount = withinWindow ? current.failed_count + 1 : 1;
    const lockedUntil = failedCount >= ACCESS_CODE_MAX_FAILED_ATTEMPTS
      ? new Date(atMs + ACCESS_CODE_ATTEMPT_WINDOW_MS).toISOString()
      : null;
    await this.db.prepare(
      `INSERT INTO access_code_attempts (counter_text, failed_count, locked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(counter_text) DO UPDATE SET
         failed_count = excluded.failed_count,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`
    ).bind(counter, failedCount, lockedUntil, at).run();
  }

  async prunePlayerSessions(playerId: string, currentTokenHash: string) {
    await this.db.prepare(
      `DELETE FROM sessions
       WHERE player_id = ? AND token_hash != ? AND token_hash NOT IN (
         SELECT token_hash FROM sessions
         WHERE player_id = ? AND token_hash != ?
         ORDER BY last_seen_at DESC, created_at DESC, token_hash DESC
         LIMIT ?
       )`
    ).bind(playerId, currentTokenHash, playerId, currentTokenHash, MAX_SESSIONS_PER_PLAYER - 1).run();
  }

  async playerForSession(sessionToken: string): Promise<PlayerRecord | null> {
    const tokenHash = await sha256(sessionToken);
    const row = await this.db.prepare(
      `SELECT players.id, players.state_json, players.state_version
       FROM sessions
       INNER JOIN players ON players.id = sessions.player_id
       WHERE sessions.token_hash = ?`
    ).bind(tokenHash).first<{ id: string; state_json: string; state_version: number }>();
    if (!row) return null;
    await this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(nowIso(), tokenHash).run();
    return {
      id: row.id,
      state: normalizeStoredState(JSON.parse(row.state_json) as StoredPlayerState),
      stateVersion: row.state_version
    };
  }

  async loadTranscript(playerId: string, streamId: string, transcriptKey: string): Promise<StoredTranscript> {
    const row = await this.db.prepare(
      "SELECT transcript_key, messages_json FROM player_transcripts WHERE player_id = ? AND stream_id = ?"
    ).bind(playerId, streamId).first<{ transcript_key: string; messages_json: string }>();
    if (!row || row.transcript_key !== transcriptKey) {
      return { streamId, transcriptKey, messages: [] };
    }
    try {
      const messages = JSON.parse(row.messages_json) as unknown;
      return limitedTranscript({ streamId, transcriptKey, messages: Array.isArray(messages) ? messages : [] });
    } catch {
      return { streamId, transcriptKey, messages: [] };
    }
  }

  async savePlayer(player: PlayerRecord, nextState: StoredPlayerState, transcripts: TranscriptUpdate[] = []) {
    const now = nowIso();
    if (!transcripts.length) {
      const result = await this.db.prepare(
        `UPDATE players SET state_json = ?, state_version = state_version + 1, updated_at = ?
         WHERE id = ? AND state_version = ?`
      ).bind(JSON.stringify(nextState), now, player.id, player.stateVersion).run();
      return (result.meta.changes ?? 0) === 1;
    }

    const mutationId = crypto.randomUUID();
    const updatePlayer = this.db.prepare(
      `UPDATE players SET state_json = ?, state_version = state_version + 1, updated_at = ?, last_mutation_id = ?
       WHERE id = ? AND state_version = ?`
    ).bind(JSON.stringify(nextState), now, mutationId, player.id, player.stateVersion);
    const updateTranscripts = transcripts.map(limitedTranscript).map((transcript) => this.db.prepare(
      `INSERT INTO player_transcripts (player_id, stream_id, transcript_key, messages_json, updated_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM players WHERE id = ? AND last_mutation_id = ?)
       ON CONFLICT(player_id, stream_id) DO UPDATE SET
         transcript_key = excluded.transcript_key,
         messages_json = excluded.messages_json,
         updated_at = excluded.updated_at`
    ).bind(
      player.id,
      transcript.streamId,
      transcript.transcriptKey,
      JSON.stringify(transcript.messages),
      now,
      player.id,
      mutationId
    ));
    const results = await this.db.batch([updatePlayer, ...updateTranscripts]);
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async clearPlayerRuntimeJobs(playerId: string) {
    await this.db.batch([
      this.db.prepare("DELETE FROM scheduled_events WHERE player_id = ?").bind(playerId),
      this.db.prepare("DELETE FROM generated_audio_jobs WHERE player_id = ?").bind(playerId)
    ]);
  }

  async queueScheduledEvent(playerId: string, scheduleId: string, eventId: string, fields: Record<string, string>, dueAt: string) {
    const now = nowIso();
    await this.db.prepare(
      `INSERT INTO scheduled_events (id, player_id, schedule_id, event_id, payload_json, due_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
       ON CONFLICT(player_id, schedule_id) DO UPDATE SET
         event_id = excluded.event_id,
         payload_json = excluded.payload_json,
         due_at = excluded.due_at,
         status = 'queued',
         updated_at = excluded.updated_at
       WHERE scheduled_events.status != 'completed'`
    ).bind(crypto.randomUUID(), playerId, scheduleId, eventId, JSON.stringify(fields), dueAt, now, now).run();
  }

  async cancelScheduledEvent(playerId: string, scheduleId: string) {
    await this.db.prepare(
      "UPDATE scheduled_events SET status = 'canceled', updated_at = ? WHERE player_id = ? AND schedule_id = ? AND status IN ('queued', 'running')"
    ).bind(nowIso(), playerId, scheduleId).run();
  }

  async nextScheduledWakeAt(playerId: string) {
    const result = await this.db.prepare(
      `SELECT due_at, status, updated_at FROM scheduled_events
       WHERE player_id = ? AND status IN ('queued', 'running')`
    ).bind(playerId).all<{ due_at: string; status: "queued" | "running"; updated_at: string }>();
    const wakeTimes = (result.results ?? []).map((row) =>
      row.status === "running" ? scheduledEventLeaseWakeAt(row.updated_at) : row.due_at
    );
    return wakeTimes.sort()[0] ?? null;
  }

  async dueScheduledEvents(playerId: string, at: string): Promise<ScheduledEvent[]> {
    const leaseCutoff = scheduledEventLeaseCutoff(at);
    const result = await this.db.prepare(
      `SELECT id, schedule_id, event_id, payload_json FROM scheduled_events
       WHERE player_id = ? AND due_at <= ?
         AND (status = 'queued' OR (status = 'running' AND updated_at <= ?))
       ORDER BY due_at ASC LIMIT 5`
    ).bind(playerId, at, leaseCutoff).all<{ id: string; schedule_id: string; event_id: string; payload_json: string }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      scheduleId: row.schedule_id,
      eventId: row.event_id,
      fields: stringRecord(row.payload_json)
    }));
  }

  async claimScheduledEvent(playerId: string, id: string) {
    const now = nowIso();
    const leaseCutoff = scheduledEventLeaseCutoff(now);
    const result = await this.db.prepare(
      `UPDATE scheduled_events SET status = 'running', updated_at = ?
       WHERE id = ? AND player_id = ?
         AND (status = 'queued' OR (status = 'running' AND updated_at <= ?))`
    ).bind(now, id, playerId, leaseCutoff).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async completeScheduledEvent(playerId: string, id: string) {
    await this.db.prepare(
      "UPDATE scheduled_events SET status = 'completed', updated_at = ? WHERE id = ? AND player_id = ? AND status = 'running'"
    ).bind(nowIso(), id, playerId).run();
  }

  async requeueScheduledEvent(playerId: string, id: string) {
    await this.db.prepare(
      "UPDATE scheduled_events SET status = 'queued', updated_at = ? WHERE id = ? AND player_id = ? AND status = 'running'"
    ).bind(nowIso(), id, playerId).run();
  }

  async recordInputEvent(event: InputEventRecord, enabled: boolean) {
    if (!enabled) return;
    await this.db.prepare(
      `INSERT OR IGNORE INTO player_input_events
       (id, event_type, player_id, request_key, occurred_at, app_id, talk_id, from_id,
        user_input, normalized_input, status, matched, rule_id, next_from_id, response_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      event.eventType,
      event.playerId,
      event.requestKey,
      nowIso(),
      event.appId,
      event.talkId ?? null,
      event.fromId ?? null,
      event.userInput,
      event.userInput.normalize("NFC").trim().toLocaleLowerCase("ja"),
      event.status,
      event.matched ? 1 : 0,
      event.ruleId ?? null,
      event.nextFromId ?? null,
      JSON.stringify(event.responseSnapshot ?? {})
    ).run();
  }

  async playerInputEvents(filters: {
    eventType?: "search" | "talk_send";
    playerId?: string;
    talkId?: string;
    query?: string;
    limit: number;
  }): Promise<PlayerInputReviewEvent[]> {
    const clauses = ["1 = 1"];
    const values: unknown[] = [];
    if (filters.eventType) {
      clauses.push("event_type = ?");
      values.push(filters.eventType);
    }
    if (filters.playerId) {
      clauses.push("player_id = ?");
      values.push(filters.playerId);
    }
    if (filters.talkId) {
      clauses.push("talk_id = ?");
      values.push(filters.talkId);
    }
    if (filters.query) {
      clauses.push("instr(normalized_input, ?) > 0");
      values.push(filters.query.normalize("NFC").trim().toLocaleLowerCase("ja"));
    }
    values.push(filters.limit);
    const result = await this.db.prepare(
      `SELECT id, event_type, player_id, occurred_at, app_id, talk_id, from_id, user_input,
              status, matched, rule_id, next_from_id, response_snapshot_json
       FROM player_input_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY occurred_at DESC, id DESC LIMIT ?`
    ).bind(...values).all<{
      id: string;
      event_type: "search" | "talk_send";
      player_id: string;
      occurred_at: string;
      app_id: string;
      talk_id: string | null;
      from_id: string | null;
      user_input: string;
      status: string;
      matched: number;
      rule_id: string | null;
      next_from_id: string | null;
      response_snapshot_json: string;
    }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      playerId: row.player_id,
      occurredAt: row.occurred_at,
      appId: row.app_id,
      talkId: row.talk_id,
      fromId: row.from_id,
      userInput: row.user_input,
      status: row.status,
      matched: row.matched === 1,
      ruleId: row.rule_id,
      nextFromId: row.next_from_id,
      responseSnapshot: jsonRecord(row.response_snapshot_json)
    }));
  }

  private generatedAudioSelect() {
    return `SELECT id, audio_id, provider, external_job_id, input_hash, output_key,
                   status, error_code, created_at, completed_at
            FROM generated_audio_jobs`;
  }

  async generatedAudioJob(playerId: string, audioId: string) {
    const row = await this.db.prepare(`${this.generatedAudioSelect()} WHERE player_id = ? AND audio_id = ?`)
      .bind(playerId, audioId).first<Parameters<typeof generatedAudioJob>[0]>();
    return row ? generatedAudioJob(row) : null;
  }

  async saveGeneratedAudioJob(playerId: string, job: GeneratedAudioJob) {
    const now = nowIso();
    await this.db.prepare(
      `INSERT INTO generated_audio_jobs
       (id, player_id, audio_id, provider, external_job_id, input_hash, output_key,
        status, error_code, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id, audio_id) DO UPDATE SET
         provider = excluded.provider,
         external_job_id = excluded.external_job_id,
         input_hash = excluded.input_hash,
         output_key = excluded.output_key,
         status = excluded.status,
         error_code = excluded.error_code,
         updated_at = excluded.updated_at,
         completed_at = excluded.completed_at`
    ).bind(
      job.id, playerId, job.audioId, job.provider, job.externalJobId, job.inputHash, job.outputKey,
      job.status, job.errorCode, job.createdAt, now, job.completedAt
    ).run();
  }

  async pendingGeneratedAudioJobs(playerId: string) {
    const rows = await this.db.prepare(`${this.generatedAudioSelect()} WHERE player_id = ? AND status IN ('queued', 'running')`)
      .bind(playerId).all<Parameters<typeof generatedAudioJob>[0]>();
    return (rows.results ?? []).map(generatedAudioJob);
  }

  async generatedAudioJobs(playerId: string) {
    const rows = await this.db.prepare(`${this.generatedAudioSelect()} WHERE player_id = ?`)
      .bind(playerId).all<Parameters<typeof generatedAudioJob>[0]>();
    return (rows.results ?? []).map(generatedAudioJob);
  }

  async reviewJudgments(filter: ReviewJudgmentFilter) {
    const clauses = ["1 = 1"];
    const values: unknown[] = [];
    const talkId = "talkId" in filter ? filter.talkId : undefined;
    const fromId = "fromId" in filter ? filter.fromId : undefined;
    if (talkId) {
      clauses.push("talk_id = ?");
      values.push(talkId);
    }
    if (fromId) {
      clauses.push("from_id = ?");
      values.push(fromId);
    }
    if (filter.status) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    const result = await this.db.prepare(
      `SELECT id, scope, source_event_ids_json, cluster_id, talk_id, from_id, actual_rule_id,
              expected_rule_id, judgment, comment, new_branch_note, reviewer_label, scenario_revision,
              status, created_at, updated_at
       FROM talk_branch_review_judgments WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`
    ).bind(...values).all<{
      id: string;
      scope: string;
      source_event_ids_json: string;
      cluster_id: string | null;
      talk_id: string;
      from_id: string;
      actual_rule_id: string | null;
      expected_rule_id: string | null;
      judgment: string;
      comment: string;
      new_branch_note: string;
      reviewer_label: string;
      scenario_revision: string;
      status: ReviewJudgmentStatus;
      created_at: string;
      updated_at: string;
    }>();
    return (result.results ?? []).map((row): ReviewJudgment => ({
      id: row.id,
      scope: row.scope,
      sourceEventIds: stringArray(row.source_event_ids_json),
      clusterId: row.cluster_id,
      talkId: row.talk_id,
      fromId: row.from_id,
      actualRuleId: row.actual_rule_id,
      expectedRuleId: row.expected_rule_id,
      judgment: row.judgment,
      comment: row.comment,
      newBranchNote: row.new_branch_note,
      reviewerLabel: row.reviewer_label,
      scenarioRevision: row.scenario_revision,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async reviewInputEvents(talkId: string, fromId: string): Promise<ReviewInputEvent[]> {
    const result = await this.db.prepare(
      `SELECT id, rule_id, user_input, normalized_input
       FROM player_input_events
       WHERE event_type = 'talk_send' AND talk_id = ? AND from_id = ? AND rule_id IS NOT NULL
       ORDER BY occurred_at DESC LIMIT 1000`
    ).bind(talkId, fromId).all<{ id: string; rule_id: string; user_input: string; normalized_input: string }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      userInput: row.user_input,
      normalizedInput: row.normalized_input
    }));
  }

  async reviewTrialInputs(talkId: string, fromId: string): Promise<ReviewTrialInput[]> {
    const result = await this.db.prepare(
      `SELECT id, actual_rule_id, user_input FROM talk_branch_review_trial_inputs
       WHERE talk_id = ? AND from_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 500`
    ).bind(talkId, fromId).all<{ id: string; actual_rule_id: string; user_input: string }>();
    return (result.results ?? []).map((row) => ({ id: row.id, actualRuleId: row.actual_rule_id, userInput: row.user_input }));
  }

  async reviewClusters(talkId: string, fromId: string, scenarioRevision: string): Promise<ReviewCluster[]> {
    const result = await this.db.prepare(
      `SELECT id, actual_rule_id, fit, representative_input, input_count, source_event_ids_json, inputs_json
       FROM talk_branch_review_clusters
       WHERE talk_id = ? AND from_id = ? AND scenario_revision = ?
       ORDER BY input_count DESC, created_at DESC`
    ).bind(talkId, fromId, scenarioRevision).all<{
      id: string;
      actual_rule_id: string;
      fit: ReviewCluster["fit"];
      representative_input: string;
      input_count: number;
      source_event_ids_json: string;
      inputs_json: string;
    }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      actualRuleId: row.actual_rule_id,
      fit: row.fit,
      representativeInput: row.representative_input,
      inputCount: row.input_count,
      sourceEventIds: stringArray(row.source_event_ids_json),
      inputsJson: row.inputs_json
    }));
  }

  async replaceReviewClusters(
    talkId: string,
    fromId: string,
    actualRuleId: string,
    scenarioRevision: string,
    clusters: ReviewClusterReplacement[]
  ) {
    const now = nowIso();
    const deleteStatement = this.db.prepare(
      `DELETE FROM talk_branch_review_clusters
       WHERE talk_id = ? AND from_id = ? AND actual_rule_id = ? AND scenario_revision = ?`
    ).bind(talkId, fromId, actualRuleId, scenarioRevision);
    const insertStatements = clusters.map((cluster) => this.db.prepare(
      `INSERT INTO talk_branch_review_clusters
       (id, talk_id, from_id, actual_rule_id, fit, representative_input, input_count, source_event_ids_json,
        inputs_json, summary_json, analysis_version, scenario_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`
    ).bind(
      cluster.id,
      talkId,
      fromId,
      actualRuleId,
      cluster.fit,
      cluster.representativeInput,
      cluster.sourceEventIds.length,
      JSON.stringify(cluster.sourceEventIds),
      cluster.summaryJson,
      cluster.analysisVersion,
      scenarioRevision,
      now,
      now
    ));
    await this.db.batch([deleteStatement, ...insertStatements]);
  }

  async saveReviewTrialInput(input: {
    id: string;
    talkId: string;
    fromId: string;
    actualRuleId: string;
    userInput: string;
    nextFromId: string;
    responseSnapshot: Record<string, unknown>;
    createdAt: string;
  }) {
    await this.db.prepare(
      `INSERT INTO talk_branch_review_trial_inputs
       (id, talk_id, from_id, actual_rule_id, user_input, next_from_id, response_snapshot_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(
      input.id, input.talkId, input.fromId, input.actualRuleId, input.userInput, input.nextFromId,
      JSON.stringify(input.responseSnapshot), input.createdAt, input.createdAt
    ).run();
  }

  async saveReviewJudgment(judgment: ReviewJudgment) {
    await this.db.prepare(
      `INSERT INTO talk_branch_review_judgments
       (id, scope, source_event_ids_json, cluster_id, talk_id, from_id, actual_rule_id, expected_rule_id,
        judgment, comment, new_branch_note, reviewer_label, scenario_revision, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      judgment.id, judgment.scope, JSON.stringify(judgment.sourceEventIds), judgment.clusterId,
      judgment.talkId, judgment.fromId, judgment.actualRuleId, judgment.expectedRuleId,
      judgment.judgment, judgment.comment, judgment.newBranchNote, judgment.reviewerLabel,
      judgment.scenarioRevision, judgment.status, judgment.createdAt, judgment.updatedAt
    ).run();
  }

  async updateReviewJudgment(talkId: string, fromId: string, id: string, input: { comment: string; newBranchNote: string; reviewerLabel: string; updatedAt: string }) {
    await this.db.prepare(
      "UPDATE talk_branch_review_judgments SET comment = ?, new_branch_note = ?, reviewer_label = ?, updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ?"
    ).bind(input.comment, input.newBranchNote, input.reviewerLabel, input.updatedAt, id, talkId, fromId).run();
  }

  async updateReviewJudgmentStatus(talkId: string, fromId: string, id: string, status: ReviewJudgmentStatus, updatedAt: string) {
    await this.db.prepare("UPDATE talk_branch_review_judgments SET status = ?, updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ?")
      .bind(status, updatedAt, id, talkId, fromId).run();
  }

  async deleteReviewTrialInput(talkId: string, fromId: string, id: string, updatedAt: string) {
    const result = await this.db.prepare(
      "UPDATE talk_branch_review_trial_inputs SET status = 'deleted', updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ? AND status = 'active'"
    ).bind(updatedAt, id, talkId, fromId).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async updateReviewJudgmentSourceIds(talkId: string, fromId: string, id: string, sourceEventIds: string[], updatedAt: string) {
    await this.db.prepare("UPDATE talk_branch_review_judgments SET source_event_ids_json = ?, updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ?")
      .bind(JSON.stringify(sourceEventIds), updatedAt, id, talkId, fromId).run();
  }

}
