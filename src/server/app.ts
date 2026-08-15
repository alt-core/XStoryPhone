import { Hono, type Context } from "hono";
import { registerProjectRoutes } from "../project/routes.ts";
import type { ScenarioHookEvent } from "../shared/hooks.ts";
import type { StoredTalkMessage } from "../shared/scenario.ts";
import { APP_VERSION } from "../shared/version.ts";
import type {
  AppDependencies,
  PlayerRecord,
  ServerEnv,
  StoredPlayerState,
  StoredSearchAgentMessage,
  StoredTranscriptMessage,
  TranscriptUpdate
} from "./store.ts";
import { copyStoredPlayerState } from "./store.ts";
import { createStructuredOutputProvider } from "../worker/providers/structuredOutput.ts";
import {
  appById,
  appAvailable,
  contentAvailable,
  contentByInternalId,
  contentByPublicId,
  createInitialPlayerState,
  messagesForTalkBlocks,
  notificationIdsForTarget,
  openTargetExists,
  publicPlayerState,
  publicTalkMessage,
  reconcileScenarioState,
  revealTalkMessages,
  repairTarget,
  searchScenario,
  searchResponseFor,
  talkAvailable,
  talkCanPost,
  talkByPublicId,
  talkByInternalId,
  workerScenario
} from "../worker/scenario.ts";
import { prepareGeneratedAudio, publicGeneratedAudioStates } from "../worker/services/generatedAudio.ts";
import { runScenarioHooks } from "../worker/services/scenarioHooks.ts";
import { internalizeTalkCommand, semanticInputForTalkCommand, talkCommandAvailable } from "../worker/services/talkCommand.ts";
import { resolveScenarioTalkRule } from "../worker/services/talkResolver.ts";
import { applyCompactStateAssignments, effectiveStateValues } from "../worker/stateValues.ts";
import { registerTalkBranchReviewRoutes } from "../worker/admin/talkBranchReviewRoutes.ts";
import { BrowserProgressTooLargeError, decodeBrowserProgress, encodeBrowserProgress } from "./browserProgress.ts";
import { isProductionEnvironment, isResetForTestingAllowed } from "./environment.ts";

type AppContext = Context<ServerEnv>;

const completionScenarioEvents = new Set([
  "audio_playback_completed",
  "audio_cue_reached",
  "incoming_call_completed"
]);
const coreClientScenarioEvents = new Set([...completionScenarioEvents, "blocked_content_link_opened"]);

function dependencies(c: AppContext) {
  return c.var.dependencies;
}

function browserMode() {
  return workerScenario.playerMode === "browser";
}

function browserStateSecret(c: AppContext) {
  const configured = dependencies(c).config.browserStateSecret?.trim();
  if (configured) return configured;
  const hostname = new URL(c.req.url).hostname;
  const localRequest = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  const appEnv = dependencies(c).config.appEnv;
  return localRequest && !isProductionEnvironment(appEnv)
    ? "xstoryphone-local-browser-state"
    : "";
}

class RetryableScheduledEventError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super("scheduled_event_retryable");
    this.name = "RetryableScheduledEventError";
    this.originalError = originalError;
  }
}

function bearerToken(value: string | undefined) {
  return /^Bearer\s+([^\s]+)$/iu.exec(value ?? "")?.[1] ?? "";
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.normalize("NFC").trim().slice(0, maxLength) : "";
}

function internalScenarioField(key: string, value: string) {
  if (key === "contentId") return contentByPublicId(value)?.id ?? value;
  if (key === "talkId") return talkByPublicId(value)?.id ?? value;
  return value;
}

function unique(items: readonly string[]) {
  return [...new Set(items)];
}

function repairTargetWasFound(state: StoredPlayerState, contentId: string, appId: string) {
  return state.discoveredTargetKeys.includes(`${appId}:${contentId}`);
}

function syncTalkReadCursors(state: StoredPlayerState, body: Record<string, unknown> | null) {
  if (!Array.isArray(body?.talkReadCursors)) return false;
  let changed = false;
  const seen = new Set<string>();
  for (const item of body.talkReadCursors.slice(0, 20)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const talkId = cleanText((item as Record<string, unknown>).talkId, 160);
    const messageSeq = Number((item as Record<string, unknown>).messageSeq);
    const talk = talkByPublicId(talkId);
    const stored = talk ? state.talks[talk.id] : null;
    if (!talk || !stored || !Number.isInteger(messageSeq) || messageSeq <= 0 || seen.has(talk.id)) continue;
    seen.add(talk.id);
    if (messageSeq > stored.lastOtherMessageSeq || messageSeq <= stored.lastReadMessageSeq) continue;
    stored.lastReadMessageSeq = messageSeq;
    changed = true;
  }
  return changed;
}

async function queueInitialSchedules(c: AppContext, playerId: string) {
  for (const schedule of workerScenario.initialSchedules) {
    await dependencies(c).store.queueScheduledEvent(
      playerId,
      schedule.id,
      schedule.eventId,
      schedule.fields,
      new Date(Date.now() + schedule.delayMs).toISOString()
    );
  }
}

