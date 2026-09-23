import type {
  AppStore,
  GeneratedAudioJob,
  HookLlmCacheRecord,
  InitialScheduledEvent,
  InputEventRecord,
  PlayerInputReviewFilters,
  PlayerInputReviewPage,
  PlayerCommitEffects,
  PlayerRecord,
  SessionPlayerRecord,
  ReviewCluster,
  ReviewClusterReplacement,
  ReviewInputEvent,
  ReviewInputQuery,
  ReviewJudgment,
  ReviewJudgmentFilter,
  ReviewJudgmentStatus,
  ReviewTrialInput,
  ScheduledEvent,
  StoredPlayerState,
  StoredTalkEvent,
  StoredTranscript,
  TranscriptAppend
} from "../../server/store.ts";
import {
  decodeReviewCursor,
  encodeReviewCursor,
  MAX_SESSIONS_PER_PLAYER,
  limitedTranscript,
  isSearchAgentTranscriptConflictError,
  mergeTranscriptAppend,
  normalizeStoredState,
  nowIso,
  scheduledEventLeaseCutoff,
  scheduledEventLeaseWakeAt,
  sha256
} from "../../server/store.ts";
import { ACCESS_CODE_ATTEMPT_WINDOW_MS, ACCESS_CODE_MAX_FAILED_ATTEMPTS } from "../../server/accessCode.ts";
import { SEARCH_AGENT_STREAM_ID } from "../../shared/searchAgent.ts";

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
  input_text: string | null;
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
    inputText: row.input_text,
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

  async createPasscodeSession(
    accessCode: string,
    initialState: StoredPlayerState | null,
    initialSchedules: readonly InitialScheduledEvent[] = []
  ) {
    const accessCodeHash = await sha256(`xstoryphone:access-code:v1:${accessCode}`);
    let player = await this.db.prepare("SELECT id FROM players WHERE access_code_hash = ?")
      .bind(accessCodeHash)
      .first<{ id: string }>();
    let created = false;

    if (!player) {
      const playerId = crypto.randomUUID();
      const now = nowIso();
      try {
        await this.db.batch([
          this.db.prepare(
            "INSERT INTO players (id, access_code_hash, state_json, state_version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"
          ).bind(playerId, accessCodeHash, JSON.stringify(initialState), now, now),
          ...initialSchedules.map((schedule) => this.db.prepare(
            `INSERT INTO scheduled_events
             (id, player_id, schedule_id, event_id, payload_json, due_at, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
          ).bind(
            crypto.randomUUID(), playerId, schedule.id, schedule.eventId,
            JSON.stringify(schedule.fields), schedule.dueAt, now, now
          ))
        ]);
        player = { id: playerId };
        created = true;
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
    await this.db.prepare("INSERT INTO sessions (token_hash, player_id, created_at, last_seen_at, generation) SELECT ?, id, ?, ?, session_generation FROM players WHERE id = ?")
      .bind(tokenHash, now, now, player.id)
      .run();
    await this.prunePlayerSessions(player.id, tokenHash)
      .catch((error) => console.error("[sessions:prune]", error));
    return { playerId: player.id, sessionToken, created };
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

  async playerForSession(sessionToken: string): Promise<SessionPlayerRecord | null> {
    const tokenHash = await sha256(sessionToken);
    const row = await this.db.prepare(
      `SELECT players.id, players.state_json, players.state_version, players.session_generation
       FROM sessions
       INNER JOIN players ON players.id = sessions.player_id
       WHERE sessions.token_hash = ? AND sessions.generation = players.session_generation`
    ).bind(tokenHash).first<{ id: string; state_json: string; state_version: number; session_generation: number }>();
    if (!row) return null;
    await this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(nowIso(), tokenHash).run()
      .catch((error) => console.error("[sessions:last_seen]", error instanceof Error ? error.name : "unknown"));
    const state = JSON.parse(row.state_json) as StoredPlayerState | null;
    return {
      id: row.id,
      state: state === null ? null : normalizeStoredState(state),
      resetting: false,
      sessionGeneration: row.session_generation,
      stateVersion: row.state_version
    };
  }

  async resetPlayerProgress(player: SessionPlayerRecord) {
    const mutationId = crypto.randomUUID();
    const statements = [this.db.prepare(
      "UPDATE players SET state_json = 'null', state_version = state_version + 1, session_generation = session_generation + 1, last_mutation_id = ?, updated_at = ? WHERE id = ? AND state_version = ?"
    ).bind(mutationId, nowIso(), player.id, player.stateVersion)];
    for (const table of ["scheduled_events", "generated_audio_jobs", "talk_events", "player_transcripts", "hook_llm_results"]) {
      statements.push(this.db.prepare(`DELETE FROM ${table} WHERE player_id = ? AND EXISTS (SELECT 1 FROM players WHERE id = ? AND last_mutation_id = ?)`)
        .bind(player.id, player.id, mutationId));
    }
    const results = await this.db.batch(statements);
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async loadTranscript(playerId: string, streamId: string, transcriptKey: string): Promise<StoredTranscript> {
    if (streamId.startsWith("talk:") && streamId !== SEARCH_AGENT_STREAM_ID) {
      const talkId = streamId.slice("talk:".length);
      const rows = await this.db.prepare(
        `SELECT id, kind, talk_id, event_type, body, block_id, format_env_json, delivered_at
         FROM talk_events
         WHERE player_id = ? AND talk_id = ? AND transcript_key = ?
         ORDER BY delivered_at ASC, id ASC`
      ).bind(playerId, talkId, transcriptKey).all<StoredTalkEvent>();
      return { streamId, transcriptKey, messages: (rows.results ?? []).map((row) => ({ ...row })) };
    }
    const row = await this.db.prepare(
      "SELECT transcript_key, messages_json FROM player_transcripts WHERE player_id = ? AND stream_id = ?"
    ).bind(playerId, streamId).first<{ transcript_key: string; messages_json: string }>();
    if (!row || row.transcript_key !== transcriptKey) {
      return { streamId, transcriptKey, messages: [] };
    }
    let messages: unknown;
    try {
      messages = JSON.parse(row.messages_json) as unknown;
    } catch {
      return { streamId, transcriptKey, messages: [] };
    }
    return limitedTranscript({ streamId, transcriptKey, messages: Array.isArray(messages) ? messages : [] });
  }

  async savePlayer(player: PlayerRecord, nextState: StoredPlayerState, transcripts: TranscriptAppend[] = [], effects: PlayerCommitEffects = {}) {
    let completedSearchAgentTranscripts: StoredTranscript[];
    try {
      completedSearchAgentTranscripts = await Promise.all(transcripts
        .filter((transcript) => transcript.streamId === SEARCH_AGENT_STREAM_ID)
        .map(async (append) => mergeTranscriptAppend(
          await this.loadTranscript(player.id, append.streamId, append.transcriptKey),
          append
        )));
    } catch (error) {
      if (isSearchAgentTranscriptConflictError(error)) return false;
      throw error;
    }
    const now = nowIso();
    if (!transcripts.length && !(effects.schedules?.length) && !(effects.generatedAudioJobs?.length)) {
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
    const updateTranscripts = completedSearchAgentTranscripts
      .map(limitedTranscript)
      .map((transcript) => this.db.prepare(
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
    const insertTalkEvents = transcripts
      .filter((transcript) => transcript.streamId.startsWith("talk:") && transcript.streamId !== SEARCH_AGENT_STREAM_ID)
      .flatMap((transcript) => transcript.messages.flatMap((message) => {
        if (message.kind === "search_agent") return [];
        return [this.db.prepare(
          `INSERT OR IGNORE INTO talk_events
             (id, player_id, transcript_key, kind, talk_id, event_type, body, block_id, format_env_json, delivered_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM players WHERE id = ? AND last_mutation_id = ?)`
        ).bind(
          message.id,
          player.id,
          transcript.transcriptKey,
          message.kind,
          message.talk_id,
          message.event_type,
          message.body,
          message.block_id,
          message.format_env_json,
          message.delivered_at,
          player.id,
          mutationId
        )];
      }));
    const scheduleStatements = (effects.schedules ?? []).map((effect) => effect.type === "cancel"
      ? this.db.prepare(
          `UPDATE scheduled_events SET status = 'canceled', updated_at = ?
           WHERE player_id = ? AND schedule_id = ? AND status IN ('queued', 'running')
             AND EXISTS (SELECT 1 FROM players WHERE id = ? AND last_mutation_id = ?)`
        ).bind(now, player.id, effect.id, player.id, mutationId)
      : this.db.prepare(
          `INSERT INTO scheduled_events (id, player_id, schedule_id, event_id, payload_json, due_at, status, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, 'queued', ?, ?
           WHERE EXISTS (SELECT 1 FROM players WHERE id = ? AND last_mutation_id = ?)
           ON CONFLICT(player_id, schedule_id) DO UPDATE SET
             event_id = excluded.event_id, payload_json = excluded.payload_json, due_at = excluded.due_at,
             status = 'queued', updated_at = excluded.updated_at
           WHERE scheduled_events.status != 'completed'`
        ).bind(crypto.randomUUID(), player.id, effect.id, effect.eventId, JSON.stringify(effect.fields), effect.dueAt, now, now, player.id, mutationId));
    const audioStatements = (effects.generatedAudioJobs ?? []).map((job) => this.db.prepare(
      `INSERT INTO generated_audio_jobs
       (id, player_id, audio_id, provider, external_job_id, input_hash, input_text, output_key,
        status, error_code, created_at, updated_at, completed_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM players WHERE id = ? AND last_mutation_id = ?)
       ON CONFLICT(player_id, audio_id) DO UPDATE SET
         id = excluded.id, created_at = excluded.created_at,
         provider = excluded.provider, external_job_id = excluded.external_job_id,
         input_hash = excluded.input_hash, input_text = excluded.input_text, output_key = excluded.output_key,
         status = excluded.status, error_code = excluded.error_code, updated_at = excluded.updated_at,
         completed_at = excluded.completed_at`
    ).bind(
      job.id, player.id, job.audioId, job.provider, job.externalJobId, job.inputHash, job.inputText,
      job.outputKey, job.status, job.errorCode, job.createdAt, now, job.completedAt, player.id, mutationId
    ));
    const results = await this.db.batch([updatePlayer, ...updateTranscripts, ...insertTalkEvents, ...scheduleStatements, ...audioStatements]);
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async loadHookLlmResult(playerId: string, cacheKey: string, at: string) {
    const row = await this.db.prepare(
      `SELECT cache_key, task_id, kind, model_version, input_hash, prompt_hash, schema_hash,
              status, output_json, error_code, expires_at
       FROM hook_llm_results WHERE player_id = ? AND cache_key = ? AND expires_at > ?`
    ).bind(playerId, cacheKey, at).first<{
      cache_key: string; task_id: string; kind: string; model_version: string; input_hash: string;
      prompt_hash: string; schema_hash: string; status: "ready" | "fallback"; output_json: string;
      error_code: string | null; expires_at: string;
    }>();
    if (!row) return null;
    try {
      const output = JSON.parse(row.output_json) as HookLlmCacheRecord["output"];
      return {
        cacheKey: row.cache_key, taskId: row.task_id, kind: row.kind, modelVersion: row.model_version,
        inputHash: row.input_hash, promptHash: row.prompt_hash, schemaHash: row.schema_hash,
        status: row.status, output, errorCode: row.error_code, expiresAt: row.expires_at
      };
    } catch {
      return null;
    }
  }

  async saveHookLlmResultIfAbsent(playerId: string, record: HookLlmCacheRecord) {
    const now = nowIso();
    await this.db.prepare(
      `INSERT INTO hook_llm_results
       (id, player_id, cache_key, task_id, kind, model_version, input_hash, prompt_hash, schema_hash,
        status, output_json, error_code, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id, cache_key) DO UPDATE SET
         id = excluded.id, task_id = excluded.task_id, kind = excluded.kind,
         model_version = excluded.model_version, input_hash = excluded.input_hash,
         prompt_hash = excluded.prompt_hash, schema_hash = excluded.schema_hash,
         status = excluded.status, output_json = excluded.output_json,
         error_code = excluded.error_code, expires_at = excluded.expires_at,
         created_at = excluded.created_at, updated_at = excluded.updated_at
       WHERE hook_llm_results.expires_at <= ?`
    ).bind(
      crypto.randomUUID(), playerId, record.cacheKey, record.taskId, record.kind, record.modelVersion,
      record.inputHash, record.promptHash, record.schemaHash, record.status, JSON.stringify(record.output),
      record.errorCode, record.expiresAt, now, now, now
    ).run();
    return await this.loadHookLlmResult(playerId, record.cacheKey, now) ?? record;
  }

  async clearHookLlmResults(playerId: string) {
    await this.db.prepare("DELETE FROM hook_llm_results WHERE player_id = ?").bind(playerId).run();
  }

  async cleanupExpiredHookLlmResults(at: string, limit: number) {
    await this.db.prepare(
      "DELETE FROM hook_llm_results WHERE id IN (SELECT id FROM hook_llm_results WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)"
    ).bind(at, Math.max(1, Math.min(500, limit))).run();
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
      "talk_send",
      event.playerId,
      event.requestKey,
      nowIso(),
      event.appId ?? null,
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

  async playerInputEvents(filters: PlayerInputReviewFilters): Promise<PlayerInputReviewPage> {
    const clauses = ["event_type = 'talk_send'"];
    const values: unknown[] = [];
    if (filters.playerId) {
      clauses.push("player_id = ?");
      values.push(filters.playerId);
    }
    if (filters.talkId) {
      clauses.push("talk_id = ?");
      values.push(filters.talkId);
    }
    for (const [field, operator, value] of [
      ["status", "=", filters.status], ["occurred_at", "<", filters.before], ["occurred_at", ">=", filters.after]
    ] as const) {
      if (value) { clauses.push(`${field} ${operator} ?`); values.push(value); }
    }
    const cursor = decodeReviewCursor(filters.cursor);
    if (cursor) {
      if (!cursor.at || !cursor.id || Object.keys(cursor).length !== 2) throw new Error("invalid_review_cursor");
      clauses.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
      values.push(cursor.at, cursor.at, cursor.id);
    }
    if (filters.query) {
      clauses.push("(instr(normalized_input, ?) > 0 OR instr(lower(response_snapshot_json), ?) > 0)");
      const query = filters.query.normalize("NFC").trim().toLocaleLowerCase("ja");
      values.push(query, query);
    }
    values.push(filters.limit + 1);
    const result = await this.db.prepare(
      `SELECT id, player_id, occurred_at, app_id, talk_id, from_id, user_input,
              status, matched, rule_id, next_from_id, response_snapshot_json
       FROM player_input_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY occurred_at DESC, id DESC LIMIT ?`
    ).bind(...values).all<{
      id: string;
      player_id: string;
      occurred_at: string;
      app_id: string | null;
      talk_id: string | null;
      from_id: string | null;
      user_input: string;
      status: string;
      matched: number;
      rule_id: string | null;
      next_from_id: string | null;
      response_snapshot_json: string;
    }>();
    const rows = result.results ?? [];
    const selected = rows.slice(0, filters.limit);
    const last = selected[selected.length - 1];
    return {
      nextCursor: rows.length > filters.limit && last ? encodeReviewCursor({ at: last.occurred_at, id: last.id }) : null,
      items: selected.map((row) => ({
        id: row.id,
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
      }))
    };
  }

  private generatedAudioSelect() {
    return `SELECT id, audio_id, provider, external_job_id, input_hash, input_text, output_key,
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
       (id, player_id, audio_id, provider, external_job_id, input_hash, input_text, output_key,
        status, error_code, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id, audio_id) DO UPDATE SET
         id = excluded.id, created_at = excluded.created_at,
         provider = excluded.provider,
         external_job_id = excluded.external_job_id,
         input_hash = excluded.input_hash,
         input_text = excluded.input_text,
         output_key = excluded.output_key,
         status = excluded.status,
         error_code = excluded.error_code,
         updated_at = excluded.updated_at,
         completed_at = excluded.completed_at`
    ).bind(
      job.id, playerId, job.audioId, job.provider, job.externalJobId, job.inputHash, job.inputText, job.outputKey,
      job.status, job.errorCode, job.createdAt, now, job.completedAt
    ).run();
  }

  async generatedAudioJobs(playerId: string) {
    const rows = await this.db.prepare(`${this.generatedAudioSelect()} WHERE player_id = ?`)
      .bind(playerId).all<Parameters<typeof generatedAudioJob>[0]>();
    return (rows.results ?? []).map(generatedAudioJob);
  }

  async updateGeneratedAudioJob(playerId: string, job: GeneratedAudioJob) {
    const result = await this.db.prepare(`UPDATE generated_audio_jobs SET external_job_id = ?, input_text = ?, output_key = ?, status = ?, error_code = ?, updated_at = ?, completed_at = ?
      WHERE player_id = ? AND audio_id = ? AND id = ? AND input_hash = ? AND provider = ? AND status IN ('queued', 'running')`)
      .bind(job.externalJobId,job.inputText,job.outputKey,job.status,job.errorCode,nowIso(),job.completedAt,playerId,job.audioId,job.id,job.inputHash,job.provider).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async replaceGeneratedAudioJob(playerId: string, expectedId: string, job: GeneratedAudioJob) {
    const result = await this.db.prepare(`UPDATE generated_audio_jobs SET id = ?, created_at = ?, updated_at = ?,
      external_job_id = NULL, output_key = NULL, status = 'queued', error_code = NULL, completed_at = NULL
      WHERE player_id = ? AND audio_id = ? AND id = ? AND input_hash = ? AND provider = ? AND status != 'ready'`)
      .bind(job.id, job.createdAt, nowIso(), playerId, job.audioId, expectedId, job.inputHash, job.provider).run();
    return (result.meta.changes ?? 0) === 1;
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

  async reviewInputCounts(talkId: string, fromId: string) {
    const result = await this.db.prepare(
      "SELECT rule_id, COUNT(*) AS count FROM player_input_events WHERE event_type = 'talk_send' AND talk_id = ? AND from_id = ? AND rule_id IS NOT NULL GROUP BY rule_id"
    ).bind(talkId, fromId).all<{ rule_id: string; count: number }>();
    return Object.fromEntries((result.results ?? []).map((row) => [row.rule_id, row.count]));
  }

  async reviewInputEvents(talkId: string, fromId: string, query: ReviewInputQuery = {}): Promise<ReviewInputEvent[]> {
    if (query.ids) {
      const rows: ReviewInputEvent[] = [];
      const ids = [...new Set(query.ids)];
      // D1のbind数上限に収める。根拠件数自体を切り捨てる上限ではない。
      for (let offset = 0; offset < ids.length; offset += 80) {
        const batch = ids.slice(offset, offset + 80);
        rows.push(...await this.loadReviewInputEvents(talkId, fromId, { ...query, ids: batch }));
      }
      return rows;
    }
    return this.loadReviewInputEvents(talkId, fromId, query);
  }

  private async loadReviewInputEvents(talkId: string, fromId: string, query: ReviewInputQuery): Promise<ReviewInputEvent[]> {
    const where = ["event_type = 'talk_send'", "talk_id = ?", "from_id = ?", "rule_id IS NOT NULL"];
    const values: unknown[] = [talkId, fromId];
    if (query.ruleId) { where.push("rule_id = ?"); values.push(query.ruleId); }
    if (query.ids) { where.push(`id IN (${query.ids.map(() => "?").join(",")})`); values.push(...query.ids); }
    if (!query.ids) values.push(query.limit ?? 1000);
    const result = await this.db.prepare(
      `SELECT id, rule_id, user_input, normalized_input, response_snapshot_json
       FROM player_input_events
       WHERE ${where.join(" AND ")}
       ORDER BY occurred_at DESC, id DESC ${query.ids ? "" : "LIMIT ?"}`
    ).bind(...values).all<{ id: string; rule_id: string; user_input: string; normalized_input: string; response_snapshot_json: string }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      userInput: row.user_input,
      normalizedInput: row.normalized_input,
      responseSnapshot: jsonRecord(row.response_snapshot_json)
    }));
  }

  async reviewTrialInputs(talkId: string, fromId: string, ids?: readonly string[]): Promise<ReviewTrialInput[]> {
    if (ids && !ids.length) return [];
    if (ids && ids.length > 80) {
      const rows: ReviewTrialInput[] = [];
      for (let offset = 0; offset < ids.length; offset += 80) rows.push(...await this.reviewTrialInputs(talkId, fromId, ids.slice(offset, offset + 80)));
      return rows;
    }
    const result = await this.db.prepare(
      `SELECT id, actual_rule_id, user_input, response_snapshot_json FROM talk_branch_review_trial_inputs
       WHERE talk_id = ? AND from_id = ? AND status = 'active'
       ${ids ? `AND id IN (${ids.map(() => "?").join(",")})` : ""}
       ORDER BY created_at DESC, id DESC ${ids ? "" : "LIMIT 500"}`
    ).bind(talkId, fromId, ...(ids ?? [])).all<{ id: string; actual_rule_id: string; user_input: string; response_snapshot_json: string }>();
    return (result.results ?? []).map((row) => ({ id: row.id, actualRuleId: row.actual_rule_id, userInput: row.user_input,
      responseSnapshot: jsonRecord(row.response_snapshot_json) }));
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
      "UPDATE talk_branch_review_judgments SET comment = ?, new_branch_note = ?, reviewer_label = ?, updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ? AND status = 'open'"
    ).bind(input.comment, input.newBranchNote, input.reviewerLabel, input.updatedAt, id, talkId, fromId).run();
  }

  async updateReviewJudgmentStatus(talkId: string, fromId: string, id: string, status: ReviewJudgmentStatus, updatedAt: string, onlyOpen = false) {
    await this.db.prepare(`UPDATE talk_branch_review_judgments SET status = ?, updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ?${onlyOpen ? " AND status = 'open'" : ""}`)
      .bind(status, updatedAt, id, talkId, fromId).run();
  }

  async deleteReviewTrialInput(talkId: string, fromId: string, id: string, updatedAt: string) {
    const result = await this.db.prepare(
      "UPDATE talk_branch_review_trial_inputs SET status = 'deleted', updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ? AND status = 'active'"
    ).bind(updatedAt, id, talkId, fromId).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async updateReviewJudgmentSourceIds(talkId: string, fromId: string, id: string, sourceEventIds: string[], updatedAt: string) {
    await this.db.prepare("UPDATE talk_branch_review_judgments SET source_event_ids_json = ?, updated_at = ? WHERE id = ? AND talk_id = ? AND from_id = ? AND status = 'open'")
      .bind(JSON.stringify(sourceEventIds), updatedAt, id, talkId, fromId).run();
  }

}
