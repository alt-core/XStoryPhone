import { evaluateCondition } from "../../shared/condition.ts";
import type {
  HookFlashEffectOptions,
  HookPresentationEffectOptions,
  ScenarioEventPayload,
  ScenarioHookContext
} from "../../shared/hooks.ts";
import type { StoredTalkMessage } from "../../shared/scenario.ts";
import {
  MAX_SEARCH_AGENT_QUERY_LENGTH,
  SEARCH_AGENT_STREAM_ID,
  SEARCH_AGENT_TALK_ID
} from "../../shared/searchAgent.ts";
import { scenarioHookHandlers } from "../../generated/scenarioHooks.generated.ts";
import { SCENARIO_HOOK_TALK_BLOCKS } from "../../generated/hookContext.generated.ts";
import {
  copyStoredPlayerState,
  sha256,
  type StoredPlayerState,
  type StoredTalkEvent,
  type StoredTranscriptMessage,
  type TranscriptAppend
} from "../../server/store.ts";
import {
  applyTalkInputAction,
  initializeTalkState,
  initializeSearchAgentTalkState,
  initialTalkTurnKey,
  messagesForTalkBlocks,
  isSearchAgentTalk,
  revealTalkMessages,
  restoredTalkHistoryMessages,
  scenarioMessageBlockId,
  searchAgentTimelineForOutputs,
  searchScenario,
  synchronizeInitialTalkLastOtherMessageId,
  talkAvailable,
  talkInputBoundarySeq,
  workerScenario
} from "../scenario.ts";
import type { LlmProviderEnv, StructuredOutputProvider } from "../providers/structuredOutput.ts";
import {
  hookLlmModelVersion,
  hookLlmRequestKey,
  HookLlmUnavailableError,
  normalizeHookLlmMatchRequest,
  normalizeHookLlmRequest,
  resolveHookLlmRequest,
  type HookLlmRequest
} from "./hookLlm.ts";
import {
  applyCompactStateAssignments,
  effectiveStateValues,
  setStateValue,
  stateValue
} from "../stateValues.ts";
import { searchAgentResultEvent } from "../talkEvents.ts";
import { latestTalkDeliveredAt, nextTalkMessageSentAt } from "../talkMessageClock.ts";

type ScenarioPresentationTransition = {
  fadeInMs: number;
  holdMs: number;
  fadeOutMs: number;
  intensity: number;
};

export type ScenarioPresentationEffect =
  | { type: "noise"; durationMs: number }
  | ({ type: "flash"; color: string } & ScenarioPresentationTransition)
  | ({ type: "blackout" } & ScenarioPresentationTransition);

export type ScenarioPresentationSequence =
  | { type: "game_over"; reasonMessage?: string }
  | { type: "all_clear"; appId: string; contentId: string; autoplay: boolean };

export type ScenarioHookResult = {
  state: StoredPlayerState;
  generatedAudioEffects: Array<{ id: string; inputText: string }>;
  scheduleEffects: Array<
    | { type: "queue"; id: string; delayMs: number; eventId: string; fields: Record<string, string> }
    | { type: "cancel"; id: string }
  >;
  transcriptAppends: TranscriptAppend[];
  presentationEffects: ScenarioPresentationEffect[];
  presentationSequence: ScenarioPresentationSequence | null;
  rejection: { error: string } | null;
};

type RecordedEffect =
  | { type: "state.set"; id: string; value: string | number | boolean }
  | { type: "state.apply"; updates: string[] }
  | { type: "incoming.start"; callId: string }
  | { type: "incoming.markCompleted"; callId: string }
  | { type: "incoming.clearActive" }
  | { type: "content.setState"; contentId: string; state: "repaired" | "unlocked"; appId?: string }
  | { type: "app.repair"; appId: string }
  | { type: "talk.addBlock"; talkId: string; blockId: string; formatEnv: Record<string, string>; mode: "advance" | "stay" }
  | { type: "talk.search"; talkId: typeof SEARCH_AGENT_TALK_ID; query: string }
  | { type: "talk.input"; talkId: string; action: "show" | "hide" | "enable" | "disable" }
  | { type: "todo.add"; todoId: string }
  | { type: "todo.remove"; todoId: string }
  | { type: "schedule.after"; scheduleId: string; instanceId: string; delayMs: number; fields: Record<string, string> }
  | { type: "schedule.cancel"; instanceId: string }
  | { type: "genAudio.prepare"; id: string; inputText: string }
  | { type: "presentation.effect"; effect: ScenarioPresentationEffect }
  | { type: "presentation.sequence"; sequence: ScenarioPresentationSequence };