async function opaqueScheduleId(id: string) {
  const input = new TextEncoder().encode(`xstoryphone:schedule:v1\0${workerScenario.project.id}\0${id}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return `s_${Array.from(digest.slice(0, 9), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function applyBrowserSchedules(
  state: StoredPlayerState,
  effects: readonly (
    | { type: "queue"; id: string; delayMs: number; eventId: string; fields: Record<string, string> }
    | { type: "cancel"; id: string }
  )[]
) {
  let events = state.browserScheduledEvents.map((event) => ({ ...event, fields: { ...event.fields } }));
  for (const effect of effects) {
    const scheduleId = await opaqueScheduleId(effect.id);
    events = events.filter((event) => event.scheduleId !== scheduleId);
    if (effect.type === "queue") {
      const eventId = workerScenario.publicIds.scenarioEvent[effect.eventId];
      if (!eventId) throw new Error(`未定義の予定イベントです: ${effect.eventId}`);
      events.push({
        scheduleId,
        eventId,
        fields: { ...effect.fields },
        dueAt: new Date(Date.now() + effect.delayMs).toISOString()
      });
    }
  }
  return { ...state, browserScheduledEvents: events.sort((left, right) => left.dueAt.localeCompare(right.dueAt)) };
}

async function withInitialBrowserSchedules(state: StoredPlayerState) {
  return applyBrowserSchedules(state, workerScenario.initialSchedules.map((schedule) => ({
    type: "queue" as const,
    id: schedule.id,
    delayMs: schedule.delayMs,
    eventId: schedule.eventId,
    fields: schedule.fields
  })));
}

function mergeTranscriptAppends(appends: readonly TranscriptUpdate[]) {
  const grouped = new Map<string, { streamId: string; transcriptKey: string; messages: Map<number, StoredTranscriptMessage> }>();
  for (const append of appends) {
    const key = `${append.streamId}\0${append.transcriptKey}`;
    const current = grouped.get(key);
    const target = current ?? {
      streamId: append.streamId,
      transcriptKey: append.transcriptKey,
      messages: new Map<number, StoredTranscriptMessage>()
    };
    for (const message of append.messages) {
      if (!target.messages.has(message.seq)) target.messages.set(message.seq, message);
    }
    grouped.set(key, target);
  }
  return [...grouped.values()].map((transcript) => ({
    streamId: transcript.streamId,
    transcriptKey: transcript.transcriptKey,
    messages: [...transcript.messages.values()].sort((left, right) => left.seq - right.seq)
  }));
}

async function materializeTranscriptUpdates(c: AppContext, player: PlayerRecord, appends: readonly TranscriptUpdate[]) {
  const updates: TranscriptUpdate[] = [];
  for (const append of mergeTranscriptAppends(appends)) {
    const current = await dependencies(c).store.loadTranscript(player.id, append.streamId, append.transcriptKey);
    const bySeq = new Map(current.messages.map((message) => [message.seq, message]));
    for (const message of append.messages) {
      if (!bySeq.has(message.seq)) bySeq.set(message.seq, message);
    }
    updates.push({
      streamId: append.streamId,
      transcriptKey: append.transcriptKey,
      messages: [...bySeq.values()].sort((left, right) => left.seq - right.seq)
    });
  }
  return updates;
}

async function commitPlayer(
  c: AppContext,
  player: PlayerRecord,
  requestedState: StoredPlayerState,
  transcriptAppends: readonly TranscriptUpdate[] = []
): Promise<{ ok: true; player: PlayerRecord } | { ok: false }> {
  const reconciled = reconcileScenarioState(requestedState, player.legacyTranscripts);
  const appends = mergeTranscriptAppends([
    ...(player.legacyTranscripts ?? []),
    ...transcriptAppends,
    ...reconciled.transcriptAppends
  ]);
  const stateChanged = JSON.stringify(reconciled.state) !== JSON.stringify(player.state);
  if (!stateChanged && !appends.length) {
    const { legacyTranscripts: _legacyTranscripts, ...current } = player;
    return { ok: true, player: { ...current, state: reconciled.state } };
  }
  if (browserMode()) {
    return {
      ok: true as const,
      player: {
        id: player.id,
        state: reconciled.state,
        stateVersion: player.stateVersion + 1,
        transcriptDeltas: appends
      }
    };
  }
  const updates = await materializeTranscriptUpdates(c, player, appends);
  if (!(await dependencies(c).store.savePlayer(player, reconciled.state, updates))) {
    return { ok: false as const };
  }
  return {
    ok: true as const,
    player: {
      id: player.id,
      state: reconciled.state,
      stateVersion: player.stateVersion + 1,
      transcriptDeltas: appends
    }
  };
}

async function resolvePlayer(c: AppContext, applyScheduledEvents = true) {
  if (browserMode()) {
    const token = c.req.header("x-xstoryphone-progress") ?? "";
    const player = await decodeBrowserProgress(browserStateSecret(c), workerScenario.project.id, token);
    if (!player) return null;
    const committed = await commitPlayer(c, player, player.state);
    if (!committed.ok) return null;
    return applyScheduledEvents ? applyDueScheduledEvents(c, committed.player) : committed.player;
  }
  const token = bearerToken(c.req.header("authorization"));
  if (!token) return null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const player = await dependencies(c).store.playerForSession(token);
    if (!player) return null;
    const committed = await commitPlayer(c, player, player.state);
    if (committed.ok) return applyScheduledEvents ? applyDueScheduledEvents(c, committed.player) : committed.player;
  }
  return null;
}

async function stateJson(c: AppContext, player: PlayerRecord, state = player.state, version = player.stateVersion) {
  if (browserMode()) {
    const generatedAudio = workerScenario.generatedAudio.map((definition) => ({
      id: definition.publicId,
      status: "idle" as const,
      requestedAt: null,
      completedAt: null,
      publicAudioUrl: null,
      fallbackAudioUrl: definition.staticUrl
    }));
    const wakeAt = state.browserScheduledEvents[0]?.dueAt ?? null;
    return {
      ...publicPlayerState(state, version, generatedAudio, wakeAt, player.transcriptDeltas ?? []),
      progressToken: await encodeBrowserProgress(browserStateSecret(c), workerScenario.project.id, workerScenario.revision, {
        id: player.id,
        state,
        stateVersion: version
      })
    };
  }
  const [generatedAudio, wakeAt] = await Promise.all([
    publicGeneratedAudioStates(dependencies(c).store, player.id),
    dependencies(c).store.nextScheduledWakeAt(player.id)
  ]);
  return publicPlayerState(state, version, generatedAudio, wakeAt, player.transcriptDeltas ?? []);
}

async function conflict(c: AppContext, player: PlayerRecord, applyScheduledEvents = true) {
  const current = await resolvePlayer(c, applyScheduledEvents);
  return c.json({
    ok: false,
    error: "conflict",
    playerState: await stateJson(c, current ?? player)
  }, 409);
}

async function applyHookResult(c: AppContext, playerId: string, state: StoredPlayerState, event: ScenarioHookEvent) {
  const llmProvider = workerScenario.features.llm ? createStructuredOutputProvider(dependencies(c).config.llm) ?? undefined : undefined;
  const result = await runScenarioHooks(state, event, { llmProvider });
  if (result.outcome?.kind === "form_error") return result;
  if (browserMode()) {
    result.state = await applyBrowserSchedules(result.state, result.scheduleEffects);
    return result;
  }
  for (const effect of result.generatedAudioEffects) {
    await prepareGeneratedAudio(dependencies(c).store, playerId, effect.id, effect.inputText);
  }
  for (const effect of result.scheduleEffects) {
    if (effect.type === "cancel") {
      await dependencies(c).store.cancelScheduledEvent(playerId, effect.id);
    } else {
      await dependencies(c).store.queueScheduledEvent(
        playerId,
        effect.id,
        effect.eventId,
        effect.fields,
        new Date(Date.now() + effect.delayMs).toISOString()
      );
    }
  }
  return result;
}

async function applyHooks(c: AppContext, playerId: string, state: StoredPlayerState, event: ScenarioHookEvent) {
  return applyHookResult(c, playerId, state, event);
}

function publicAllClear(outcome: { kind: "all_clear"; appId: string; contentId: string; autoplay: boolean } | null) {
  if (!outcome) return undefined;
  const content = contentByInternalId(outcome.contentId);
  return content
    ? { kind: "all_clear" as const, target: { appId: outcome.appId, contentId: content.publicId }, autoplay: outcome.autoplay }
    : undefined;
}

function clientScenarioEventAllowed(eventId: string) {
  return coreClientScenarioEvents.has(eventId) || workerScenario.clientCallableEvents.includes(eventId);
}

function formAvailable(formId: string, state: StoredPlayerState) {
  return workerScenario.contents.some((content) => {
    const form = content.record.form;
    return contentAvailable(content, state)
      && form !== null
      && typeof form === "object"
      && !Array.isArray(form)
      && (form as { id?: unknown }).id === formId;
  });
}

async function applyDueScheduledEvents(c: AppContext, initialPlayer: PlayerRecord) {
  if (browserMode()) {
    let player = initialPlayer;
    const now = new Date().toISOString();
    const due = player.state.browserScheduledEvents.filter((event) => event.dueAt <= now);
    for (const event of due) {
      const currentEvent = player.state.browserScheduledEvents
        .find((item) => item.scheduleId === event.scheduleId);
      if (!currentEvent) continue;
      try {
        const internalEventId = Object.entries(workerScenario.publicIds.scenarioEvent)
          .find(([, publicId]) => publicId === currentEvent.eventId)?.[0];
        if (!internalEventId) throw new Error(`予定イベントを解決できません: ${currentEvent.eventId}`);
        const nextState = copyStoredPlayerState(player.state);
        nextState.browserScheduledEvents = nextState.browserScheduledEvents
          .filter((item) => item.scheduleId !== currentEvent.scheduleId);
        const hookResult = await applyHooks(c, player.id, nextState, {
          event: "scenario_event",
          target: internalEventId,
          fields: { ...currentEvent.fields, scheduleId: currentEvent.scheduleId }
        });
        const committed = await commitPlayer(c, player, hookResult.state, hookResult.transcriptAppends);
        if (!committed.ok) throw new Error("browser_scheduled_event_conflict");
        player = {
          ...committed.player,
          transcriptDeltas: mergeTranscriptAppends([
            ...(player.transcriptDeltas ?? []),
            ...(committed.player.transcriptDeltas ?? [])
          ])
        };
      } catch (error) {
        console.error("[browser_scheduled_event]", error);
        throw new RetryableScheduledEventError(error);
      }
    }
    return player;
  }
  let player = initialPlayer;
  const due = await dependencies(c).store.dueScheduledEvents(player.id, new Date().toISOString());
  for (const event of due) {
    if (!(await dependencies(c).store.claimScheduledEvent(player.id, event.id))) continue;
    try {
      const hookResult = await applyHooks(c, player.id, player.state, {
        event: "scenario_event",
        target: event.eventId,
        fields: { ...event.fields, scheduleId: event.scheduleId }
      });
      const committed = await commitPlayer(c, player, hookResult.state, hookResult.transcriptAppends);
      if (!committed.ok) throw new Error("scheduled_event_conflict");
      player = {
        ...committed.player,
        transcriptDeltas: mergeTranscriptAppends([
          ...(player.transcriptDeltas ?? []),
          ...(committed.player.transcriptDeltas ?? [])
        ])
      };
      await dependencies(c).store.completeScheduledEvent(player.id, event.id);
    } catch (error) {
      try {
        await dependencies(c).store.requeueScheduledEvent(player.id, event.id);
      } catch (requeueError) {
        console.error("[scheduled_event:requeue]", requeueError);
      }
      console.error("[scheduled_event]", error);
      throw new RetryableScheduledEventError(error);
    }
  }
  return player;
}

export function createApp(appDependencies: AppDependencies) {
  const app = new Hono<ServerEnv>();
  app.use("*", async (c, next) => {
    c.set("dependencies", appDependencies);
    await next();
  });

  registerTalkBranchReviewRoutes(app);

app.onError((error, c) => {
  console.error("[worker]", error);
  if (error instanceof BrowserProgressTooLargeError) {
    return c.json({ ok: false, error: "browser_progress_too_large" }, 500);
  }
  if (error instanceof RetryableScheduledEventError) {
    return c.json({ ok: false, error: "scheduled_event_unavailable" }, 503);
  }
  return c.json({ ok: false, error: "server_error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, version: APP_VERSION, scenarioRevision: workerScenario.revision }));

app.get("/api/generated-audio/static/:id", (c) => {
  const definition = workerScenario.generatedAudio.find((audio) => audio.provider === "static" && audio.publicId === c.req.param("id"));
  if (!definition) return c.json({ ok: false, error: "not_found" }, 404);
  const sampleRate = 8_000;
  const sampleCount = 2_000;
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  return new Response(buffer, { headers: { "content-type": "audio/wav", "cache-control": "public, max-age=3600" } });
});

app.post("/api/session/start", async (c) => {
  if (browserMode()) {
    if (!browserStateSecret(c)) return c.json({ ok: false, error: "browser_state_secret_missing" }, 500);
    const initialState = await withInitialBrowserSchedules(createInitialPlayerState());
    const player: PlayerRecord = { id: crypto.randomUUID(), state: initialState, stateVersion: 0 };
    const reconciled = reconcileScenarioState(player.state);
    const hookResult = await applyHookResult(c, player.id, reconciled.state, {
      event: "session_started",
      target: "session_started"
    });
    const committed = await commitPlayer(c, player, hookResult.state, [
      ...reconciled.transcriptAppends,
      ...hookResult.transcriptAppends
    ]);
    if (!committed.ok) return c.json({ ok: false, error: "session_create_failed" }, 500);
    const playerState = await stateJson(c, committed.player);
    return c.json({
      ok: true,
      sessionToken: "progressToken" in playerState ? playerState.progressToken : "",
      playerState
    });
  }
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const serialCode = typeof body?.serialCode === "string" ? body.serialCode.replace(/\D/gu, "") : "";
  const hostname = new URL(c.req.url).hostname;
  const localDevelopment = !isProductionEnvironment(dependencies(c).config.appEnv)
    && (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1");
  const validCode = localDevelopment ? /^\d{4}(?:\d{4})?$/u.test(serialCode) : /^\d{8}$/u.test(serialCode);
  if (!validCode) {
    return c.json({ ok: false, error: "invalid" }, 400);
  }
  const created = await dependencies(c).store.createPasscodeSession(serialCode, createInitialPlayerState());
  if (created.created) {
    await queueInitialSchedules(c, created.playerId);
  }
  const player = await dependencies(c).store.playerForSession(created.sessionToken);
  if (!player) return c.json({ ok: false, error: "session_create_failed" }, 500);
  const reconciled = reconcileScenarioState(player.state, player.legacyTranscripts);
  const hookResult = await applyHookResult(c, player.id, reconciled.state, { event: "session_started", target: "session_started" });
  const committed = await commitPlayer(c, player, hookResult.state, [
    ...reconciled.transcriptAppends,
    ...hookResult.transcriptAppends
  ]);
  if (!committed.ok) return conflict(c, player);
  const sessionPlayer = committed.player;
  return c.json({ ok: true, sessionToken: created.sessionToken, playerState: await stateJson(c, sessionPlayer) });
});

app.get("/api/player-state", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, playerState: await stateJson(c, player) });
});

app.get("/api/transcript/:stream", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  if (browserMode()) return c.json({ ok: false, error: "not_available" }, 404);
  const requestedStream = cleanText(c.req.param("stream"), 180);
  const afterSeq = Math.max(0, Number.parseInt(c.req.query("after") ?? "0", 10) || 0);
  if (requestedStream === "search") {
    const transcript = await dependencies(c).store.loadTranscript(player.id, "search", player.state.searchTranscriptKey);
    return c.json({
      ok: true,
      delta: {
        kind: "search" as const,
        transcriptKey: transcript.transcriptKey,
        messages: transcript.messages.filter((message) => "role" in message && message.seq > afterSeq)
      }
    });
  }
  const talk = talkByPublicId(requestedStream);
  const progress = talk ? player.state.talks[talk.id] : null;
  if (!talk || !progress || !talkAvailable(talk, player.state)) {
    return c.json({ ok: false, error: "not_available" }, 404);
  }
  const transcript = await dependencies(c).store.loadTranscript(player.id, `talk:${talk.id}`, progress.transcriptKey);
  return c.json({
    ok: true,
    delta: {
      kind: talk.kind,
      talkId: talk.publicId,
      transcriptKey: transcript.transcriptKey,
      messages: transcript.messages
        .filter((message): message is StoredTalkMessage => "sender" in message && message.seq > afterSeq)
        .map(publicTalkMessage)
    }
  });
});

app.post("/api/reset-for-testing", async (c) => {
  if (!isResetForTestingAllowed(dependencies(c).config.appEnv, new URL(c.req.url).hostname)) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const nextState = browserMode()
    ? await withInitialBrowserSchedules(createInitialPlayerState())
    : createInitialPlayerState();
  const committed = await commitPlayer(c, player, nextState);
  if (!committed.ok) return conflict(c, player);
  if (!browserMode()) {
    await dependencies(c).store.clearPlayerRuntimeJobs(player.id);
    await queueInitialSchedules(c, player.id);
  }
  return c.json({ ok: true, playerState: await stateJson(c, committed.player) });
});

app.post("/api/search-agent/search", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const query = cleanText(body?.query, 500);
  const requestId = cleanText(body?.requestId, 120) || crypto.randomUUID();
  if (!query) return c.json({ ok: false, error: "invalid" }, 400);

  const searchTranscript = browserMode()
    ? { streamId: "search", transcriptKey: player.state.searchTranscriptKey, messages: [] }
    : await dependencies(c).store.loadTranscript(player.id, "search", player.state.searchTranscriptKey);
  const previousAssistant = searchTranscript.messages.find((message): message is StoredSearchAgentMessage =>
    "role" in message && message.requestId === requestId && message.role === "assistant"
  );
  if (previousAssistant) {
    return c.json({
      ok: true,
      matched: Boolean(previousAssistant.results?.length),
      body: previousAssistant.body,
      results: previousAssistant.results ?? [],
      playerState: await stateJson(c, player)
    });
  }

  const foundResults = searchScenario(query, player.state);
  const response = searchResponseFor(query, foundResults, player.state);
  const results = response.results;
  const sentAt = new Date().toISOString();
  const responseBody = response.body;
  const nextState = copyStoredPlayerState(player.state);
  const messages: StoredSearchAgentMessage[] = [
    {
      seq: nextState.searchLastMessageSeq + 1,
      id: `${requestId}:user`,
      requestId,
      role: "user" as const,
      body: query,
      sentAt
    },
    {
      seq: nextState.searchLastMessageSeq + 2,
      id: `${requestId}:assistant`,
      requestId,
      role: "assistant" as const,
      body: responseBody,
      results,
      sentAt
    }
  ];
  nextState.searchLastMessageSeq += messages.length;
  nextState.discoveredTargetKeys = unique([
    ...nextState.discoveredTargetKeys,
    ...results.filter((result) => result.repairable !== false).map((result) => `${result.appId}:${result.contentId}`)
  ]);
  const committed = await commitPlayer(c, player, nextState, [{
    streamId: "search",
    transcriptKey: nextState.searchTranscriptKey,
    messages
  }]);
  if (!committed.ok) return conflict(c, player);
  await dependencies(c).store.recordInputEvent({
    eventType: "search",
    playerId: player.id,
    requestKey: requestId,
    appId: "search-agent",
    userInput: query,
    status: "completed",
    matched: results.length > 0,
    responseSnapshot: { resultCount: results.length, responseId: response.responseId, suppressed: response.suppressed }
  }, dependencies(c).config.playerInputLogging === true).catch((error) => console.error("[player_input_events]", error));
  return c.json({
    ok: true,
    matched: results.length > 0,
    body: responseBody,
    results,
    playerState: await stateJson(c, committed.player)
  });
});

app.post("/api/content/opened", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const contentId = cleanText(body?.contentId, 160);
  const appId = cleanText(body?.appId, 64);
  const content = contentByPublicId(contentId);
  const contentParentUnavailable = content?.appId === appId && !appAvailable(appId, player.state);
  if (!contentId || !appId || contentParentUnavailable || !openTargetExists(contentId, appId, player.state)) {
    return c.json({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
  }

  let nextState = copyStoredPlayerState(player.state);
  syncTalkReadCursors(nextState, body);
  const target = repairTarget(contentId, appId);
  let repaired = false;
  const transcriptAppends: TranscriptUpdate[] = [];
  let internalTargetId = contentByPublicId(contentId)?.id ?? contentId;
  if (target?.kind === "app" && !nextState.repairedAppIds.includes(target.internalId)) {
    if (!repairTargetWasFound(player.state, contentId, appId)) {
      return c.json({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    }
    nextState.repairedAppIds = unique([...nextState.repairedAppIds, target.internalId]);
    internalTargetId = target.internalId;
    repaired = true;
  } else if (target?.kind === "content" && !nextState.repairedContentIds.includes(target.internalId)) {
    if (!repairTargetWasFound(player.state, contentId, appId)) {
      return c.json({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    }
    nextState.repairedContentIds = unique([...nextState.repairedContentIds, target.internalId]);
    internalTargetId = target.internalId;
    repaired = true;
  }
  if (repaired) {
    const hookResult = await applyHooks(c, player.id, nextState, { event: "content_repaired", target: internalTargetId });
    nextState = hookResult.state;
    transcriptAppends.push(...hookResult.transcriptAppends);
  }
  nextState.openedContentIds = unique([...nextState.openedContentIds, internalTargetId]);
  const openedHookResult = await applyHooks(c, player.id, nextState, { event: "content_opened", target: internalTargetId, fields: { appId } });
  nextState = openedHookResult.state;
  transcriptAppends.push(...openedHookResult.transcriptAppends);
  const cleared = new Set(notificationIdsForTarget(contentId, nextState));
  nextState.clearedNotificationIds = unique([...nextState.clearedNotificationIds, ...cleared]);
  const committed = await commitPlayer(c, player, nextState, transcriptAppends);
  if (!committed.ok) return conflict(c, player);
  return c.json({ ok: true, playerState: await stateJson(c, committed.player) });
});

app.post("/api/content/media-observed", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const publicContentId = cleanText(body?.contentId, 160);
  const appId = cleanText(body?.appId, 64);
  const content = contentByPublicId(publicContentId);
  if (!content || content.appId !== appId || !contentAvailable(content, player.state)) return c.json({ ok: false, error: "not_available" }, 409);
  const hookResult = await applyHooks(c, player.id, player.state, {
    event: "scenario_event",
    target: "content_media_observed",
    fields: { contentId: content.id, appId }
  });
  if (JSON.stringify(hookResult.state) === JSON.stringify(player.state) && !hookResult.transcriptAppends.length) {
    return c.json({ ok: true, playerState: await stateJson(c, player) });
  }
  const committed = await commitPlayer(c, player, hookResult.state, hookResult.transcriptAppends);
  if (!committed.ok) return conflict(c, player);
  return c.json({ ok: true, playerState: await stateJson(c, committed.player) });
});

app.post("/api/content/unlock", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const contentId = cleanText(body?.contentId, 160);
  const password = cleanText(body?.password, 100);
  const content = contentByPublicId(contentId);
  const expected = typeof content?.record.unlockCode === "string" ? content.record.unlockCode : "";
  const attachmentVisible = content
    && openTargetExists(content.publicId, content.appId, player.state)
    && player.state.revealedAttachmentContentIds.includes(content.id);
  if (!content || !attachmentVisible) {
    return c.json({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
  }
  if (!expected || password !== expected) return c.json({ ok: false, error: "invalid" }, 400);
  const nextState = copyStoredPlayerState(player.state);
  nextState.unlockedContentIds = unique([...nextState.unlockedContentIds, content.id]);
  const hookResult = await applyHooks(c, player.id, nextState, { event: "content_unlocked", target: content.id });
  const committed = await commitPlayer(c, player, hookResult.state, hookResult.transcriptAppends);
  if (!committed.ok) return conflict(c, player);
  return c.json({ ok: true, state: "unlocked", playerState: await stateJson(c, committed.player) });
});

app.post("/api/scenario/event", async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const eventId = cleanText(body?.eventId, 160);
  const deferScheduledEvents = completionScenarioEvents.has(eventId);
  const player = await resolvePlayer(c, !deferScheduledEvents);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  if (!eventId) return c.json({ ok: false, error: "invalid" }, 400);
  if (!clientScenarioEventAllowed(eventId)) return c.json({ ok: false, error: "event_not_callable" }, 403);
  const nestedFields = body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
    ? body.fields as Record<string, unknown>
    : {};
  const rootFields = Object.fromEntries(Object.entries(body ?? {}).filter(([key]) => key !== "eventId" && key !== "fields"));
  const fields = Object.fromEntries(Object.entries({ ...rootFields, ...nestedFields }).slice(0, 20)
    .map(([key, value]) => [cleanText(key, 80), cleanText(value, 500)])
    .filter(([key]) => key)
    .map(([key, value]) => [key, internalScenarioField(key, value)]));
  if (eventId === "incoming_call_completed" && fields.callId !== player.state.incomingCallId) {
    const current = deferScheduledEvents ? await applyDueScheduledEvents(c, player) : player;
    return c.json({ ok: true, playerState: await stateJson(c, current) });
  }
  const baseState = eventId === "incoming_call_completed"
    ? { ...copyStoredPlayerState(player.state), incomingCallId: null }
    : player.state;
  const hookResult = await applyHookResult(c, player.id, baseState, { event: "scenario_event", target: eventId, fields });
  const nextState = hookResult.state;
  if (hookResult.outcome?.kind === "form_error") {
    return c.json({ ok: false, error: hookResult.outcome.error, playerState: await stateJson(c, player) }, 422);
  }
  const allClear = hookResult.outcome?.kind === "all_clear" ? publicAllClear(hookResult.outcome) : undefined;
  const committed = await commitPlayer(c, player, nextState, hookResult.transcriptAppends);
  if (!committed.ok) return conflict(c, player, !deferScheduledEvents);
  let current = committed.player;
  if (deferScheduledEvents) current = await applyDueScheduledEvents(c, current);
  return c.json({
    ok: true,
    playerState: await stateJson(c, current),
    ...(allClear ? { allClear } : {})
  });
});

app.post("/api/message-link/open", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const publicTalkId = cleanText(body?.talkId, 160);
  const messageRef = cleanText(body?.messageRef, 200);
  const segmentIndex = typeof body?.segmentIndex === "number" ? body.segmentIndex : -1;
  const requestedLinkId = cleanText(body?.linkId, 240)
    || (messageRef && Number.isInteger(segmentIndex) && segmentIndex >= 0 ? `${messageRef}:link:${segmentIndex + 1}` : "");
  const talk = talkByPublicId(publicTalkId);
  const link = talk
    ? player.state.revealedMessageLinks.find((item) => item.id === requestedLinkId && item.talkId === talk.id)
    : null;
  if (!talk || !talkAvailable(talk, player.state) || !link) {
    return c.json({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
  }

  const app = appById(link.appId);
  const content = contentByInternalId(link.contentId);
  const targetTalk = talkByInternalId(link.contentId);
  const targetAppAvailable = Boolean(app && appAvailable(app.id, player.state));
  const targetContentAvailable = Boolean(content && content.appId === link.appId && contentAvailable(content, player.state));
  const targetTalkAvailable = Boolean(targetTalk && targetTalk.appId === link.appId && talkAvailable(targetTalk, player.state));
  if (!targetAppAvailable || (!targetContentAvailable && !targetTalkAvailable)) {
    return c.json({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
  }

  let nextState = player.state;
  let stateChanged = false;
  let transcriptAppends: TranscriptUpdate[] = [];
  if (link.actionId) {
    const hookResult = await applyHooks(c, player.id, nextState, {
      event: "scenario_event",
      target: "message_link_opened",
      fields: {
        actionId: link.actionId,
        talkId: talk.id,
        linkId: link.id
      }
    });
    nextState = hookResult.state;
    transcriptAppends = hookResult.transcriptAppends;
    stateChanged = JSON.stringify(nextState) !== JSON.stringify(player.state);
  }
  const committed = stateChanged || transcriptAppends.length
    ? await commitPlayer(c, player, nextState, transcriptAppends)
    : { ok: true as const, player };
  if (!committed.ok) return conflict(c, player);
  const targetContentId = content?.publicId ?? targetTalk?.publicId ?? link.contentId;
  return c.json({
    ok: true,
    target: { appId: link.appId, contentId: targetContentId },
    playerState: await stateJson(c, committed.player)
  });
});

app.post("/api/talk/send", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const publicTalkId = cleanText(body?.talkId, 160);
  const message = internalizeTalkCommand(cleanText(body?.message, 1_000));
  const turnKey = cleanText(body?.turnKey, 160);
  const talk = talkByPublicId(publicTalkId);
  if (!talk || !talkCanPost(talk, player.state) || !message || !turnKey) return c.json({ ok: false, error: "invalid" }, 400);
  const storedTalk = player.state.talks[talk.id];
  if (!storedTalk || storedTalk.turnKey !== turnKey) {
    const readState = copyStoredPlayerState(player.state);
    if (syncTalkReadCursors(readState, body)) {
      const committed = await commitPlayer(c, player, readState);
      if (!committed.ok) return conflict(c, player);
      return c.json({ ok: true, stale: true, playerState: await stateJson(c, committed.player) });
    }
    return c.json({ ok: true, stale: true, playerState: await stateJson(c, player) });
  }
  if (!talkCommandAvailable(message, player.state)) return c.json({ ok: false, error: "invalid_attachment" }, 400);

  const fromId = storedTalk.from;
  const selection = await resolveScenarioTalkRule({
    env: dependencies(c).config.llm,
    llmEnabled: workerScenario.features.llm,
    talk,
    from: fromId,
    playerInput: message,
    semanticPlayerInput: semanticInputForTalkCommand(message),
    stateValues: effectiveStateValues(workerScenario.stateVariables, player.state.stateValues)
  });
  if (!selection.ok) {
    const error = selection.error.startsWith("provider_") ? "llm_unavailable" : selection.error;
    return c.json({ ok: false, error, retryable: true }, 503);
  }

  const now = new Date().toISOString();
  const nextState = copyStoredPlayerState(player.state);
  syncTalkReadCursors(nextState, body);
  const nextTalk = nextState.talks[talk.id];
  const nextFrom = selection.rule.mode === "stay" || selection.rule.mode === "game_over"
    ? fromId
    : selection.rule.nextBlocks[selection.rule.nextBlocks.length - 1] ?? fromId;
  nextState.stateValues = applyCompactStateAssignments(
    workerScenario.stateVariables,
    nextState.stateValues,
    selection.rule.set,
    selection.matchGroups
  );
  nextTalk.from = nextFrom;
  nextTalk.turnKey = crypto.randomUUID();

  const ownerMessage: StoredTalkMessage = {
    seq: nextTalk.lastMessageSeq + 1,
    id: `${talk.publicId}_${turnKey}:owner`,
    talkId: talk.publicId,
    sender: "owner" as const,
    body: message,
    ...(talk.kind === "chat" ? { senderName: "あなた" } : {}),
    attachment: null,
    sentAt: now
  };

  const reply = messagesForTalkBlocks({
    talk,
    blockIds: selection.rule.nextBlocks,
    previousCounts: nextTalk.blockDisplayCounts,
    formatEnv: {
      ...effectiveStateValues(workerScenario.stateVariables, nextState.stateValues),
      ...selection.matchGroups
    },
    baseSentAt: new Date(Date.parse(now) + 1_000).toISOString(),
    idPrefix: `${talk.publicId}_${turnKey}`,
    startSeq: ownerMessage.seq,
    useRepeat: selection.rule.mode !== "game_over"
  });
  let talkTranscriptAppends: TranscriptUpdate[] = [];
  if (selection.rule.mode !== "game_over") {
    nextTalk.blockDisplayCounts = reply.blockDisplayCounts;
    const messages = [ownerMessage, ...reply.messages];
    nextTalk.lastMessageSeq = Math.max(nextTalk.lastMessageSeq, ...messages.map((item) => item.seq));
    nextTalk.lastOtherMessageSeq = Math.max(
      nextTalk.lastOtherMessageSeq,
      ...messages.filter((item) => item.sender === "other").map((item) => item.seq)
    );
    const revealed = revealTalkMessages(nextState, talk.id, messages);
    nextState.revealedAttachmentContentIds = revealed.revealedAttachmentContentIds;
    nextState.revealedMessageLinks = revealed.revealedMessageLinks;
    talkTranscriptAppends = [{
      streamId: `talk:${talk.id}`,
      transcriptKey: nextTalk.transcriptKey,
      messages
    }];
  }

  const talkHookResult = await applyHookResult(c, player.id, nextState, {
    event: "talk_sent",
    target: talk.id,
    playerInput: message,
    ruleId: selection.rule.id
  });
  const hookedState = talkHookResult.state;
  if (talkHookResult.outcome?.kind === "form_error") {
    return c.json({ ok: false, error: talkHookResult.outcome.error, playerState: await stateJson(c, player) }, 422);
  }
  const allClear = talkHookResult.outcome?.kind === "all_clear" ? publicAllClear(talkHookResult.outcome) : undefined;
  const committed = await commitPlayer(c, player, hookedState, [
    ...talkTranscriptAppends,
    ...talkHookResult.transcriptAppends
  ]);
  if (!committed.ok) return conflict(c, player);
  await dependencies(c).store.recordInputEvent({
    eventType: "talk_send",
    playerId: player.id,
    requestKey: turnKey,
    appId: talk.appId,
    talkId: talk.id,
    fromId,
    userInput: message,
    status: "completed",
    matched: selection.source !== "default",
    ruleId: selection.rule.id,
    nextFromId: nextFrom,
    responseSnapshot: {
      source: selection.source,
      match: selection.matchGroups,
      nextBlocks: selection.rule.nextBlocks,
      messages: reply.messages.map((item) => ({ sender: item.sender, body: item.body }))
    }
  }, dependencies(c).config.playerInputLogging === true).catch((error) => console.error("[player_input_events]", error));
  if (selection.rule.mode === "game_over") {
    const gameOverMessages = [ownerMessage, ...reply.messages].map((item) => ({
      ...publicTalkMessage(item),
      kind: talk.kind,
      senderName: talk.kind === "chat" ? item.senderName ?? null : null
    }));
    return c.json({
      ok: true,
      playerState: await stateJson(c, committed.player),
      gameOver: {
        talkId: talk.publicId,
        kind: talk.kind,
        reasonMessage: "この選択では物語を続けられませんでした。",
        messages: gameOverMessages
      },
      ...(allClear ? { allClear } : {})
    });
  }
  return c.json({
    ok: true,
    playerState: await stateJson(c, committed.player),
    ...(allClear ? { allClear } : {})
  });
});

app.post("/api/form/submit", async (c) => {
  const player = await resolvePlayer(c);
  if (!player) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const formId = cleanText(body?.formId, 160);
  if (!formId) return c.json({ ok: false, error: "invalid" }, 400);
  if (!formAvailable(formId, player.state)) {
    return c.json({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
  }
  const fields = body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
    ? Object.fromEntries(Object.entries(body.fields as Record<string, unknown>)
      .slice(0, 20)
      .map(([key, value]) => [cleanText(key, 80), cleanText(value, 2_000)])
      .filter(([key]) => key))
    : {};
  const hookResult = await applyHookResult(c, player.id, player.state, {
    event: "scenario_event",
    target: formId,
    fields
  });
  const nextState = hookResult.state;
  if (hookResult.outcome?.kind === "form_error") {
    return c.json({ ok: false, error: hookResult.outcome.error, playerState: await stateJson(c, player) }, 422);
  }
  const gameOver = hookResult.outcome?.kind === "game_over"
    ? { kind: "form" as const, ...(hookResult.outcome.reasonMessage ? { reasonMessage: hookResult.outcome.reasonMessage } : {}) }
    : undefined;
  if (JSON.stringify(nextState) === JSON.stringify(player.state)) {
    return c.json({ ok: true, playerState: await stateJson(c, player), ...(gameOver ? { gameOver } : {}) });
  }
  const committed = await commitPlayer(c, player, nextState, hookResult.transcriptAppends);
  if (!committed.ok) return conflict(c, player);
  return c.json({
    ok: true,
    playerState: await stateJson(c, committed.player),
    ...(gameOver ? { gameOver } : {})
  });
});

registerProjectRoutes(app);

  return app;
}
