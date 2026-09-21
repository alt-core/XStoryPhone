import { isAppId } from "../shared/appRegistry.ts";
import { definedConditionState, evaluateCondition } from "../shared/condition.ts";
import { normalizeAnswer } from "../shared/talkCriteria.ts";
import type { ScenarioEventPayload } from "../shared/hooks.ts";
import type { PublicPresentationMessageSegment, PublicPresentationPayload, PublicPresentationTalkMessage } from "../shared/presentation.ts";
import type { StoredTalkMessage } from "../shared/scenario.ts";
import { SEARCH_AGENT_STREAM_ID, SEARCH_AGENT_TALK_ID } from "../shared/searchAgent.ts";
import type { AppDependencies, InitialScheduledEvent, PlayerRecord, StoredPlayerState, StoredSearchAgentEvent, StoredTalkEvent, StoredTranscriptMessage, TranscriptAppend } from "./store.ts";
import { copyStoredPlayerState, sha256 } from "./store.ts";
import { createStructuredOutputProvider } from "../worker/providers/structuredOutput.ts";
import { hookLlmModelVersion, hookLlmRequestHashes, HookLlmUnavailableError, resolveHookLlmRequest, type HookLlmRequest } from "../worker/services/hookLlm.ts";
import type { ScenarioRuntime } from "../worker/scenarioRuntime.ts";
import type { GeneratedAudioRuntime } from "../worker/services/generatedAudioRuntime.ts";
import type { createScenarioHooksRuntime, ScenarioHookResult } from "../worker/services/scenarioHooksRuntime.ts";
import { createTalkCommandRuntime } from "../worker/services/talkCommandRuntime.ts";
import { resolveScenarioTalkRule } from "../worker/services/talkResolver.ts";
import { createTalkContextRuntime } from "../worker/services/talkContextRuntime.ts";
import { evaluateTalkOutputSteps, talkOutputMatchEnv } from "../worker/services/talkOutput.ts";
import { latestTalkDeliveredAt, nextTalkMessageSentAt } from "../worker/talkMessageClock.ts";
import { applyCompactStateAssignments, effectiveStateValues } from "../worker/stateValues.ts";
import { BrowserProgressTooLargeError, decodeBrowserProgress, encodeBrowserProgress } from "./browserProgress.ts";
import { accessCodeCheckDigits } from "./accessCode.ts";
import { isProductionEnvironment, isResetForTestingAllowed } from "./environment.ts";
import { isCompletionScenarioEvent, isCoreClientScenarioEvent } from "../shared/scenarioHookEvents.ts";
import type { LocalPlayerProgress } from "./localProgress.ts";
import { StaticResourceError } from "../shared/staticAnswer.ts";
import type { PartSession } from "../worker/partSession.ts";
export type PlayerOperationInput = {
  hostname: string;
  authorization?: string;
  body: Record<string, unknown> | null;
  params?: Record<string, string>;
  query?: Record<string, string>;
};
export type PlayerOperationResult = { status: number; payload: Record<string, unknown>; };
type PlayerOperationContext = PlayerOperationInput & {
  dependencies: Omit<AppDependencies, "store"> & { store?: AppDependencies["store"]; };
  committedPlayer?: PlayerRecord;
  committedProgressToken?: string;
};
function operationResult(payload: Record<string, unknown>, status = 200): PlayerOperationResult { return { payload, status }; }
// 定義はこの実行単位に閉じ込め、別プレイヤーの処理と共有変更しない。
export function createPlayerOperations(runtime: ScenarioRuntime, hooks: ReturnType<typeof createScenarioHooksRuntime>, audio: GeneratedAudioRuntime | undefined, localProgress?: LocalPlayerProgress, parts?: PartSession) {
  const { talkFlowRecentMessages } = createTalkContextRuntime(runtime);
  const {
    appById,
    appAvailable,
    contentAvailable,
    contentByInternalId,
    contentByPublicId,
    createInitialPlayerState,
    internalAttachmentId,
    internalFormId,
    internalIncomingCallId,
    lockedContentPassword,
    messagesForTalkOutputSteps,
    nextTalkTurnKey,
    notificationIdsForTarget,
    observedAlbumMediaContentIds,
    openTargetExists,
    publicSearchAgentTimelineItems,
    publicTalkMessage,
    radioAudioCueForEvent,
    reconcileScenarioState,
    revealTalkMessages,
    repairTarget,
    restoredTalkHistoryMessages,
    searchScenario,
    searchAgentTimelineForOutputs,
    isDeviceTalk,
    isSearchAgentTalk,
    synchronizeInitialTalkLastOtherMessageId,
    talkAvailable,
    talkCanPost,
    talkTurnHash,
    talkByPublicId,
    talkByInternalId,
    visibleTalkMessagesForState,
    visibleIncomingCallId,
  } = runtime;
  const { runScenarioHooks } = hooks;
  const { internalizeTalkCommand, semanticInputForTalkCommand, talkCommandAvailable } = createTalkCommandRuntime(runtime);
  const { searchAgentPlayerMessageEvent } = runtime.talkEvents;
  function dependencies(c: PlayerOperationContext) {
    return c.dependencies;
  }
  function storeFor(c: PlayerOperationContext) {
    const store = c.dependencies.store;
    if (!store) throw new Error("この操作にはサーバー保存が必要です。");
    return store;
  }
  function clientProgressMode() {
    return runtime.workerScenario.playerMode !== "server";
  }
  class PlayerNotStartedError extends Error { }
  function browserStateSecret(c: PlayerOperationContext) {
    const configured = dependencies(c).config.browserStateSecret?.trim();
    if (configured)
      return configured;
    const hostname = c.hostname;
    const localRequest = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
    const appEnv = dependencies(c).config.appEnv;
    return localRequest && !isProductionEnvironment(appEnv)
      ? "xstoryphone-local-browser-state"
      : "";
  }
  async function cleanupHookLlmCache(c: PlayerOperationContext) {
    if (clientProgressMode())
      return;
    const store = storeFor(c);
    const cleanup = store.cleanupExpiredHookLlmResults;
    if (!cleanup)
      return;
    try {
      await cleanup.call(store, new Date().toISOString(), 100);
    }
    catch (error) {
      console.error("[hook_llm_cache:cleanup]", error);
    }
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
  async function browserProgressToken(c: PlayerOperationContext) {
    const body = c.body;
    return typeof body?.progressToken === "string" ? body.progressToken : "";
  }
  function cleanText(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.normalize("NFC").trim().slice(0, maxLength) : "";
  }
  function cleanScenarioField(value: unknown, maxLength: number) {
    if (typeof value === "number" && Number.isFinite(value))
      return String(value).slice(0, maxLength);
    if (typeof value === "boolean")
      return String(value);
    return cleanText(value, maxLength);
  }
  function internalScenarioField(key: string, value: string) {
    if (key === "contentId")
      return contentByPublicId(value)?.id ?? value;
    if (key === "talkId")
      return talkByPublicId(value)?.id ?? value;
    if (key === "attachmentId")
      return internalAttachmentId(value) || value;
    if (key === "callId")
      return internalIncomingCallId(value) || value;
    if (key === "formId")
      return internalFormId(value) || value;
    return value;
  }
  function unique(items: readonly string[]) {
    return [...new Set(items)];
  }
  function requestedMediaContentIds(body: Record<string, unknown> | null) {
    return Array.isArray(body?.mediaContentIds)
      ? body.mediaContentIds.slice(0, 100).map((item) => cleanText(item, 160)).filter(Boolean)
      : [];
  }
  function repairTargetWasFound(state: StoredPlayerState, contentId: string, appId: string) {
    return state.discoveredTargetKeys.includes(`${appId}:${contentId}`);
  }
  async function syncTalkReadCursors(c: PlayerOperationContext, player: PlayerRecord, state: StoredPlayerState, body: Record<string, unknown> | null) {
    if (!Array.isArray(body?.talkReadCursors))
      return false;
    let changed = false;
    const seen = new Set<string>();
    for (const item of body.talkReadCursors.slice(0, 20)) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        continue;
      const talkId = cleanText((item as Record<string, unknown>).talkId, 160);
      const messageId = cleanText((item as Record<string, unknown>).messageId, 240);
      const talk = talkByPublicId(talkId);
      const stored = talk ? state.talks[talk.id] : null;
      if (!talk || isSearchAgentTalk(talk) || !stored || !messageId || seen.has(talk.id))
        continue;
      seen.add(talk.id);
      const transcript = clientProgressMode()
        ? null
        : await storeFor(c).loadTranscript(player.id, `talk:${talk.id}`, stored.transcriptKey);
      const events = transcript
        ? transcript.messages.filter((message): message is StoredTalkEvent => "event_type" in message)
        : [];
      const otherMessageIds = visibleTalkMessagesForState(talk, state, events)
        .filter((message) => message.sender === "other")
        .map((message) => message.id);
      if (!otherMessageIds.includes(messageId) && messageId !== stored.lastOtherMessageId)
        continue;
      const currentId = state.talkReadCursors[talk.id] ?? "";
      const currentIndex = currentId ? otherMessageIds.indexOf(currentId) : -1;
      const requestedIndex = otherMessageIds.indexOf(messageId);
      if (requestedIndex >= 0 && requestedIndex < currentIndex)
        continue;
      if (currentId === messageId)
        continue;
      state.talkReadCursors[talk.id] = messageId;
      changed = true;
    }
    return changed;
  }
  function cleanRecentMessages(value: unknown) {
    if (!Array.isArray(value))
      return [];
    return value.slice(-4).flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return [];
      const record = item as Record<string, unknown>;
      const speaker = cleanText(record.speaker, 40) || "other";
      const messageBody = cleanText(record.body, 500);
      return messageBody ? [{ speaker, body: messageBody }] : [];
    });
  }
  async function recentMessagesForTalk(c: PlayerOperationContext, player: PlayerRecord, talkId: string, transcriptKey: string, clientValue: unknown) {
    const talk = runtime.workerScenario.talks.find((item) => item.id === talkId);
    if (!talk)
      return [];
    const withFromContext = (recent: readonly {
      speaker: string;
      body: string;
    }[]) => talkFlowRecentMessages(talk, player.state.talks[talkId]?.from ?? "", effectiveStateValues(runtime.workerScenario.stateVariables, player.state.stateValues), recent);
    if (clientProgressMode())
      return withFromContext(cleanRecentMessages(clientValue));
    const transcript = await storeFor(c).loadTranscript(player.id, `talk:${talkId}`, transcriptKey);
    if (isSearchAgentTalk(talk)) {
      const timeline = publicSearchAgentTimelineItems(transcript.messages.filter((message): message is StoredSearchAgentEvent => message.kind === "search_agent"), talk.publicId).slice(-4);
      return withFromContext(timeline.map((item) => {
        const body = item.kind === "message"
          ? item.body
          : item.results.length
            ? `検索結果: ${item.results.map((result) => result.title || result.contentId).join("、")}`
            : "検索結果: 該当なし";
        return {
          speaker: item.kind === "message" && item.sender === "owner" ? "player" : talk.label,
          body: cleanText(body, 500)
        };
      }));
    }
    return withFromContext(visibleTalkMessagesForState(talk, player.state, transcript.messages.filter((message): message is StoredTalkEvent => "event_type" in message)).filter((message) => message.body).slice(-2).map((message) => ({
      speaker: message.sender === "owner" ? "player" : message.senderName || talk.label || "other",
      body: message.body
    })));
  }
  function initialScheduledEvents(now = Date.now()): InitialScheduledEvent[] {
    return runtime.workerScenario.initialSchedules.map((schedule) => ({
      id: schedule.id,
      eventId: schedule.eventId,
      fields: schedule.fields,
      dueAt: new Date(now + schedule.delayMs).toISOString()
    }));
  }
  async function opaqueScheduleId(id: string) {
    const input = new TextEncoder().encode(`xstoryphone:schedule:v1\0${runtime.workerScenario.project.id}\0${id}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    return `s_${Array.from(digest.slice(0, 9), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  async function applyBrowserSchedules(state: StoredPlayerState, effects: readonly ({
    type: "queue";
    id: string;
    delayMs: number;
    eventId: string;
    fields: Record<string, string>;
  } | {
    type: "cancel";
    id: string;
  })[]) {
    let events = state.browserScheduledEvents.map((event) => ({ ...event, fields: { ...event.fields } }));
    for (const effect of effects) {
      const scheduleId = await opaqueScheduleId(effect.id);
      events = events.filter((event) => event.scheduleId !== scheduleId);
      if (effect.type === "queue") {
        const eventId = runtime.workerScenario.publicIds.scenarioEvent[effect.eventId];
        if (!eventId)
          throw new Error(`未定義の予定イベントです: ${effect.eventId}`);
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
    return applyBrowserSchedules(state, runtime.workerScenario.initialSchedules.map((schedule) => ({
      type: "queue" as const,
      id: schedule.id,
      delayMs: schedule.delayMs,
      eventId: schedule.eventId,
      fields: schedule.fields
    })));
  }
  function mergeTranscriptAppends(appends: readonly TranscriptAppend[]) {
    const grouped = new Map<string, {
      streamId: string;
      transcriptKey: string;
      messages: Map<string, StoredTranscriptMessage>;
      resolvedMessages: Map<number, StoredTalkMessage>;
    }>();
    for (const append of appends) {
      const key = `${append.streamId}\0${append.transcriptKey}`;
      const current = grouped.get(key);
      const target = current ?? {
        streamId: append.streamId,
        transcriptKey: append.transcriptKey,
        messages: new Map<string, StoredTranscriptMessage>(),
        resolvedMessages: new Map<number, StoredTalkMessage>()
      };
      for (const message of append.messages) {
        const messageKey = `event:${message.id}`;
        if (!target.messages.has(messageKey))
          target.messages.set(messageKey, message);
      }
      for (const message of append.resolvedMessages ?? []) {
        if (!target.resolvedMessages.has(message.seq))
          target.resolvedMessages.set(message.seq, message);
      }
      grouped.set(key, target);
    }
    return [...grouped.values()].map((transcript) => ({
      streamId: transcript.streamId,
      transcriptKey: transcript.transcriptKey,
      messages: [...transcript.messages.values()].sort((left, right) => left.kind === "search_agent" && right.kind === "search_agent"
        ? left.seq - right.seq
        : left.delivered_at.localeCompare(right.delivered_at) || left.id.localeCompare(right.id)),
      ...(transcript.resolvedMessages.size
        ? { resolvedMessages: [...transcript.resolvedMessages.values()].sort((left, right) => left.seq - right.seq) }
        : {})
    }));
  }
  function assertBrowserTalkAppendsRemainAvailable(state: StoredPlayerState, appends: readonly TranscriptAppend[]) {
    if (!clientProgressMode())
      return;
    for (const append of appends) {
      if (!append.streamId.startsWith("talk:"))
        continue;
      const talkId = append.streamId.slice("talk:".length);
      const talk = talkByInternalId(talkId);
      if (!talk || !talkAvailable(talk, state)) {
        throw new Error(`browserモードでは発話を追加した同じ更新でtalkを非表示にできません: ${talkId}`);
      }
    }
  }
  function assertUniqueHookEffectResources(hookResults: readonly ScenarioHookResult[]) {
    const resources = new Set<string>();
    const claim = (kind: "schedule" | "generated_audio", id: string) => {
      const key = `${kind}:${id}`;
      if (resources.has(key)) {
        throw new Error(`同一commitで同じ${kind === "schedule" ? "schedule instance" : "generated audio"}を複数回操作できません: ${id}`);
      }
      resources.add(key);
    };
    for (const result of hookResults) {
      for (const effect of result.scheduleEffects)
        claim("schedule", effect.id);
      for (const effect of result.generatedAudioEffects)
        claim("generated_audio", effect.id);
    }
  }
  async function commitPlayer(c: PlayerOperationContext, player: PlayerRecord, mutation: {
    state: StoredPlayerState;
    transcriptAppends?: readonly TranscriptAppend[];
    hookResults?: readonly ScenarioHookResult[];
    initialSchedules?: readonly InitialScheduledEvent[];
    initialize?: boolean;
  }): Promise<{
    ok: true;
    player: PlayerRecord;
  } | {
    ok: false;
  }> {
    const { state: requestedState, transcriptAppends = [], hookResults = [] } = mutation;
    await parts?.restore(requestedState);
    assertUniqueHookEffectResources(hookResults);
    const reconciled = await reconcileScenarioState(requestedState, player.id);
    runtime.validatePartState(reconciled.state);
    const appends = mergeTranscriptAppends([
      ...transcriptAppends,
      ...reconciled.transcriptAppends
    ]);
    const responseAppends = mergeTranscriptAppends([
      ...(player.transcriptDeltas ?? []),
      ...appends
    ]);
    assertBrowserTalkAppendsRemainAvailable(reconciled.state, responseAppends);
    const stateChanged = JSON.stringify(reconciled.state) !== JSON.stringify(player.state);
    const scheduleEffects = hookResults.flatMap((result) => result.scheduleEffects);
    const generatedAudioEffects = hookResults.flatMap((result) => result.generatedAudioEffects);
    if (!mutation.initialize && !stateChanged && !appends.length && !scheduleEffects.length && !generatedAudioEffects.length && !mutation.initialSchedules?.length) {
      const unchanged = { ...player, state: reconciled.state };
      await localProgress?.commit(unchanged);
      return { ok: true, player: unchanged };
    }
    if (clientProgressMode()) {
      const next = {
        id: player.id, state: reconciled.state, stateVersion: player.stateVersion + 1, transcriptDeltas: responseAppends
      };
      // browserで返せない候補は確定候補へ採らず、直前に確定した予約等を維持する。
      const token = localProgress ? undefined : await encodeBrowserProgress(browserStateSecret(c), runtime.workerScenario.project.id, next);
      await localProgress?.commit(next);
      c.committedPlayer = next;
      c.committedProgressToken = token;
      return {
        ok: true as const,
        player: next
      };
    }
    const generatedAudioJobs = (await Promise.all(generatedAudioEffects.map((effect) => (audio!.createGeneratedAudioIntent(storeFor(c), player.id, effect.id, effect.inputText))))).filter((job): job is NonNullable<typeof job> => Boolean(job));
    const storedEffects = {
      schedules: [...new Map([...(mutation.initialSchedules ?? []).map(schedule => ({ type: "queue" as const, ...schedule })), ...scheduleEffects.map((effect) => effect.type === "cancel"
        ? { type: "cancel" as const, id: effect.id }
        : {
          type: "queue" as const,
          id: effect.id,
          eventId: effect.eventId,
          fields: effect.fields,
          dueAt: new Date(Date.now() + effect.delayMs).toISOString()
        })].map(effect => [effect.id, effect])).values()],
      generatedAudioJobs
    };
    if (!(await storeFor(c).savePlayer(player, reconciled.state, appends, storedEffects))) {
      return { ok: false as const };
    }
    for (const job of generatedAudioJobs) {
      try {
        await audio!.dispatchGeneratedAudioIntent(storeFor(c), player.id, job);
      }
      catch (error) {
        console.error("[generated_audio:dispatch]", { audioId: job.audioId, error: error instanceof Error ? error.name : "unknown" });
      }
    }
    return {
      ok: true as const,
      player: {
        id: player.id,
        state: reconciled.state,
        stateVersion: player.stateVersion + 1,
        transcriptDeltas: responseAppends
      }
    };
  }
  async function resolvePlayer(c: PlayerOperationContext, applyScheduledEvents = true) {
    if (clientProgressMode()) {
      const player = localProgress ? localProgress.read()
        : await decodeBrowserProgress(browserStateSecret(c), runtime.workerScenario.project.id, await browserProgressToken(c));
      if (!player)
        return null;
      await parts?.restore(player.state);
      const committed = await commitPlayer(c, player, { state: player.state });
      if (!committed.ok)
        return null;
      return applyScheduledEvents ? applyDueScheduledEvents(c, committed.player) : committed.player;
    }
    const token = bearerToken(c.authorization);
    if (!token)
      return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const player = await storeFor(c).playerForSession(token);
      if (!player)
        return null;
      if (!player.state || player.resetting) throw new PlayerNotStartedError();
      const active: PlayerRecord = { ...player, state: player.state };
      await parts?.restore(player.state);
      const committed = await commitPlayer(c, active, { state: player.state });
      if (committed.ok)
        return applyScheduledEvents ? applyDueScheduledEvents(c, committed.player) : committed.player;
    }
    return null;
  }
  async function resolveMutationPlayer(c: PlayerOperationContext) {
    const player = await resolvePlayer(c, false);
    if (!player)
      return null;
    return applyDueScheduledEventsResult(c, player);
  }
  async function stateJson(c: PlayerOperationContext, player: PlayerRecord, state = player.state, version = player.stateVersion) {
    const projection = parts ? await parts.runtimeFor(state) : runtime;
    if (clientProgressMode()) {
      const generatedAudio = projection.workerScenario.generatedAudio.map((definition) => ({
        id: definition.publicId,
        status: "idle" as const,
        requestedAt: null,
        completedAt: null,
        publicAudioUrl: null,
        fallbackAudioUrl: definition.staticUrl
      }));
      const wakeAt = state.browserScheduledEvents[0]?.dueAt ?? null;
      if (localProgress) {
        return projection.publicPlayerState(state, version, generatedAudio, wakeAt, player.transcriptDeltas ?? []);
      }
      return {
        ...await projection.publicPlayerState(state, version, generatedAudio, wakeAt, player.transcriptDeltas ?? []),
        progressToken: c.committedPlayer === player && state === player.state && version === player.stateVersion && c.committedProgressToken
          ? c.committedProgressToken : await encodeBrowserProgress(browserStateSecret(c), runtime.workerScenario.project.id, {
            id: player.id,
            state,
            stateVersion: version
          })
      };
    }
    const [generatedAudio, wakeAt] = await Promise.all([
      audio!.publicGeneratedAudioStates(storeFor(c), player.id, projection.workerScenario.generatedAudio),
      storeFor(c).nextScheduledWakeAt(player.id)
    ]);
    return projection.publicPlayerState(state, version, generatedAudio, wakeAt, player.transcriptDeltas ?? []);
  }
  async function conflict(c: PlayerOperationContext, player: PlayerRecord, applyScheduledEvents = true) {
    const current = await resolvePlayer(c, applyScheduledEvents);
    return operationResult({
      ok: false,
      error: "conflict",
      playerState: await stateJson(c, current ?? player)
    }, 409);
  }
  function hookMessageBaseSentAtByTalk(appends: readonly TranscriptAppend[]) {
    const latestByTalk = new Map<string, number>();
    for (const append of appends) {
      if (!append.streamId.startsWith("talk:"))
        continue;
      const talkId = append.streamId.slice("talk:".length);
      const timestamps = [
        ...append.messages.flatMap((message) => "event_type" in message ? [Date.parse(message.delivered_at)] : []),
        ...(append.resolvedMessages ?? []).map((message) => Date.parse(message.sentAt))
      ].filter(Number.isFinite);
      if (!timestamps.length)
        continue;
      latestByTalk.set(talkId, Math.max(latestByTalk.get(talkId) ?? 0, ...timestamps));
    }
    return Object.fromEntries([...latestByTalk].map(([talkId, timestamp]) => [talkId, new Date(timestamp + 1).toISOString()]));
  }
  async function applyHookResult(c: PlayerOperationContext, playerId: string, state: StoredPlayerState, event: ScenarioEventPayload, options: {
    precedingTranscriptAppends?: readonly TranscriptAppend[];
  } = {}) {
    const llmEnv = dependencies(c).config.llm;
    const llmProvider = runtime.workerScenario.features.llm ? createStructuredOutputProvider(llmEnv) : null;
    const resolveLlm = async (canonicalKey: string, request: HookLlmRequest) => {
      const store = storeFor(c);
      const cacheKey = await sha256(canonicalKey);
      const now = new Date().toISOString();
      if (!clientProgressMode() && store.loadHookLlmResult) {
        const cached = await store.loadHookLlmResult(playerId, cacheKey, now);
        if (cached)
          return cached.output;
      }
      const resolved = await resolveHookLlmRequest(llmProvider, llmEnv, request);
      if (resolved instanceof HookLlmUnavailableError)
        throw resolved;
      if (clientProgressMode() || !store.saveHookLlmResultIfAbsent)
        return resolved.output;
      const retentionDays = dependencies(c).config.llmResultRetentionDays ?? 30;
      const record = await store.saveHookLlmResultIfAbsent(playerId, {
        cacheKey,
        taskId: request.taskId,
        kind: request.kind,
        modelVersion: hookLlmModelVersion(llmEnv, request),
        ...await hookLlmRequestHashes(request),
        status: resolved.status,
        output: resolved.output,
        errorCode: resolved.errorCode ?? null,
        expiresAt: new Date(Date.now() + Math.max(1, retentionDays) * 86400000).toISOString()
      });
      await cleanupHookLlmCache(c);
      return record.output;
    };
    const result = await runScenarioHooks(state, event, {
      playerId,
      llmEnv,
      llmProvider,
      resolveLlm,
      messageBaseSentAtByTalk: hookMessageBaseSentAtByTalk(options.precedingTranscriptAppends ?? [])
    });
    if (result.rejection)
      return result;
    if (clientProgressMode()) {
      result.state = await applyBrowserSchedules(result.state, result.scheduleEffects);
      return result;
    }
    return result;
  }
  async function applyHooks(c: PlayerOperationContext, playerId: string, state: StoredPlayerState, event: ScenarioEventPayload, options: {
    precedingTranscriptAppends?: readonly TranscriptAppend[];
  } = {}) {
    return applyHookResult(c, playerId, state, event, options);
  }
  async function applyHookEvents(c: PlayerOperationContext, playerId: string, state: StoredPlayerState, events: readonly ScenarioEventPayload[], precedingTranscriptAppends: readonly TranscriptAppend[] = []) {
    const results: ScenarioHookResult[] = [];
    let current = state;
    for (const event of events) {
      const result = await applyHookResult(c, playerId, current, event, {
        precedingTranscriptAppends: [...precedingTranscriptAppends, ...results.flatMap(item => item.transcriptAppends)]
      });
      results.push(result);
      current = result.state;
      if (result.rejection || result.presentationSequence)
        break;
    }
    return {
      state: current,
      transcriptAppends: results.flatMap(result => result.transcriptAppends),
      generatedAudioEffects: results.flatMap(result => result.generatedAudioEffects),
      scheduleEffects: results.flatMap(result => result.scheduleEffects),
      presentationEffects: results.flatMap(result => result.presentationEffects),
      presentationSequence: results.find(result => result.presentationSequence)?.presentationSequence ?? null,
      rejection: results.find(result => result.rejection)?.rejection ?? null
    } satisfies ScenarioHookResult;
  }
  const partLoadedEvents = (ids: readonly string[]): ScenarioEventPayload[] => ids.map(partId => ({ eventId: "part_loaded", partId }));
  async function verifiedPinParts(pin: string) {
    const lock = runtime.workerScenario.project.lockScreen;
    if (lock.method !== "fixed-pin")
      return null;
    if (parts?.source?.pin)
      return parts.source.pin(pin);
    return pin === lock.pin ? lock.loadParts ?? [] : null;
  }
  async function activateParts(state: StoredPlayerState, requested: readonly string[]) {
    if (parts)
      return parts.activate(state, requested);
    if (requested.length)
      throw new Error("partの実行境界が設定されていません。");
    return { state: copyStoredPlayerState(state), added: [] as string[] };
  }
  function publicPresentation(...results: readonly ScenarioHookResult[]): PublicPresentationPayload | undefined {
    const effects = results.flatMap((result) => result.presentationEffects);
    const sequences = results.flatMap((result) => result.presentationSequence ? [result.presentationSequence] : []);
    if (sequences.length > 1)
      throw new Error("presentation_sequence_conflict");
    const sequence = sequences[0];
    const publicSequence = sequence?.type === "all_clear"
      ? (() => {
        const content = contentByInternalId(sequence.contentId);
        if (!content || content.appId !== sequence.appId || !isAppId(sequence.appId)) {
          throw new Error("presentation_all_clear_target_not_found");
        }
        return {
          type: "all_clear" as const,
          target: { appId: sequence.appId, contentId: content.publicId },
          autoplay: sequence.autoplay
        };
      })()
      : sequence?.type === "game_over"
        ? { type: "game_over" as const, reasonMessage: sequence.reasonMessage }
        : null;
    return effects.length || publicSequence
      ? { effects, ...(publicSequence ? { sequence: publicSequence } : {}) }
      : undefined;
  }
  function publicPresentationSegments(message: StoredTalkMessage): PublicPresentationMessageSegment[] | undefined {
    if (!message.segments)
      return undefined;
    return message.segments.map((segment) => {
      if (segment.kind === "text" || "externalUrl" in segment)
        return segment;
      if (!isAppId(segment.appId))
        throw new Error("presentation_talk_segment_app_not_found");
      return {
        kind: "link" as const,
        text: segment.text,
        appId: segment.appId,
        contentId: segment.contentId,
        ...(segment.linkId ? { linkId: segment.linkId } : {})
      };
    });
  }
  function clientScenarioEventAllowed(eventId: string) {
    return isCoreClientScenarioEvent(eventId) || runtime.workerScenario.clientCallableEvents.includes(eventId);
  }
  function availableFormContent(formId: string, state: StoredPlayerState) {
    return runtime.workerScenario.contents.find((content) => {
      const form = content.record.form;
      const disabledCond = typeof content.record.formDisabledCond === "string" ? content.record.formDisabledCond : "";
      return contentAvailable(content, state)
        && form !== null
        && typeof form === "object"
        && !Array.isArray(form)
        && (form as {
          id?: unknown;
          disabled?: unknown;
        }).id === formId
        && (form as {
          disabled?: unknown;
        }).disabled !== true
        && !(disabledCond && evaluateCondition(disabledCond, definedConditionState(effectiveStateValues(runtime.workerScenario.stateVariables, state.stateValues))));
    });
  }
  async function applyDueScheduledEventsResult(c: PlayerOperationContext, initialPlayer: PlayerRecord) {
    if (visibleIncomingCallId(initialPlayer.state))
      return { player: initialPlayer, interrupted: true };
    if (clientProgressMode()) {
      let player = initialPlayer;
      const now = new Date().toISOString();
      const due = player.state.browserScheduledEvents.filter((event) => event.dueAt <= now);
      for (const event of due) {
        const currentEvent = player.state.browserScheduledEvents
          .find((item) => item.scheduleId === event.scheduleId);
        if (!currentEvent)
          continue;
        try {
          const internalEventId = Object.entries(runtime.workerScenario.publicIds.scenarioEvent)
            .find(([, publicId]) => publicId === currentEvent.eventId)?.[0];
          if (!internalEventId)
            throw new Error(`予定イベントを解決できません: ${currentEvent.eventId}`);
          const nextState = copyStoredPlayerState(player.state);
          nextState.browserScheduledEvents = nextState.browserScheduledEvents
            .filter((item) => item.scheduleId !== currentEvent.scheduleId);
          const hookResult = await applyHooks(c, player.id, nextState, {
            eventId: "scheduled_event",
            scheduleId: internalEventId,
            scheduleInstanceId: currentEvent.scheduleId,
            fields: currentEvent.fields
          });
          const committed = await commitPlayer(c, player, {
            state: hookResult.state,
            transcriptAppends: hookResult.transcriptAppends,
            hookResults: [hookResult]
          });
          if (!committed.ok)
            throw new Error("browser_scheduled_event_conflict");
          player = committed.player;
          if (visibleIncomingCallId(player.state))
            return { player, interrupted: true };
        }
        catch (error) {
          console.error("[browser_scheduled_event]", error);
          throw new RetryableScheduledEventError(error);
        }
      }
      return { player, interrupted: false };
    }
    let player = initialPlayer;
    const due = await storeFor(c).dueScheduledEvents(player.id, new Date().toISOString());
    for (const event of due) {
      if (!(await storeFor(c).claimScheduledEvent(player.id, event.id)))
        continue;
      try {
        const hookResult = await applyHooks(c, player.id, player.state, {
          eventId: "scheduled_event",
          scheduleId: event.eventId,
          scheduleInstanceId: event.scheduleId,
          fields: event.fields
        });
        const committed = await commitPlayer(c, player, {
          state: hookResult.state,
          transcriptAppends: hookResult.transcriptAppends,
          hookResults: [hookResult]
        });
        if (!committed.ok)
          throw new Error("scheduled_event_conflict");
        player = committed.player;
        await storeFor(c).completeScheduledEvent(player.id, event.id);
        if (visibleIncomingCallId(player.state))
          return { player, interrupted: true };
      }
      catch (error) {
        try {
          await storeFor(c).requeueScheduledEvent(player.id, event.id);
        }
        catch (requeueError) {
          console.error("[scheduled_event:requeue]", requeueError);
        }
        console.error("[scheduled_event]", error);
        throw new RetryableScheduledEventError(error);
      }
    }
    return { player, interrupted: false };
  }
  async function applyDueScheduledEvents(c: PlayerOperationContext, player: PlayerRecord) {
    return (await applyDueScheduledEventsResult(c, player)).player;
  }
  const operations: Record<string, (c: PlayerOperationContext) => Promise<PlayerOperationResult>> = {};
  operations["POST /api/device-pin/verify"] = async (c) => {
    const lockScreen = runtime.workerScenario.project.lockScreen;
    if (lockScreen.method !== "fixed-pin") {
      return operationResult({ ok: false, error: "not_available" }, 404);
    }
    const body = c.body;
    const pin = typeof body?.pin === "string" ? body.pin : "";
    const loadParts = await verifiedPinParts(pin);
    if (!loadParts) {
      return operationResult({ ok: false, error: "invalid" }, 400);
    }
    const player = await resolvePlayer(c, false);
    if (!player)
      return operationResult({ ok: true });
    const activated = await activateParts(player.state, loadParts);
    const result = await applyHookEvents(c, player.id, activated.state, partLoadedEvents(activated.added));
    if (result.rejection)
      return operationResult({ ok: false, error: result.rejection.error, playerState: await stateJson(c, player) }, 422);
    const committed = await commitPlayer(c, player, { state: result.state, transcriptAppends: result.transcriptAppends, hookResults: [result] });
    if (!committed.ok)
      return conflict(c, player);
    const presentation = publicPresentation(result);
    return operationResult({ ok: true, playerState: await stateJson(c, committed.player), ...(presentation ? { presentation } : {}) });
  };
  operations["POST /api/session/start"] = async (c) => {
    await cleanupHookLlmCache(c);
    const body = c.body;
    const startupParts = runtime.workerScenario.project.lockScreen.method === "fixed-pin"
      ? await verifiedPinParts(typeof body?.pin === "string" ? body.pin : "") : [];
    if (!startupParts)
      return operationResult({ ok: false, error: "invalid" }, 400);
    // 初回とreset後は同じ順序で初期履歴・予約を準備し、hookと一緒に確定する。
    const start = async (player: PlayerRecord, starting: boolean, sessionToken: string) => {
      await parts?.restore(player.state);
      const activated = await activateParts(player.state, startupParts);
      const schedules = starting ? initialScheduledEvents() : [];
      const initialState = starting && clientProgressMode() ? await withInitialBrowserSchedules(activated.state) : activated.state;
      const reconciled = await reconcileScenarioState(initialState, player.id);
      const hookResult = await applyHookEvents(c, player.id, reconciled.state,
        [...partLoadedEvents([...(starting ? ["base"] : []), ...activated.added]), { eventId: "session_started" }], reconciled.transcriptAppends);
      if (hookResult.rejection) return operationResult({ ok: false, error: hookResult.rejection.error }, 422);
      const committed = await commitPlayer(c, player, {
        state: hookResult.state, initialSchedules: schedules, initialize: starting,
        transcriptAppends: [...reconciled.transcriptAppends, ...hookResult.transcriptAppends], hookResults: [hookResult]
      });
      let sessionPlayer: PlayerRecord;
      let presentation = publicPresentation(hookResult);
      if (committed.ok) sessionPlayer = committed.player;
      else {
        // 初回の競合勝者を読むだけで、開始hookを重ねて呼ばない。
        const current = await storeFor(c).playerForSession(sessionToken);
        if (!current?.state || current.resetting) return operationResult({ ok: false, error: "conflict" }, 409);
        sessionPlayer = { ...current, state: current.state };
        presentation = undefined;
      }
      const playerState = await stateJson(c, sessionPlayer);
      return operationResult({
        ok: true, sessionToken: clientProgressMode() && "progressToken" in playerState ? playerState.progressToken : sessionToken,
        playerState, ...(presentation ? { presentation } : {})
      });
    };
    if (clientProgressMode()) {
      if (!localProgress && !browserStateSecret(c))
        return operationResult({ ok: false, error: "browser_state_secret_missing" }, 500);
      return start({ id: crypto.randomUUID(), state: createInitialPlayerState(), stateVersion: 0 }, true, "");
    }
    const serialCode = typeof body?.serialCode === "string" ? body.serialCode.replace(/\D/gu, "") : "";
    const hostname = c.hostname;
    const localDevelopment = !isProductionEnvironment(dependencies(c).config.appEnv)
      && (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1");
    const validCode = localDevelopment ? /^\d{4}(?:\d{4})?$/u.test(serialCode) : /^\d{8}$/u.test(serialCode);
    if (!validCode) {
      return operationResult({ ok: false, error: "invalid" }, 400);
    }
    const accessCodeSecret = dependencies(c).config.accessCodeSecret?.trim() ?? "";
    let playerAccessCode = serialCode;
    if (!localDevelopment && accessCodeSecret) {
      const checkDigits = serialCode.slice(0, 4);
      const counter = serialCode.slice(4);
      const attemptedAt = new Date().toISOString();
      if (await storeFor(c).isAccessCodeLocked(counter, attemptedAt)) {
        return operationResult({ ok: false, error: "rate_limited" }, 429);
      }
      const expected = await accessCodeCheckDigits(counter, accessCodeSecret);
      if (checkDigits !== expected) {
        await storeFor(c).recordAccessCodeAttempt(counter, false, attemptedAt);
        return operationResult({ ok: false, error: "invalid" }, 400);
      }
      await storeFor(c).recordAccessCodeAttempt(counter, true, attemptedAt);
      playerAccessCode = counter;
    }
    const created = await storeFor(c).createPasscodeSession(playerAccessCode, null, []);
    let identity = await storeFor(c).playerForSession(created.sessionToken);
    if (!identity)
      return operationResult({ ok: false, error: "session_create_failed" }, 500);
    if (identity.resetting) {
      if (!await storeFor(c).resetPlayerProgress(identity)) return operationResult({ ok: false, error: "conflict" }, 409);
      identity = await storeFor(c).playerForSession(created.sessionToken);
      if (!identity) return operationResult({ ok: false, error: "session_create_failed" }, 500);
    }
    const starting = identity.state === null;
    const player: PlayerRecord = { id: identity.id, state: identity.state ?? createInitialPlayerState(), stateVersion: identity.stateVersion };
    return start(player, starting, created.sessionToken);
  };
  const handlePlayerState = async (c: PlayerOperationContext) => {
    const player = await resolvePlayer(c);
    if (!player)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    return operationResult({ ok: true, playerState: await stateJson(c, player) });
  };
  operations["POST /api/player-state"] = handlePlayerState;
  operations["GET /api/transcript/:stream"] = async (c) => {
    const player = await resolvePlayer(c);
    if (!player)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (clientProgressMode())
      return operationResult({ ok: false, error: "not_available" }, 404);
    const requestedStream = cleanText(c.params?.stream, 180);
    const afterSeq = Math.max(0, Number.parseInt(c.query?.after ?? "0", 10) || 0);
    const talk = talkByPublicId(requestedStream);
    const progress = talk ? player.state.talks[talk.id] : null;
    if (!talk || !progress || !talkAvailable(talk, player.state)) {
      return operationResult({ ok: false, error: "not_available" }, 404);
    }
    const transcript = await storeFor(c).loadTranscript(player.id, `talk:${talk.id}`, progress.transcriptKey);
    if (isSearchAgentTalk(talk)) {
      return operationResult({
        ok: true,
        delta: {
          kind: "search_agent" as const,
          talkId: talk.publicId,
          transcriptKey: transcript.transcriptKey,
          messages: publicSearchAgentTimelineItems(transcript.messages.filter((message): message is StoredSearchAgentEvent => message.kind === "search_agent"), talk.publicId).filter((message) => message.seq > afterSeq)
        }
      });
    }
    const resolvedMessages = visibleTalkMessagesForState(talk, player.state, transcript.messages.filter((message): message is StoredTalkEvent => "event_type" in message));
    return operationResult({
      ok: true,
      delta: {
        kind: talk.kind,
        talkId: talk.publicId,
        transcriptKey: transcript.transcriptKey,
        messages: resolvedMessages
          .filter((message) => message.seq > afterSeq)
          .map(publicTalkMessage)
      }
    });
  };
  operations["POST /api/reset-for-testing"] = async (c) => {
    if (!isResetForTestingAllowed(dependencies(c).config.appEnv, c.hostname)) {
      return operationResult({ ok: false, error: "not_found" }, 404);
    }
    // resetは開始処理ではない。壊れた台本や予約も復元せず、認証された保存だけを消す。
    if (clientProgressMode()) return operationResult({ ok: false, error: "not_found" }, 404);
    const player = await storeFor(c).playerForSession(bearerToken(c.authorization), "reset");
    if (!player)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (!await storeFor(c).resetPlayerProgress(player)) return operationResult({ ok: false, error: "conflict" }, 409);
    return operationResult({ ok: true });
  };
  operations["POST /api/content/opened"] = async (c) => {
    const resolved = await resolveMutationPlayer(c);
    if (!resolved)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (resolved.interrupted)
      return operationResult({ ok: false, error: "incoming_call_active", playerState: await stateJson(c, resolved.player) }, 409);
    const player = resolved.player;
    const body = c.body;
    const contentId = cleanText(body?.contentId, 160);
    const appId = cleanText(body?.appId, 64);
    const content = contentByPublicId(contentId);
    const contentParentUnavailable = content?.appId === appId && !appAvailable(appId, player.state);
    if (!contentId || !appId || contentParentUnavailable || !openTargetExists(contentId, appId, player.state)) {
      return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    }
    const notificationIdsToClear = notificationIdsForTarget(contentId, player.state);
    let nextState = copyStoredPlayerState(player.state);
    await syncTalkReadCursors(c, player, nextState, body);
    const target = repairTarget(contentId, appId);
    let repaired = false;
    const transcriptAppends: TranscriptAppend[] = [];
    const contentHookResults: ScenarioHookResult[] = [];
    let internalTargetId = contentByPublicId(contentId)?.id ?? talkByPublicId(contentId)?.id ?? contentId;
    if (target?.kind === "app" && !nextState.repairedAppIds.includes(target.internalId)) {
      if (!repairTargetWasFound(player.state, contentId, appId)) {
        return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
      }
      nextState.repairedAppIds = unique([...nextState.repairedAppIds, target.internalId]);
      internalTargetId = target.internalId;
      repaired = true;
    }
    else if (target?.kind === "content" && !nextState.repairedContentIds.includes(target.internalId)) {
      if (!repairTargetWasFound(player.state, contentId, appId)) {
        return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
      }
      const restoredHistory = restoredTalkHistoryMessages(nextState, target.internalId);
      if (restoredHistory && !restoredHistory.ok) {
        return operationResult({
          ok: false,
          error: restoredHistory.error === "history_layout_changed" ? "scenario_changed" : "not_available",
          playerState: await stateJson(c, player)
        }, 409);
      }
      nextState.repairedContentIds = unique([...nextState.repairedContentIds, target.internalId]);
      internalTargetId = target.internalId;
      if (restoredHistory?.ok && restoredHistory.messages.length) {
        nextState = revealTalkMessages(nextState, restoredHistory.talk.id, restoredHistory.messages);
        synchronizeInitialTalkLastOtherMessageId(nextState, restoredHistory.talk.id);
      }
      repaired = true;
    }
    else if (target?.kind === "talk" && !nextState.repairedContentIds.includes(target.internalId)) {
      if (!repairTargetWasFound(player.state, contentId, appId)) {
        return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
      }
      nextState.repairedContentIds = unique([...nextState.repairedContentIds, target.internalId]);
      synchronizeInitialTalkLastOtherMessageId(nextState, target.internalId);
      internalTargetId = target.internalId;
      repaired = true;
    }
    if (repaired) {
      const hookResult = await applyHooks(c, player.id, nextState, { eventId: "content_repaired", contentId: internalTargetId });
      nextState = hookResult.state;
      transcriptAppends.push(...hookResult.transcriptAppends);
      contentHookResults.push(hookResult);
      if (hookResult.rejection)
        return operationResult({ ok: false, error: hookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
    }
    if (!contentHookResults.some((result) => result.presentationSequence)) {
      const openedHookResult = await applyHooks(c, player.id, nextState, { eventId: "content_opened", contentId: internalTargetId, fields: { appId } }, { precedingTranscriptAppends: transcriptAppends });
      nextState = openedHookResult.state;
      transcriptAppends.push(...openedHookResult.transcriptAppends);
      contentHookResults.push(openedHookResult);
      if (openedHookResult.rejection)
        return operationResult({ ok: false, error: openedHookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
    }
    const openedTalk = talkByPublicId(contentId);
    if (openedTalk && isDeviceTalk(openedTalk) && openedTalk.appId === appId) {
      nextState.repairedContentIds = unique([
        ...nextState.repairedContentIds,
        ...observedAlbumMediaContentIds(openedTalk, nextState, requestedMediaContentIds(body))
      ]);
    }
    nextState.clearedNotificationIds = unique([...nextState.clearedNotificationIds, ...notificationIdsToClear]);
    const presentation = publicPresentation(...contentHookResults);
    const committed = await commitPlayer(c, player, {
      state: nextState,
      transcriptAppends,
      hookResults: contentHookResults
    });
    if (!committed.ok)
      return conflict(c, player);
    return operationResult({ ok: true, playerState: await stateJson(c, committed.player), ...(presentation ? { presentation } : {}) });
  };
  operations["POST /api/content/media-observed"] = async (c) => {
    const resolved = await resolveMutationPlayer(c);
    if (!resolved)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (resolved.interrupted)
      return operationResult({ ok: false, error: "incoming_call_active", playerState: await stateJson(c, resolved.player) }, 409);
    const player = resolved.player;
    const body = c.body;
    const publicTalkId = cleanText(body?.contentId, 160);
    const appId = cleanText(body?.appId, 64);
    const mediaContentIds = requestedMediaContentIds(body);
    const talk = talkByPublicId(publicTalkId);
    if (!talk || !isDeviceTalk(talk) || talk.appId !== appId || !talkAvailable(talk, player.state)) {
      return operationResult({ ok: false, error: "not_available" }, 409);
    }
    const repairedContentIds = observedAlbumMediaContentIds(talk, player.state, mediaContentIds);
    if (!repairedContentIds.length) {
      return operationResult({ ok: true, playerState: await stateJson(c, player) });
    }
    const nextState = copyStoredPlayerState(player.state);
    nextState.repairedContentIds = unique([...nextState.repairedContentIds, ...repairedContentIds]);
    const committed = await commitPlayer(c, player, { state: nextState });
    if (!committed.ok)
      return conflict(c, player);
    return operationResult({ ok: true, playerState: await stateJson(c, committed.player) });
  };
  operations["POST /api/content/unlock"] = async (c) => {
    const resolved = await resolveMutationPlayer(c);
    if (!resolved)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (resolved.interrupted)
      return operationResult({ ok: false, error: "incoming_call_active", playerState: await stateJson(c, resolved.player) }, 409);
    const player = resolved.player;
    const body = c.body;
    const contentId = cleanText(body?.contentId, 160);
    const password = cleanText(body?.password, 100);
    const content = contentByPublicId(contentId);
    const passwordDefinition = content ? lockedContentPassword(content.id) : undefined;
    const attachmentVisible = content
      && openTargetExists(content.publicId, content.appId, player.state)
      && player.state.revealedAttachmentContentIds.includes(content.id);
    if (!content || !attachmentVisible) {
      return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    }
    const loadParts = password && passwordDefinition
      ? parts?.source?.password ? await parts.source.password(passwordDefinition, password)
        : passwordDefinition.answers.includes(normalizeAnswer(password)) ? passwordDefinition.loadParts : null
      : null;
    if (!loadParts) {
      return operationResult({ ok: false, error: "invalid" }, 400);
    }
    const activated = await activateParts(player.state, loadParts);
    if (contentByInternalId(content.id)?.unavailable)
      throw new Error(`解錠する本文のpartが未取得です: ${content.id}`);
    const nextState = activated.state;
    nextState.unlockedContentIds = unique([...nextState.unlockedContentIds, content.id]);
    const hookResult = await applyHookEvents(c, player.id, nextState, [...partLoadedEvents(activated.added), { eventId: "content_unlocked", contentId: content.id }]);
    if (hookResult.rejection)
      return operationResult({ ok: false, error: hookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
    const presentation = publicPresentation(hookResult);
    const committed = await commitPlayer(c, player, {
      state: hookResult.state,
      transcriptAppends: hookResult.transcriptAppends,
      hookResults: [hookResult]
    });
    if (!committed.ok)
      return conflict(c, player);
    return operationResult({ ok: true, state: "unlocked", playerState: await stateJson(c, committed.player), ...(presentation ? { presentation } : {}) });
  };
  operations["POST /api/scenario/event"] = async (c) => {
    const body = c.body;
    const eventId = cleanText(body?.eventId, 160);
    const deferScheduledEvents = isCompletionScenarioEvent(eventId);
    const playerBeforeDueEvents = deferScheduledEvents ? await resolvePlayer(c, false) : null;
    const resolved = deferScheduledEvents
      ? playerBeforeDueEvents && { player: playerBeforeDueEvents, interrupted: false }
      : await resolveMutationPlayer(c);
    if (!resolved)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (resolved.interrupted)
      return operationResult({ ok: false, error: "incoming_call_active", playerState: await stateJson(c, resolved.player) }, 409);
    const player = resolved.player;
    if (!eventId)
      return operationResult({ ok: false, error: "invalid" }, 400);
    if (!clientScenarioEventAllowed(eventId))
      return operationResult({ ok: false, error: "event_not_callable" }, 403);
    const nestedFields = body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? body.fields as Record<string, unknown>
      : {};
    const rootFields = Object.fromEntries(Object.entries(body ?? {}).filter(([key]) => key !== "eventId" && key !== "fields"));
    const fields = Object.fromEntries(Object.entries({ ...rootFields, ...nestedFields }).slice(0, 20)
      .map(([key, value]) => [cleanText(key, 80), cleanScenarioField(value, 500)])
      .filter(([key]) => key)
      .map(([key, value]) => [key, internalScenarioField(key, value)]));
    if (eventId === "audio_cue_reached") {
      const cue = radioAudioCueForEvent(fields.contentId ?? "", Number(fields.cueIndex), player.state);
      if (!cue)
        return operationResult({ ok: false, error: "invalid" }, 400);
      fields.cueId = cue.cueId;
      fields.cueTarget = cue.cueTarget;
      fields.cueIndex = String(cue.cueIndex);
    }
    if (eventId === "incoming_call_completed" && fields.callId !== visibleIncomingCallId(player.state)) {
      const current = deferScheduledEvents ? await applyDueScheduledEvents(c, player) : player;
      return operationResult({ ok: true, playerState: await stateJson(c, current) });
    }
    const baseState = eventId === "incoming_call_completed"
      ? {
        ...copyStoredPlayerState(player.state),
        incomingCallId: null,
        completedIncomingCallIds: unique([...player.state.completedIncomingCallIds, fields.callId])
      }
      : player.state;
    const hookResult = await applyHookResult(c, player.id, baseState, {
      eventId,
      contentId: fields.contentId,
      callId: fields.callId,
      talkId: fields.talkId,
      attachmentId: fields.attachmentId,
      actionId: fields.actionId,
      formId: fields.formId,
      cueId: fields.cueId,
      cueTarget: fields.cueTarget,
      cueIndex: fields.cueIndex ? Number(fields.cueIndex) : undefined,
      fields
    });
    const nextState = hookResult.state;
    if (hookResult.rejection) {
      return operationResult({ ok: false, error: hookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
    }
    const presentation = publicPresentation(hookResult);
    const committed = await commitPlayer(c, player, {
      state: nextState,
      transcriptAppends: hookResult.transcriptAppends,
      hookResults: [hookResult]
    });
    if (!committed.ok)
      return conflict(c, player, !deferScheduledEvents);
    let current = committed.player;
    if (deferScheduledEvents && !hookResult.presentationSequence)
      current = await applyDueScheduledEvents(c, current);
    return operationResult({
      ok: true,
      playerState: await stateJson(c, current),
      ...(presentation ? { presentation } : {})
    });
  };
  operations["POST /api/message-link/open"] = async (c) => {
    const resolved = await resolveMutationPlayer(c);
    if (!resolved)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (resolved.interrupted)
      return operationResult({ ok: false, error: "incoming_call_active", playerState: await stateJson(c, resolved.player) }, 409);
    const player = resolved.player;
    const body = c.body;
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
      return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    }
    const app = appById(link.appId);
    const content = contentByInternalId(link.contentId);
    const targetTalk = talkByInternalId(link.contentId);
    const targetAppAvailable = Boolean(app && appAvailable(app.id, player.state));
    const targetContentAvailable = Boolean(content && content.appId === link.appId && contentAvailable(content, player.state));
    const targetTalkAvailable = Boolean(targetTalk && isDeviceTalk(targetTalk) && targetTalk.appId === link.appId && talkAvailable(targetTalk, player.state));
    if (!targetAppAvailable || (!targetContentAvailable && !targetTalkAvailable)) {
      return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    }
    let nextState = player.state;
    let stateChanged = false;
    let transcriptAppends: TranscriptAppend[] = [];
    let linkHookResult: ScenarioHookResult | null = null;
    if (link.actionId) {
      const hookResult = await applyHooks(c, player.id, nextState, {
        eventId: "message_link_opened",
        actionId: link.actionId,
        talkId: talk.id,
        contentId: link.contentId,
        fields: { appId: link.appId, linkId: link.id }
      });
      nextState = hookResult.state;
      linkHookResult = hookResult;
      transcriptAppends = hookResult.transcriptAppends;
      stateChanged = JSON.stringify(nextState) !== JSON.stringify(player.state);
    }
    if (linkHookResult?.rejection)
      return operationResult({ ok: false, error: linkHookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
    const presentation = linkHookResult ? publicPresentation(linkHookResult) : undefined;
    const committed = linkHookResult
      ? await commitPlayer(c, player, {
        state: nextState,
        transcriptAppends,
        hookResults: [linkHookResult]
      })
      : { ok: true as const, player };
    if (!committed.ok)
      return conflict(c, player);
    const targetContentId = content?.publicId ?? targetTalk?.publicId ?? link.contentId;
    return operationResult({
      ok: true,
      target: { appId: link.appId, contentId: targetContentId },
      playerState: await stateJson(c, committed.player),
      ...(presentation ? { presentation } : {})
    });
  };
  operations["POST /api/talk/send"] = async (c) => {
    const resolved = await resolveMutationPlayer(c);
    if (!resolved)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (resolved.interrupted)
      return operationResult({ ok: false, error: "incoming_call_active", playerState: await stateJson(c, resolved.player) }, 409);
    const player = resolved.player;
    const body = c.body;
    const publicTalkId = cleanText(body?.talkId, 160);
    const rawMessage = cleanText(body?.message, 1000);
    const turnKey = cleanText(body?.turnKey, 160);
    const talk = talkByPublicId(publicTalkId);
    const message = talk && isDeviceTalk(talk) ? internalizeTalkCommand(rawMessage) : rawMessage;
    if (!talk || !message || !turnKey)
      return operationResult({ ok: false, error: "invalid" }, 400);
    let readState = copyStoredPlayerState(player.state);
    const readChanged = await syncTalkReadCursors(c, player, readState, body);
    const storedTalk = readState.talks[talk.id];
    if (!storedTalk || storedTalk.turnKey !== turnKey) {
      if (readChanged) {
        const committed = await commitPlayer(c, player, { state: readState });
        if (!committed.ok)
          return conflict(c, player);
        return operationResult({ ok: true, stale: true, playerState: await stateJson(c, committed.player) });
      }
      return operationResult({ ok: true, stale: true, playerState: await stateJson(c, player) });
    }
    if (!talkCanPost(talk, readState)) {
      const current = readChanged ? await commitPlayer(c, player, { state: readState }) : { ok: true as const, player };
      if (!current.ok)
        return conflict(c, player);
      return operationResult({ ok: false, error: "cannot_post", playerState: await stateJson(c, current.player) }, 409);
    }
    if (isDeviceTalk(talk) && !talkCommandAvailable(message, readState)) {
      return operationResult({ ok: false, error: "invalid_attachment" }, 400);
    }
    const fromId = storedTalk.from;
    const recentMessages = await recentMessagesForTalk(c, player, talk.id, storedTalk.transcriptKey, body?.recentMessages);
    const selection = await resolveScenarioTalkRule({
      env: dependencies(c).config.llm,
      llmEnabled: runtime.workerScenario.features.llm,
      talk,
      from: fromId,
      playerInput: message,
      semanticPlayerInput: isDeviceTalk(talk) ? semanticInputForTalkCommand(message) : message,
      stateValues: effectiveStateValues(runtime.workerScenario.stateVariables, readState.stateValues),
      recentMessages,
      secretSelector: parts?.source?.secret
    });
    if (!selection.ok) {
      if (readChanged) {
        const committed = await commitPlayer(c, player, { state: readState });
        if (!committed.ok)
          return conflict(c, player);
      }
      const error = selection.error.startsWith("provider_") ? "llm_unavailable" : selection.error;
      return operationResult({ ok: false, error, retryable: true }, 503);
    }
    const activated = await activateParts(readState, selection.rule.loadParts ?? []);
    readState = activated.state;
    if (isSearchAgentTalk(talk)) {
      if (selection.rule.mode === "game_over")
        return operationResult({ ok: false, error: "invalid" }, 400);
      const now = new Date().toISOString();
      const nextState = copyStoredPlayerState(readState);
      const nextTalk = nextState.talks[talk.id];
      const nextFrom = selection.rule.mode === "stay" ? fromId : selection.rule.nextFromId;
      nextState.stateValues = applyCompactStateAssignments(runtime.workerScenario.stateVariables, nextState.stateValues, selection.rule.set, selection.matchGroups, runtime.workerScenario.stateVariableDefinitions);
      const outputEnv = {
        ...effectiveStateValues(runtime.workerScenario.stateVariables, nextState.stateValues),
        ...talkOutputMatchEnv(selection.rule.match, selection.matchGroups),
        player_input: message
      };
      const evaluated = evaluateTalkOutputSteps({
        steps: selection.rule.outputSteps,
        env: outputEnv,
        search: (query) => searchScenario(query, nextState)
      });
      const turnHash = (await sha256(`${player.id}:search_agent:${turnKey}`)).slice(0, 32);
      const ownerEvent = searchAgentPlayerMessageEvent({
        id: `search_agent_player_${turnHash}`,
        seq: nextTalk.lastMessageSeq + 1,
        body: message,
        deliveredAt: now
      });
      const rendered = searchAgentTimelineForOutputs({
        outputs: evaluated.outputs,
        previousCounts: nextTalk.blockDisplayCounts,
        formatEnv: evaluated.env,
        startSeq: ownerEvent.seq,
        inputVisible: nextTalk.inputVisible ?? true,
        inputVisibleAfterSeq: nextTalk.inputVisibleAfterSeq ?? 0,
        inputEnabled: nextTalk.inputEnabled ?? true,
        inputEnabledAfterSeq: nextTalk.inputEnabledAfterSeq ?? 0,
        baseSentAt: new Date(Date.parse(now) + 1000).toISOString(),
        idPrefix: `search_agent_output_${turnHash}`
      });
      const revealed = revealTalkMessages(nextState, talk.id, rendered.messages.filter((item) => item.type === "message"));
      nextState.revealedMessageLinks = revealed.revealedMessageLinks;
      nextTalk.blockDisplayCounts = rendered.blockDisplayCounts;
      nextTalk.lastMessageSeq = rendered.lastSeq;
      nextTalk.inputVisible = rendered.inputVisible;
      nextTalk.inputVisibleAfterSeq = rendered.inputVisibleAfterSeq;
      nextTalk.inputEnabled = rendered.inputEnabled;
      nextTalk.inputEnabledAfterSeq = rendered.inputEnabledAfterSeq;
      nextTalk.from = nextFrom;
      nextTalk.turnKey = await nextTalkTurnKey(player.id, talk.id, turnKey, nextFrom);
      nextState.discoveredTargetKeys = unique([
        ...nextState.discoveredTargetKeys,
        ...evaluated.searchResults.filter((result) => result.repairable !== false).map((result) => `${result.appId}:${result.contentId}`)
      ]);
      const transcriptAppends: TranscriptAppend[] = [{
        streamId: SEARCH_AGENT_STREAM_ID,
        transcriptKey: nextTalk.transcriptKey,
        messages: [ownerEvent, ...rendered.events]
      }];
      const talkHookResult = await applyHookEvents(c, player.id, nextState, [...partLoadedEvents(activated.added), {
        eventId: "talk_turn_completed",
        talkId: talk.id,
        playerInput: message,
        ruleId: selection.rule.id,
        fields: {
          kind: talk.kind,
          fromId,
          nextFromId: nextFrom,
          ruleId: selection.rule.id
        }
      }], transcriptAppends);
      if (talkHookResult.rejection) {
        return operationResult({ ok: false, error: talkHookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
      }
      if (!selection.rule.mode && !talkHookResult.presentationSequence)
        runtime.validateTalkContinuation(talk.id, nextFrom, talkHookResult.state);
      const presentation = publicPresentation(talkHookResult);
      const committed = await commitPlayer(c, player, {
        state: talkHookResult.state,
        transcriptAppends: [...transcriptAppends, ...talkHookResult.transcriptAppends],
        hookResults: [talkHookResult]
      });
      if (!committed.ok)
        return conflict(c, player);
      if (!localProgress)
        await storeFor(c).recordInputEvent({
          playerId: player.id,
          requestKey: turnKey,
          talkId: talk.id,
          fromId,
          userInput: message,
          status: "completed",
          matched: selection.source !== "default",
          ruleId: selection.rule.id,
          nextFromId: nextFrom,
          responseSnapshot: {
            source: selection.source,
            loadedParts: player.state.loadedPartIds,
            acquiredParts: committed.player.state.loadedPartIds,
            reviewSelection: selection.reviewSelection,
            match: selection.matchGroups,
            outputSteps: selection.rule.outputSteps,
            nextBlocks: selection.rule.nextBlocks,
            resultCount: evaluated.searchResults.length
          }
        }, dependencies(c).config.playerInputLogging === true).catch((error) => console.error("[player_input_events]", error));
      return operationResult({
        ok: true,
        playerState: await stateJson(c, committed.player),
        ...(presentation ? { presentation } : {})
      });
    }
    const now = nextTalkMessageSentAt(storedTalk.lastDeliveredAt, new Date().toISOString());
    const nextState = copyStoredPlayerState(readState);
    const nextTalk = nextState.talks[talk.id];
    const nextFrom = selection.rule.mode === "stay" || selection.rule.mode === "game_over"
      ? fromId
      : selection.rule.nextFromId || fromId;
    nextState.stateValues = applyCompactStateAssignments(runtime.workerScenario.stateVariables, nextState.stateValues, selection.rule.set, selection.matchGroups, runtime.workerScenario.stateVariableDefinitions);
    nextTalk.from = nextFrom;
    nextTalk.turnKey = await nextTalkTurnKey(player.id, talk.id, turnKey, nextFrom);
    const turnHash = await talkTurnHash(player.id, talk.kind, talk.id, turnKey);
    const ownerEvent: import("./store.ts").StoredTalkEvent = {
      id: `${talk.kind}_player_${turnHash}`,
      kind: talk.kind,
      talk_id: talk.id,
      event_type: "player_message",
      body: message,
      block_id: null,
      format_env_json: null,
      delivered_at: now
    };
    const ownerMessage: StoredTalkMessage = {
      seq: nextTalk.lastMessageSeq + 1,
      id: ownerEvent.id,
      talkId: talk.publicId,
      sender: "owner" as const,
      body: message,
      ...(talk.kind === "chat" ? { senderName: "あなた" } : {}),
      attachment: null,
      sentAt: now
    };
    const reply = messagesForTalkOutputSteps({
      talk,
      steps: selection.rule.outputSteps,
      previousCounts: nextTalk.blockDisplayCounts,
      formatEnv: {
        ...effectiveStateValues(runtime.workerScenario.stateVariables, nextState.stateValues),
        ...talkOutputMatchEnv(selection.rule.match, selection.matchGroups)
      },
      baseSentAt: new Date(Date.parse(now) + 1000).toISOString(),
      idPrefix: `${talk.kind}_block_${turnHash}`,
      startSeq: ownerMessage.seq,
      inputVisible: nextTalk.inputVisible,
      inputVisibleAfterSeq: nextTalk.inputVisibleAfterSeq,
      inputEnabled: nextTalk.inputEnabled,
      inputEnabledAfterSeq: nextTalk.inputEnabledAfterSeq,
      useRepeat: selection.rule.mode !== "game_over"
    });
    let talkTranscriptAppends: TranscriptAppend[] = [];
    if (selection.rule.mode !== "game_over") {
      nextTalk.inputVisible = reply.inputVisible;
      nextTalk.inputVisibleAfterSeq = reply.inputVisibleAfterSeq;
      nextTalk.inputEnabled = reply.inputEnabled;
      nextTalk.inputEnabledAfterSeq = reply.inputEnabledAfterSeq;
      nextTalk.blockDisplayCounts = reply.blockDisplayCounts;
      const messages = [ownerMessage, ...reply.messages];
      nextTalk.lastMessageSeq = Math.max(nextTalk.lastMessageSeq, ...messages.map((item) => item.seq));
      nextTalk.lastDeliveredAt = latestTalkDeliveredAt(nextTalk.lastDeliveredAt, [ownerEvent, ...reply.events], messages);
      nextTalk.lastOtherMessageId = [...messages].reverse().find((item) => item.sender === "other")?.id
        ?? nextTalk.lastOtherMessageId;
      const revealed = revealTalkMessages(nextState, talk.id, messages);
      nextState.revealedAttachmentContentIds = revealed.revealedAttachmentContentIds;
      nextState.revealedMessageLinks = revealed.revealedMessageLinks;
      talkTranscriptAppends = [{
        streamId: `talk:${talk.id}`,
        transcriptKey: nextTalk.transcriptKey,
        messages: [ownerEvent, ...reply.events],
        resolvedMessages: messages
      }];
    }
    if (selection.rule.mode === "game_over") {
      const partHooks = await applyHookEvents(c, player.id, nextState, partLoadedEvents(activated.added));
      if (partHooks.rejection)
        return operationResult({ ok: false, error: partHooks.rejection.error, playerState: await stateJson(c, player) }, 422);
      const committed = await commitPlayer(c, player, { state: partHooks.state, transcriptAppends: partHooks.transcriptAppends, hookResults: [partHooks] });
      if (!committed.ok)
        return conflict(c, player);
      if (!localProgress)
        await storeFor(c).recordInputEvent({
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
            loadedParts: player.state.loadedPartIds,
            acquiredParts: committed.player.state.loadedPartIds,
            match: selection.matchGroups,
            outputSteps: selection.rule.outputSteps,
            nextBlocks: selection.rule.nextBlocks,
            messages: reply.messages.map((item) => ({ sender: item.sender, body: item.body }))
          }
        }, dependencies(c).config.playerInputLogging === true).catch((error) => console.error("[player_input_events]", error));
      const gameOverMessages: PublicPresentationTalkMessage[] = [ownerMessage, ...reply.messages].map((item) => {
        const publicMessage = publicTalkMessage(item);
        const { quickReplies: _quickReplies, ...presentationMessage } = publicMessage;
        return {
          ...presentationMessage,
          segments: publicPresentationSegments(presentationMessage),
          kind: talk.kind,
          senderName: talk.kind === "chat" ? item.senderName ?? null : null
        };
      });
      const presentation: PublicPresentationPayload = {
        effects: publicPresentation(partHooks)?.effects ?? [],
        sequence: {
          type: "game_over",
          reasonMessage: "この選択では物語を続けられませんでした。",
          talk: {
            talkId: talk.publicId,
            kind: talk.kind,
            messages: gameOverMessages
          }
        }
      };
      return operationResult({
        ok: true,
        playerState: await stateJson(c, committed.player),
        presentation
      });
    }
    const talkHookResult = await applyHookEvents(c, player.id, nextState, [...partLoadedEvents(activated.added), {
      eventId: "talk_turn_completed",
      talkId: talk.id,
      playerInput: message,
      ruleId: selection.rule.id,
      fields: {
        kind: talk.kind,
        fromId,
        nextFromId: nextFrom,
        ruleId: selection.rule.id
      }
    }], talkTranscriptAppends);
    const hookedState = talkHookResult.state;
    if (!selection.rule.mode && !talkHookResult.rejection && !talkHookResult.presentationSequence)
      runtime.validateTalkContinuation(talk.id, nextFrom, hookedState);
    if (talkHookResult.rejection) {
      return operationResult({ ok: false, error: talkHookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
    }
    const presentation = publicPresentation(talkHookResult);
    const committed = await commitPlayer(c, player, {
      state: hookedState,
      transcriptAppends: [
        ...talkTranscriptAppends,
        ...talkHookResult.transcriptAppends
      ],
      hookResults: [talkHookResult]
    });
    if (!committed.ok)
      return conflict(c, player);
    if (!localProgress)
      await storeFor(c).recordInputEvent({
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
          loadedParts: player.state.loadedPartIds,
          acquiredParts: committed.player.state.loadedPartIds,
          reviewSelection: selection.reviewSelection,
          match: selection.matchGroups,
          outputSteps: selection.rule.outputSteps,
          nextBlocks: selection.rule.nextBlocks,
          messages: reply.messages.map((item) => ({ sender: item.sender, body: item.body }))
        }
      }, dependencies(c).config.playerInputLogging === true).catch((error) => console.error("[player_input_events]", error));
    return operationResult({
      ok: true,
      playerState: await stateJson(c, committed.player),
      ...(presentation ? { presentation } : {})
    });
  };
  operations["POST /api/form/submit"] = async (c) => {
    const resolved = await resolveMutationPlayer(c);
    if (!resolved)
      return operationResult({ ok: false, error: "unauthorized" }, 401);
    if (resolved.interrupted)
      return operationResult({ ok: false, error: "incoming_call_active", playerState: await stateJson(c, resolved.player) }, 409);
    const player = resolved.player;
    const body = c.body;
    const publicFormId = cleanText(body?.formId, 160);
    if (!publicFormId)
      return operationResult({ ok: false, error: "invalid" }, 400);
    const formId = internalFormId(publicFormId);
    if (!formId)
      return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    const formContent = availableFormContent(formId, player.state);
    if (!formContent) {
      return operationResult({ ok: false, error: "not_available", playerState: await stateJson(c, player) }, 409);
    }
    const fields = body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? Object.fromEntries(Object.entries(body.fields as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, value]) => [cleanText(key, 80), cleanText(value, 2000)])
        .filter(([key]) => key))
      : {};
    const hookResult = await applyHookResult(c, player.id, player.state, {
      eventId: "form_submitted",
      formId,
      contentId: formContent.id,
      fields: { ...fields, appId: formContent.appId }
    });
    const nextState = hookResult.state;
    if (hookResult.rejection) {
      return operationResult({ ok: false, error: hookResult.rejection.error, playerState: await stateJson(c, player) }, 422);
    }
    const presentation = publicPresentation(hookResult);
    if (JSON.stringify(nextState) === JSON.stringify(player.state)
      && !hookResult.scheduleEffects.length
      && !hookResult.generatedAudioEffects.length) {
      return operationResult({ ok: true, playerState: await stateJson(c, player), ...(presentation ? { presentation } : {}) });
    }
    const committed = await commitPlayer(c, player, {
      state: nextState,
      transcriptAppends: hookResult.transcriptAppends,
      hookResults: [hookResult]
    });
    if (!committed.ok)
      return conflict(c, player);
    return operationResult({
      ok: true,
      playerState: await stateJson(c, committed.player),
      ...(presentation ? { presentation } : {})
    });
  };
  return {
    keys: Object.keys(operations),
    async execute(key: string, input: PlayerOperationInput, dependencies: PlayerOperationContext["dependencies"]): Promise<PlayerOperationResult> {
      const context: PlayerOperationContext = { ...input, dependencies };
      let result: PlayerOperationResult;
      try {
        const operation = operations[key];
        result = operation ? await operation(context) : operationResult({ ok: false, error: "not_found" }, 404);
      } catch (error) {
        if (error instanceof PlayerNotStartedError) return operationResult({ ok: false, error: "play_not_started" }, 409);
        if (error instanceof StaticResourceError) result = operationResult({ ok: false, error: "static_resource_unavailable", retryable: false }, 502);
        else if (error instanceof BrowserProgressTooLargeError) result = operationResult({ ok: false, error: "browser_progress_too_large" }, 500);
        else if (error instanceof RetryableScheduledEventError) result = operationResult({ ok: false, error: "scheduled_event_unavailable" }, 503);
        else if (error instanceof HookLlmUnavailableError) result = operationResult({ ok: false, error: "llm_unavailable", retryable: true }, 503);
        else if (localProgress) throw error; // ローカル保存の失敗は型を保って呼出元へ返す。
        else result = operationResult({ ok: false, error: "server_error" }, 500);
        console.error("[worker]", error);
      }
      // 操作前に確定した予約／更新差分は、後段の不受理で失わない。
      if (clientProgressMode() && context.committedPlayer && !result.payload.playerState) {
        result.payload.playerState = await stateJson(context, context.committedPlayer);
      }
      return result;
    }
  };
}