class ScenarioHookPublicRejection extends Error {
  readonly errorCode: string;
  constructor(errorCode: string) {
    super(errorCode);
    this.errorCode = errorCode;
  }
}

class ScenarioHookSequenceEnd extends Error {}

class PendingHookLlmRequest extends Error {
  readonly key: string;
  readonly request: HookLlmRequest;
  constructor(key: string, request: HookLlmRequest) {
    super(`pending_hook_llm:${request.taskId}`);
    this.key = key;
    this.request = request;
  }
}

function appendUnique(items: string[], id: string) {
  return items.includes(id) ? items : [...items, id];
}

function targetForEvent(event: ScenarioEventPayload) {
  if (event.eventId === "scheduled_event") return event.scheduleId ?? "";
  if (event.eventId === "audio_cue_reached") return event.cueTarget ?? "";
  if (event.eventId === "incoming_call_completed") return event.callId ?? "";
  if (event.eventId === "message_link_opened") return event.actionId ?? "";
  if (event.eventId === "talk_turn_completed") return event.talkId ?? "";
  if (event.eventId === "form_submitted") return event.formId ?? "";
  if (["content_repaired", "content_opened", "content_unlocked", "blocked_content_link_opened"].includes(event.eventId)) {
    return event.contentId ?? "";
  }
  return event.scheduleId
    || event.cueTarget
    || event.actionId
    || event.formId
    || event.contentId
    || event.callId
    || event.talkId
    || "";
}

function cleanFields(fields: Record<string, string> = {}) {
  return Object.fromEntries(Object.entries(fields)
    .filter(([key, value]) => key.trim() && typeof value === "string")
    .map(([key, value]) => [key.trim().slice(0, 64), value.slice(0, 1_000)]));
}

const MAX_PRESENTATION_EFFECT_DURATION_MS = 8_000;
const MIN_PRESENTATION_FADE_DURATION_MS = 16;
const DEFAULT_FLASH_EFFECT = {
  fadeInMs: 30,
  holdMs: 40,
  fadeOutMs: 270,
  intensity: 0.9,
  color: "#fffaf2"
} as const;
const DEFAULT_BLACKOUT_EFFECT = {
  fadeInMs: 220,
  holdMs: 180,
  fadeOutMs: 300,
  intensity: 1
} as const;

function noiseDurationMs(value: number | undefined) {
  const fallback = 100;
  return Math.max(0, Math.min(Number.isFinite(value) ? Math.round(value ?? fallback) : fallback, MAX_PRESENTATION_EFFECT_DURATION_MS));
}

function presentationPhaseMs(value: number | undefined, fallback: number, minimum: number) {
  const normalized = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(minimum, Math.min(normalized, MAX_PRESENTATION_EFFECT_DURATION_MS));
}

function capEffectTimings(
  fadeInMs: number,
  holdMs: number,
  fadeOutMs: number
): Pick<ScenarioPresentationTransition, "fadeInMs" | "holdMs" | "fadeOutMs"> {
  const total = fadeInMs + holdMs + fadeOutMs;
  if (total <= MAX_PRESENTATION_EFFECT_DURATION_MS) return { fadeInMs, holdMs, fadeOutMs };

  // 合計だけを縮め、必須の両フェードへ最低1フレーム相当を残す。
  const scale = MAX_PRESENTATION_EFFECT_DURATION_MS / total;
  const normalizedFadeInMs = Math.min(
    MAX_PRESENTATION_EFFECT_DURATION_MS - MIN_PRESENTATION_FADE_DURATION_MS,
    Math.max(MIN_PRESENTATION_FADE_DURATION_MS, Math.round(fadeInMs * scale))
  );
  const normalizedFadeOutMs = Math.min(
    MAX_PRESENTATION_EFFECT_DURATION_MS - normalizedFadeInMs,
    Math.max(MIN_PRESENTATION_FADE_DURATION_MS, Math.round(fadeOutMs * scale))
  );
  return {
    fadeInMs: normalizedFadeInMs,
    holdMs: MAX_PRESENTATION_EFFECT_DURATION_MS - normalizedFadeInMs - normalizedFadeOutMs,
    fadeOutMs: normalizedFadeOutMs
  };
}

function presentationTransition(
  options: HookPresentationEffectOptions | undefined,
  defaults: ScenarioPresentationTransition
): ScenarioPresentationTransition {
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) {
    throw new Error("effect.flash / blackout のoptionsはobjectで指定してください。");
  }
  const input = options ?? {};
  const timings = capEffectTimings(
    presentationPhaseMs(input.fadeInMs, defaults.fadeInMs, MIN_PRESENTATION_FADE_DURATION_MS),
    presentationPhaseMs(input.holdMs, defaults.holdMs, 0),
    presentationPhaseMs(input.fadeOutMs, defaults.fadeOutMs, MIN_PRESENTATION_FADE_DURATION_MS)
  );
  const intensity = typeof input.intensity === "number" && Number.isFinite(input.intensity)
    ? input.intensity
    : defaults.intensity;
  return { ...timings, intensity: Math.max(0, Math.min(intensity, 1)) };
}

function flashColor(value: string | undefined) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^#[0-9a-f]{6}$/u.test(normalized) ? normalized : DEFAULT_FLASH_EFFECT.color;
}

function publicRejectionResult(state: StoredPlayerState, rejection: ScenarioHookPublicRejection): ScenarioHookResult {
  return {
    state,
    generatedAudioEffects: [],
    scheduleEffects: [],
    transcriptAppends: [],
    presentationEffects: [],
    presentationSequence: null,
    rejection: { error: rejection.errorCode }
  };
}

export async function runScenarioHooks(
  state: StoredPlayerState,
  event: ScenarioEventPayload,
  services: {
    playerId?: string;
    llmProvider?: StructuredOutputProvider | null;
    llmEnv?: LlmProviderEnv;
    llmResults?: Map<string, Record<string, string | number | boolean | null>>;
    resolveLlm?: (key: string, request: HookLlmRequest) => Promise<Record<string, string | number | boolean | null>>;
    messageBaseSentAtByTalk?: Readonly<Record<string, string>>;
  } = {}
): Promise<ScenarioHookResult> {
  const effects: RecordedEffect[] = [];
  const recordedEffectResources = new Set<string>();
  let recordedStateValues = { ...state.stateValues };
  const effectiveRecordedState = () => effectiveStateValues(workerScenario.stateVariables, recordedStateValues);
  const llmEnv = services.llmEnv ?? {};
  const llmResults = services.llmResults ?? new Map();
  const configuredMaxRequests = llmEnv.LLM_HOOK_MAX_REQUESTS?.trim();
  const maxRequests = configuredMaxRequests ? Number(configuredMaxRequests) : 5;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new Error("LLM_HOOK_MAX_REQUESTSは1以上の整数にしてください。");
  const nextMessageSentAtByTalk = new Map(Object.entries(services.messageBaseSentAtByTalk ?? {}));
  function resolvedLlmResult(request: HookLlmRequest) {
    const key = hookLlmRequestKey(request, hookLlmModelVersion(llmEnv, request));
    const result = llmResults.get(key);
    if (result) return result;
    throw new PendingHookLlmRequest(key, request);
  }
  const recordStateUpdates = (updates: readonly string[]) => {
    recordedStateValues = applyCompactStateAssignments(
      workerScenario.stateVariables,
      recordedStateValues,
      updates,
      {},
      workerScenario.stateVariableDefinitions
    );
    effects.push({ type: "state.apply", updates: [...updates] });
  };
  const recordTalkBlock = (talkId: string, blockId: string, mode: "advance" | "stay") => {
    const allowedBlocks = SCENARIO_HOOK_TALK_BLOCKS[talkId as keyof typeof SCENARIO_HOOK_TALK_BLOCKS] as readonly string[] | undefined;
    if (!allowedBlocks?.includes(blockId)) throw new Error(`talk.addBlockの指定が不正です: ${talkId}/${blockId}`);
    const block = workerScenario.talkBlocks.find((item) => item.talkId === talkId && item.blockKey === blockId && !item.repeatOf);
    if (!block) throw new Error(`talk.addBlockの指定が不正です: ${talkId}/${blockId}`);
    const formatEnv = Object.fromEntries(
      Object.entries(effectiveRecordedState())
        .filter((entry): entry is [string, string | number | boolean] => (
          ["string", "number", "boolean"].includes(typeof entry[1])
        ))
        .map(([key, value]) => [key, String(value)])
    );
    effects.push({
      type: "talk.addBlock",
      talkId,
      blockId: block.id,
      formatEnv,
      mode
    });
  };
  const recordTalkInput = (talkId: string, action: "show" | "hide" | "enable" | "disable") => {
    if (!workerScenario.talks.some((talk) => talk.id === talkId)) {
      throw new Error(`talk.${action}Inputのtalkが未定義です: ${talkId}`);
    }
    effects.push({ type: "talk.input", talkId, action });
  };
  const assertPresentationEffectAllowed = (type: ScenarioPresentationEffect["type"]) => {
    if (event.eventId === "scheduled_event") throw new Error(`scheduled_eventではeffect.${type}を使用できません。`);
  };
  const recordNoiseEffect = (durationMs?: number) => {
    assertPresentationEffectAllowed("noise");
    effects.push({ type: "presentation.effect", effect: { type: "noise", durationMs: noiseDurationMs(durationMs) } });
  };
  const recordFlashEffect = (options?: HookFlashEffectOptions) => {
    assertPresentationEffectAllowed("flash");
    effects.push({
      type: "presentation.effect",
      effect: {
        type: "flash",
        ...presentationTransition(options, DEFAULT_FLASH_EFFECT),
        color: flashColor(options && typeof options === "object" ? options.color : undefined)
      }
    });
  };
  const recordBlackoutEffect = (options?: HookPresentationEffectOptions) => {
    assertPresentationEffectAllowed("blackout");
    effects.push({
      type: "presentation.effect",
      effect: { type: "blackout", ...presentationTransition(options, DEFAULT_BLACKOUT_EFFECT) }
    });
  };
  const claimEffectResource = (kind: "schedule" | "generated_audio", id: string) => {
    const key = `${kind}:${id}`;
    if (recordedEffectResources.has(key)) {
      throw new Error(`同一hook dispatchで同じ${kind === "schedule" ? "schedule instance" : "generated audio"}を複数回操作できません: ${id}`);
    }
    recordedEffectResources.add(key);
  };
  const endWithPresentationSequence = (sequence: ScenarioPresentationSequence): never => {
    if (event.eventId === "scheduled_event") throw new Error(`scheduled_eventではeffectSequence.${sequence.type}を使用できません。`);
    effects.push({ type: "presentation.sequence", sequence });
    throw new ScenarioHookSequenceEnd();
  };

  const context: ScenarioHookContext = {
    state: {
      get(id) {
        return stateValue(workerScenario.stateVariables, recordedStateValues, id);
      },
      set(id, value) {
        recordedStateValues = setStateValue(
          workerScenario.stateVariables,
          recordedStateValues,
          id,
          value,
          workerScenario.stateVariableDefinitions
        );
        effects.push({ type: "state.set", id, value });
      },
      apply(updates) {
        recordStateUpdates(updates);
      }
    },
    incoming: {
      start(callId) {
        if (!workerScenario.incomingCalls.some((call) => call.id === callId)) throw new Error(`未定義のincomingCallです: ${callId}`);
        effects.push({ type: "incoming.start", callId });
      },
      markCompleted(callId) {
        if (!workerScenario.incomingCalls.some((call) => call.id === callId)) throw new Error(`未定義のincomingCallです: ${callId}`);
        effects.push({ type: "incoming.markCompleted", callId });
      },
      clearActive() {
        effects.push({ type: "incoming.clearActive" });
      }
    },
    content: {
      setState(contentId, contentState, appId) {
        const content = workerScenario.contents.find((item) => item.id === contentId);
        const talk = workerScenario.talks.find((item) => item.id === contentId && !isSearchAgentTalk(item) && item.initialState !== "normal");
        if (!content && !talk) throw new Error(`未定義のcontentです: ${contentId}`);
        if (appId && (content?.appId ?? (talk && !isSearchAgentTalk(talk) ? talk.appId : undefined)) !== appId) {
          throw new Error(`contentのappIdが一致しません: ${contentId}/${appId}`);
        }
        effects.push({ type: "content.setState", contentId, state: contentState, ...(appId ? { appId } : {}) });
      }
    },
    app: {
      repair(appId) {
        if (!workerScenario.apps.some((app) => app.id === appId)) throw new Error(`未定義のappです: ${appId}`);
        effects.push({ type: "app.repair", appId });
      }
    },
    talk: {
      addBlock(talkId, blockId, options = {}) {
        const mode = options.mode ?? "advance";
        if (mode !== "advance" && mode !== "stay") throw new Error(`talk.addBlockのmodeが不正です: ${String(mode)}`);
        recordTalkBlock(talkId, blockId, mode);
      },
      search(talkId: typeof SEARCH_AGENT_TALK_ID, query: string) {
        const normalizedQuery = String(query).normalize("NFC").trim().slice(0, MAX_SEARCH_AGENT_QUERY_LENGTH);
        if (talkId !== SEARCH_AGENT_TALK_ID || !normalizedQuery) throw new Error("talk.searchの指定が不正です。");
        effects.push({ type: "talk.search", talkId, query: normalizedQuery });
      },
      showInput(talkId) {
        recordTalkInput(talkId, "show");
      },
      hideInput(talkId) {
        recordTalkInput(talkId, "hide");
      },
      enableInput(talkId) {
        recordTalkInput(talkId, "enable");
      },
      disableInput(talkId) {
        recordTalkInput(talkId, "disable");
      }
    },
    todo: {
      add(todoId) {
        if (!workerScenario.todos.some((todo) => todo.id === todoId)) throw new Error(`未定義のtodoです: ${todoId}`);
        effects.push({ type: "todo.add", todoId });
      },
      remove(todoId) {
        if (!workerScenario.todos.some((todo) => todo.id === todoId)) throw new Error(`未定義のtodoです: ${todoId}`);
        effects.push({ type: "todo.remove", todoId });
      }
    },
    schedule: {
      after(scheduleId, delayMs, fields = {}, instanceId = scheduleId) {
        if (!scheduleId.trim() || !instanceId.trim() || !Number.isFinite(delayMs) || delayMs < 0) throw new Error("schedule.afterの指定が不正です。");
        if (!workerScenario.hooks.some((hook) => hook.event === "scheduled_event" && hook.target === scheduleId.trim())) {
          throw new Error(`schedule.afterのeventが未定義です: ${scheduleId}`);
        }
        claimEffectResource("schedule", instanceId.trim());
        effects.push({
          type: "schedule.after",
          scheduleId: scheduleId.trim(),
          instanceId: instanceId.trim(),
          delayMs: Math.min(Math.round(delayMs), 365 * 24 * 60 * 60 * 1_000),
          fields: cleanFields(fields)
        });
      },
      cancel(instanceId) {
        if (!instanceId.trim()) throw new Error("schedule.cancelの指定が不正です。");
        claimEffectResource("schedule", instanceId.trim());
        effects.push({ type: "schedule.cancel", instanceId: instanceId.trim() });
      }
    },
    form: {
      deny(error) {
        if (event.eventId === "scheduled_event") {
          throw new Error(`scheduled_eventではform.denyを使用できません: ${event.scheduleInstanceId ?? event.scheduleId ?? "unknown"}`);
        }
        throw new ScenarioHookPublicRejection(error.trim().slice(0, 80) || "message_rejected");
      }
    },
    genAudio: {
      prepare(id, options) {
        if (!workerScenario.generatedAudio.some((audio) => audio.id === id) || !options.inputText.trim()) throw new Error(`genAudio.prepareの指定が不正です: ${id}`);
        claimEffectResource("generated_audio", id);
        effects.push({ type: "genAudio.prepare", id, inputText: options.inputText });
      },
      reject(error) {
        if (event.eventId === "scheduled_event") {
          throw new Error(`scheduled_eventではgenAudio.rejectを使用できません: ${event.scheduleInstanceId ?? event.scheduleId ?? "unknown"}`);
        }
        throw new ScenarioHookPublicRejection(error.trim().slice(0, 80) || "message_rejected");
      }
    },
    llm: {
      extract(taskId, options) {
        return resolvedLlmResult(normalizeHookLlmRequest("extract", taskId, options, event)) as never;
      },
      screen(taskId, options) {
        return resolvedLlmResult(normalizeHookLlmRequest("screen", taskId, options, event)) as never;
      },
      match(taskId, options) {
        return resolvedLlmResult(normalizeHookLlmMatchRequest(taskId, options, event)) as never;
      }
    },
    effect: {
      noise(durationMs) {
        recordNoiseEffect(durationMs);
      },
      flash(options) {
        recordFlashEffect(options);
      },
      blackout(options) {
        recordBlackoutEffect(options);
      }
    },
    effectSequence: {
      gameOver(reasonMessage) {
        const cleanedReasonMessage = reasonMessage?.trim().slice(0, 160);
        return endWithPresentationSequence({
          type: "game_over",
          ...(cleanedReasonMessage ? { reasonMessage: cleanedReasonMessage } : {})
        });
      },
      allClear(appId, contentId, autoplay = true) {
        if (!workerScenario.apps.some((app) => app.id === appId) || !workerScenario.contents.some((content) => content.id === contentId && content.appId === appId)) {
          throw new Error("effectSequence.allClearの対象が不正です。");
        }
        return endWithPresentationSequence({ type: "all_clear", appId, contentId, autoplay });
      }
    }
  };

  const initialStateValues = effectiveStateValues(workerScenario.stateVariables, state.stateValues);
  const target = targetForEvent(event);
  const eligibleHooks = workerScenario.hooks.filter((hook) => (
    hook.event === event.eventId
    && (!hook.target || hook.target === "*" || hook.target === target)
    && evaluateCondition(hook.cond, initialStateValues)
  ));
  try {
    for (const hook of eligibleHooks) {
      const handler = scenarioHookHandlers[hook.handler as keyof typeof scenarioHookHandlers];
      if (!handler) throw new Error(`hook handlerが登録されていません: ${hook.handler}`);
      const returned = (handler as (context: ScenarioHookContext, event: ScenarioEventPayload) => unknown)(context, event);
      if (returned && typeof (returned as { then?: unknown }).then === "function") throw new Error(`hook handlerは同期関数にしてください: ${hook.handler}`);
    }
  } catch (error) {
    if (error instanceof ScenarioHookPublicRejection) return publicRejectionResult(state, error);
    if (error instanceof ScenarioHookSequenceEnd) {
      // terminal presentation sequenceは、それ以前に記録したdomain effectと一緒に適用する。
    } else if (error instanceof PendingHookLlmRequest) {
      // 完走のための再評価は数えず、event内で新たに解決する要求だけを制限する。
      if (llmResults.size >= maxRequests) throw new Error("too_many_llm_hook_requests");
      const output = services.resolveLlm
        ? await services.resolveLlm(error.key, error.request)
        : await (async () => {
            const resolved = await resolveHookLlmRequest(services.llmProvider ?? null, llmEnv, error.request);
            if (resolved instanceof HookLlmUnavailableError) throw resolved;
            return resolved.output;
          })();
      llmResults.set(error.key, output);
      return runScenarioHooks(state, event, { ...services, llmResults });
    } else {
      throw error;
    }
  }

  const nextState = copyStoredPlayerState(state);
  const generatedAudioEffects: ScenarioHookResult["generatedAudioEffects"] = [];
  const scheduleEffects: ScenarioHookResult["scheduleEffects"] = [];
  const transcriptAppends: TranscriptAppend[] = [];
  const presentationEffects: ScenarioPresentationEffect[] = [];
  let presentationSequence: ScenarioPresentationSequence | null = null;
  const initialTurnKeys = new Map<string, string>();

  async function ensureTalk(talkId: string) {
    const definition = workerScenario.talks.find((talk) => talk.id === talkId);
    if (!definition || !talkAvailable(definition, nextState)) return null;
    if (!nextState.talks[talkId]) {
      if (isSearchAgentTalk(definition)) {
        const initial = await initializeSearchAgentTalkState(definition, services.playerId ?? "hook-preview", nextState);
        nextState.talks[talkId] = initial.state;
        const revealed = revealTalkMessages(
          nextState,
          talkId,
          initial.messages.filter((message) => message.type === "message")
        );
        nextState.revealedMessageLinks = revealed.revealedMessageLinks;
        appendTranscript(talkId, initial.events);
        return { definition, state: nextState.talks[talkId] };
      }
      const turnKey = initialTurnKeys.get(talkId)
        ?? await initialTalkTurnKey(services.playerId ?? "hook-preview", talkId, definition.initialFrom);
      initialTurnKeys.set(talkId, turnKey);
      const initial = initializeTalkState(
        definition,
        turnKey,
        effectiveStateValues(workerScenario.stateVariables, nextState.stateValues),
        nextState.repairedContentIds
      );
      nextState.talks[talkId] = initial.state;
      const revealed = revealTalkMessages(nextState, talkId, initial.messages);
      nextState.revealedAttachmentContentIds = revealed.revealedAttachmentContentIds;
      nextState.revealedMessageLinks = revealed.revealedMessageLinks;
    }
    return { definition, state: nextState.talks[talkId] };
  }

  function appendTranscript(talkId: string, events: StoredTranscriptMessage[], messages: StoredTalkMessage[] = []) {
    const talk = nextState.talks[talkId];
    if (!talk || !events.length) return;
    const current = transcriptAppends.find((append) => append.streamId === `talk:${talkId}` && append.transcriptKey === talk.transcriptKey);
    if (current) {
      current.messages.push(...events);
      if (messages.length) current.resolvedMessages = [...(current.resolvedMessages ?? []), ...messages];
    } else {
      transcriptAppends.push({
        streamId: `talk:${talkId}`,
        transcriptKey: talk.transcriptKey,
        messages: [...events],
        ...(messages.length ? { resolvedMessages: [...messages] } : {})
      });
    }
  }

  function repairContent(contentId: string) {
    const content = workerScenario.contents.find((item) => item.id === contentId);
    const talk = workerScenario.talks.find((item) => item.id === contentId && !isSearchAgentTalk(item) && item.initialState !== "normal");
    if (!content && !talk) throw new Error(`未定義のcontentです: ${contentId}`);
    if (nextState.repairedContentIds.includes(contentId)) return;
    const restored = content ? restoredTalkHistoryMessages(nextState, contentId) : null;
    if (restored && !restored.ok) throw new Error(`talk初期履歴を復元できません: ${contentId}/${restored.error}`);
    nextState.repairedContentIds = appendUnique(nextState.repairedContentIds, contentId);
    if (restored?.ok) {
      const revealed = revealTalkMessages(nextState, restored.talk.id, restored.messages);
      nextState.revealedAttachmentContentIds = revealed.revealedAttachmentContentIds;
      nextState.revealedMessageLinks = revealed.revealedMessageLinks;
      synchronizeInitialTalkLastOtherMessageId(nextState, restored.talk.id);
    }
    if (talk) synchronizeInitialTalkLastOtherMessageId(nextState, talk.id);
  }

  for (const effect of effects) {
    if (effect.type === "state.set") {
      nextState.stateValues = setStateValue(
        workerScenario.stateVariables,
        nextState.stateValues,
        effect.id,
        effect.value,
        workerScenario.stateVariableDefinitions
      );
    } else if (effect.type === "state.apply") {
      nextState.stateValues = applyCompactStateAssignments(workerScenario.stateVariables, nextState.stateValues, effect.updates, {}, workerScenario.stateVariableDefinitions);
    } else if (effect.type === "incoming.start") {
      if (!nextState.completedIncomingCallIds.includes(effect.callId)) nextState.incomingCallId = effect.callId;
    } else if (effect.type === "incoming.markCompleted") {
      nextState.completedIncomingCallIds = appendUnique(nextState.completedIncomingCallIds, effect.callId);
      if (nextState.incomingCallId === effect.callId) nextState.incomingCallId = null;
    } else if (effect.type === "incoming.clearActive") {
      nextState.incomingCallId = null;
    } else if (effect.type === "content.setState") {
      repairContent(effect.contentId);
      if (effect.state === "unlocked") nextState.unlockedContentIds = appendUnique(nextState.unlockedContentIds, effect.contentId);
    } else if (effect.type === "app.repair") {
      nextState.repairedAppIds = appendUnique(nextState.repairedAppIds, effect.appId);
    } else if (effect.type === "todo.add") {
      nextState.activeTodoIds = appendUnique(nextState.activeTodoIds, effect.todoId);
    } else if (effect.type === "todo.remove") {
      nextState.activeTodoIds = nextState.activeTodoIds.filter((id) => id !== effect.todoId);
    } else if (effect.type === "schedule.after") {
      scheduleEffects.push({ type: "queue", id: effect.instanceId, delayMs: effect.delayMs, eventId: effect.scheduleId, fields: effect.fields });
    } else if (effect.type === "schedule.cancel") {
      scheduleEffects.push({ type: "cancel", id: effect.instanceId });
    } else if (effect.type === "genAudio.prepare") {
      generatedAudioEffects.push({ id: effect.id, inputText: effect.inputText });
    } else if (effect.type === "presentation.effect") {
      presentationEffects.push(effect.effect);
    } else if (effect.type === "presentation.sequence") {
      presentationSequence = effect.sequence;
    } else if (effect.type === "talk.input") {
      const current = await ensureTalk(effect.talkId);
      if (!current) throw new Error(`hookのtalk.${effect.action}Inputを適用できません: ${effect.talkId}`);
      applyTalkInputAction(current.state, effect.action, talkInputBoundarySeq(current.definition, nextState));
    } else if (effect.type === "talk.addBlock") {
      const current = await ensureTalk(effect.talkId);
      if (!current) throw new Error(`hookのtalk操作を適用できません: ${effect.talkId}`);
      const earliestSentAt = nextMessageSentAtByTalk.get(effect.talkId) ?? new Date().toISOString();
      const baseSentAt = isSearchAgentTalk(current.definition)
        ? earliestSentAt
        : nextTalkMessageSentAt(current.state.lastDeliveredAt, earliestSentAt);
      if (isSearchAgentTalk(current.definition)) {
        const idHash = (await sha256(`${services.playerId ?? "hook-preview"}:search_agent:block:${current.state.transcriptKey}:${current.state.lastMessageSeq + 1}:${effect.blockId}`)).slice(0, 32);
        const rendered = searchAgentTimelineForOutputs({
          outputs: [{ kind: "block", blockId: effect.blockId }],
          previousCounts: current.state.blockDisplayCounts,
          formatEnv: effect.formatEnv,
          startSeq: current.state.lastMessageSeq,
          inputVisible: current.state.inputVisible ?? true,
          inputVisibleAfterSeq: current.state.inputVisibleAfterSeq ?? 0,
          inputEnabled: current.state.inputEnabled ?? true,
          inputEnabledAfterSeq: current.state.inputEnabledAfterSeq ?? 0,
          baseSentAt,
          idPrefix: `search_agent_hook_block_${idHash}`
        });
        current.state.blockDisplayCounts = rendered.blockDisplayCounts;
        current.state.lastMessageSeq = rendered.lastSeq;
        if (effect.mode === "advance") {
          current.state.from = effect.blockId;
          current.state.turnKey = await initialTalkTurnKey(services.playerId ?? "hook-preview", effect.talkId, current.state.from);
        }
        const revealed = revealTalkMessages(
          nextState,
          effect.talkId,
          rendered.messages.filter((message) => message.type === "message")
        );
        nextState.revealedMessageLinks = revealed.revealedMessageLinks;
        appendTranscript(effect.talkId, rendered.events);
        continue;
      }
      const baseId = await scenarioMessageBlockId(services.playerId ?? "hook-preview", current.definition.kind, effect.talkId, effect.blockId);
      // 別hookが共通blockを追加しても保存時に除重されず、同じstateの再評価では同じIDになる。
      const idPrefix = `${baseId}:${(current.state.blockDisplayCounts[effect.blockId] ?? 0) + 1}`;
      const rendered = messagesForTalkBlocks({
        talk: current.definition,
        blockIds: [effect.blockId],
        previousCounts: current.state.blockDisplayCounts,
        formatEnv: effect.formatEnv,
        baseSentAt,
        idPrefix,
        startSeq: current.state.lastMessageSeq,
        singleBlockMessageIds: true
      });
      current.state.lastDeliveredAt = latestTalkDeliveredAt(current.state.lastDeliveredAt, rendered.events, rendered.messages);
      nextMessageSentAtByTalk.set(effect.talkId, nextTalkMessageSentAt(current.state.lastDeliveredAt, baseSentAt));
      current.state.blockDisplayCounts = rendered.blockDisplayCounts;
      current.state.lastMessageSeq = Math.max(current.state.lastMessageSeq, ...rendered.messages.map((message) => message.seq));
      current.state.lastOtherMessageId = [...rendered.messages].reverse().find((message) => message.sender === "other")?.id ?? current.state.lastOtherMessageId;
      if (effect.mode === "advance") {
        current.state.from = effect.blockId;
        current.state.turnKey = await initialTalkTurnKey(services.playerId ?? "hook-preview", effect.talkId, current.state.from);
      }
      const revealed = revealTalkMessages(nextState, effect.talkId, rendered.messages);
      nextState.revealedAttachmentContentIds = revealed.revealedAttachmentContentIds;
      nextState.revealedMessageLinks = revealed.revealedMessageLinks;
      appendTranscript(effect.talkId, rendered.events, rendered.messages);
    } else if (effect.type === "talk.search") {
      const current = await ensureTalk(effect.talkId);
      if (!current || !isSearchAgentTalk(current.definition)) throw new Error(`hookのtalk.searchを適用できません: ${effect.talkId}`);
      const results = searchScenario(effect.query, nextState);
      const seq = current.state.lastMessageSeq + 1;
      const idHash = (await sha256(`${services.playerId ?? "hook-preview"}:search_agent:search:${current.state.transcriptKey}:${seq}:${effect.query}`)).slice(0, 32);
      const event = searchAgentResultEvent({
        id: `search_agent_hook_search_${idHash}`,
        seq,
        query: effect.query,
        results,
        deliveredAt: nextMessageSentAtByTalk.get(effect.talkId) ?? new Date().toISOString()
      });
      current.state.lastMessageSeq = seq;
      nextState.discoveredTargetKeys = [...new Set([
        ...nextState.discoveredTargetKeys,
        ...results.filter((result) => result.repairable !== false).map((result) => `${result.appId}:${result.contentId}`)
      ])];
      appendTranscript(effect.talkId, [event]);
    }
  }
  return {
    state: nextState,
    generatedAudioEffects,
    scheduleEffects,
    transcriptAppends,
    presentationEffects,
    presentationSequence,
    rejection: null
  };
}
