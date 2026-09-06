import type { StoredTalkMessage } from "../shared/scenario.ts";
import {
  MAX_SEARCH_AGENT_DISPLAY_ITEMS,
  SEARCH_AGENT_STREAM_ID,
  SEARCH_AGENT_TALK_ID
} from "../shared/searchAgent.ts";

export type StoredTalkEvent = {
  id: string;
  kind: "sms" | "chat";
  talk_id: string;
  event_type: "player_message" | "message_block";
  body: string | null;
  block_id: string | null;
  format_env_json: string | null;
  delivered_at: string;
};

export type StoredSearchResult = {
  contentId: string;
  appId: string;
  targetKind: "app" | "content" | "talk_history";
  targetTalkId?: string;
  title?: string;
  thumbnailUrl?: string;
  repairable: boolean;
};

type StoredSearchAgentEventBase = {
  id: string;
  kind: "search_agent";
  talk_id: typeof SEARCH_AGENT_TALK_ID;
  seq: number;
  delivered_at: string;
};

export type StoredSearchAgentPlayerMessageEvent = StoredSearchAgentEventBase & {
  event_type: "player_message";
  body: string;
};

export type StoredSearchAgentMessageBlockEvent = StoredSearchAgentEventBase & {
  event_type: "message_block";
  base_block_id: string;
  display_block_id: string;
  message_index: number;
  format_env_json: string | null;
};

export type StoredSearchAgentResultEvent = StoredSearchAgentEventBase & {
  event_type: "search_result";
  query: string;
  found: boolean;
  results_json: string;
};

export type StoredSearchAgentEvent =
  | StoredSearchAgentPlayerMessageEvent
  | StoredSearchAgentMessageBlockEvent
  | StoredSearchAgentResultEvent;

export class SearchAgentTranscriptConflictError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "SearchAgentTranscriptConflictError";
  }
}

export function isSearchAgentTranscriptConflictError(error: unknown): error is SearchAgentTranscriptConflictError {
  return error instanceof SearchAgentTranscriptConflictError;
}

export type StoredTalkHistorySlot = {
  repairId: string;
  startSeq: number;
  messageCount: number;
  blockIndex: number;
};

export type StoredTalkState = {
  from: string;
  turnKey: string;
  blockDisplayCounts: Record<string, number>;
  transcriptKey: string;
  lastMessageSeq: number;
  lastDeliveredAt: string;
  lastOtherMessageId: string;
  historySlots: StoredTalkHistorySlot[];
  initialHistoryLastSeq: number;
  initialVisibleLastSeq: number;
  initialFormatEnv: Record<string, string>;
  inputVisible: boolean;
  inputVisibleAfterSeq: number;
  inputEnabled: boolean;
  inputEnabledAfterSeq: number;
};

export type StoredTranscriptMessage = StoredTalkEvent | StoredSearchAgentEvent;

export type StoredTranscript = {
  streamId: string;
  transcriptKey: string;
  messages: StoredTranscriptMessage[];
  resolvedMessages?: StoredTalkMessage[];
};

// 完成履歴ではなく、このmutationで追加する差分だけを表す。
export type TranscriptAppend = StoredTranscript;

export type RevealedMessageLink = {
  id: string;
  talkId: string;
  appId: string;
  contentId: string;
  actionId?: string;
};

export type BrowserScheduledEvent = {
  scheduleId: string;
  eventId: string;
  fields: Record<string, string>;
  dueAt: string;
};

export type StoredPlayerState = {
  repairedContentIds: string[];
  repairedAppIds: string[];
  unlockedContentIds: string[];
  activeTodoIds: string[];
  clearedNotificationIds: string[];
  discoveredTargetKeys: string[];
  revealedAttachmentContentIds: string[];
  revealedMessageLinks: RevealedMessageLink[];
  stateValues: Record<string, string | number | boolean>;
  talks: Record<string, StoredTalkState>;
  talkReadCursors: Record<string, string>;
  incomingCallId: string | null;
  completedIncomingCallIds: string[];
  browserScheduledEvents: BrowserScheduledEvent[];
};

export type PlayerRecord = {
  id: string;
  state: StoredPlayerState;
  stateVersion: number;
  transcriptDeltas?: TranscriptAppend[];
};

export type ScheduledEvent = {
  id: string;
  scheduleId: string;
  eventId: string;
  fields: Record<string, string>;
};

export type InputEventRecord = {
  playerId: string;
  requestKey: string;
  appId?: string;
  talkId?: string;
  fromId?: string;
  userInput: string;
  status: string;
  matched: boolean;
  ruleId?: string;
  nextFromId?: string;
  responseSnapshot?: Record<string, unknown>;
};

export type PlayerInputReviewEvent = {
  id: string;
  playerId: string;
  occurredAt: string;
  appId: string | null;
  talkId: string | null;
  fromId: string | null;
  userInput: string;
  status: string;
  matched: boolean;
  ruleId: string | null;
  nextFromId: string | null;
  responseSnapshot: Record<string, unknown>;
};

export type GeneratedAudioJob = {
  id: string;
  audioId: string;
  provider: string;
  externalJobId: string | null;
  inputHash: string;
  inputText: string | null;
  outputKey: string | null;
  status: "queued" | "running" | "ready" | "failed";
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type StoreScheduleEffect =
  | { type: "queue"; id: string; eventId: string; fields: Record<string, string>; dueAt: string }
  | { type: "cancel"; id: string };

export type InitialScheduledEvent = {
  id: string;
  eventId: string;
  fields: Record<string, string>;
  dueAt: string;
};

export type PlayerCommitEffects = {
  schedules?: readonly StoreScheduleEffect[];
  generatedAudioJobs?: readonly GeneratedAudioJob[];
};

export type ReviewJudgmentStatus = "open" | "reported" | "applied" | "dismissed";

export type ReviewJudgment = {
  id: string;
  scope: string;
  sourceEventIds: string[];
  clusterId: string | null;
  talkId: string;
  fromId: string;
  actualRuleId: string | null;
  expectedRuleId: string | null;
  judgment: string;
  comment: string;
  newBranchNote: string;
  reviewerLabel: string;
  scenarioRevision: string;
  status: ReviewJudgmentStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReviewInputEvent = {
  id: string;
  ruleId: string;
  userInput: string;
  normalizedInput: string;
  responseSnapshot: Record<string, unknown>;
};

export type ReviewTrialInput = {
  id: string;
  actualRuleId: string;
  userInput: string;
};

export type HookLlmCacheRecord = {
  cacheKey: string;
  taskId: string;
  kind: string;
  modelVersion: string;
  inputHash: string;
  promptHash: string;
  schemaHash: string;
  status: "ready" | "fallback";
  output: Record<string, string | number | boolean | null>;
  errorCode: string | null;
  expiresAt: string;
};

export type ReviewCluster = {
  id: string;
  actualRuleId: string;
  fit: "blue" | "yellow" | "red";
  representativeInput: string;
  inputCount: number;
  sourceEventIds: string[];
  inputsJson: string;
};

export type ReviewClusterReplacement = {
  id: string;
  fit: ReviewCluster["fit"];
  representativeInput: string;
  sourceEventIds: string[];
  summaryJson: string;
  analysisVersion: string;
};

export type ReviewJudgmentFilter =
  | { talkId: string; fromId: string; status?: ReviewJudgmentStatus }
  | { status: ReviewJudgmentStatus };

export interface AppStore {
  createPasscodeSession(
    accessCode: string,
    initialState: StoredPlayerState,
    initialSchedules: readonly InitialScheduledEvent[]
  ): Promise<{
    playerId: string;
    sessionToken: string;
    created: boolean;
  }>;
  playerForSession(sessionToken: string): Promise<PlayerRecord | null>;
  isAccessCodeLocked(counter: string, at: string): Promise<boolean>;
  recordAccessCodeAttempt(counter: string, success: boolean, at: string): Promise<void>;
  loadTranscript(playerId: string, streamId: string, transcriptKey: string): Promise<StoredTranscript>;
  savePlayer(player: PlayerRecord, nextState: StoredPlayerState, transcripts?: TranscriptAppend[], effects?: PlayerCommitEffects): Promise<boolean>;
  clearPlayerRuntimeJobs(playerId: string): Promise<void>;
  loadHookLlmResult?(playerId: string, cacheKey: string, at: string): Promise<HookLlmCacheRecord | null>;
  saveHookLlmResultIfAbsent?(playerId: string, record: HookLlmCacheRecord): Promise<HookLlmCacheRecord>;
  clearHookLlmResults?(playerId: string): Promise<void>;
  cleanupExpiredHookLlmResults?(at: string, limit: number): Promise<void>;

  queueScheduledEvent(playerId: string, scheduleId: string, eventId: string, fields: Record<string, string>, dueAt: string): Promise<void>;
  cancelScheduledEvent(playerId: string, scheduleId: string): Promise<void>;
  nextScheduledWakeAt(playerId: string): Promise<string | null>;
  dueScheduledEvents(playerId: string, at: string): Promise<ScheduledEvent[]>;
  claimScheduledEvent(playerId: string, id: string): Promise<boolean>;
  completeScheduledEvent(playerId: string, id: string): Promise<void>;
  requeueScheduledEvent(playerId: string, id: string): Promise<void>;

  recordInputEvent(event: InputEventRecord, enabled: boolean): Promise<void>;
  playerInputEvents(filters: {
    playerId?: string;
    talkId?: string;
    query?: string;
    limit: number;
  }): Promise<PlayerInputReviewEvent[]>;

  generatedAudioJob(playerId: string, audioId: string): Promise<GeneratedAudioJob | null>;
  saveGeneratedAudioJob(playerId: string, job: GeneratedAudioJob): Promise<void>;
  generatedAudioJobs(playerId: string): Promise<GeneratedAudioJob[]>;

  reviewJudgments(filter: ReviewJudgmentFilter): Promise<ReviewJudgment[]>;
  reviewInputEvents(talkId: string, fromId: string): Promise<ReviewInputEvent[]>;
  reviewTrialInputs(talkId: string, fromId: string): Promise<ReviewTrialInput[]>;
  reviewClusters(talkId: string, fromId: string, scenarioRevision: string): Promise<ReviewCluster[]>;
  replaceReviewClusters(
    talkId: string,
    fromId: string,
    actualRuleId: string,
    scenarioRevision: string,
    clusters: ReviewClusterReplacement[]
  ): Promise<void>;
  saveReviewTrialInput(input: {
    id: string;
    talkId: string;
    fromId: string;
    actualRuleId: string;
    userInput: string;
    nextFromId: string;
    responseSnapshot: Record<string, unknown>;
    createdAt: string;
  }): Promise<void>;
  saveReviewJudgment(judgment: ReviewJudgment): Promise<void>;
  updateReviewJudgment(talkId: string, fromId: string, id: string, input: { comment: string; newBranchNote: string; reviewerLabel: string; updatedAt: string }): Promise<void>;
  updateReviewJudgmentStatus(talkId: string, fromId: string, id: string, status: ReviewJudgmentStatus, updatedAt: string): Promise<void>;
  deleteReviewTrialInput(talkId: string, fromId: string, id: string, updatedAt: string): Promise<boolean>;
  updateReviewJudgmentSourceIds(talkId: string, fromId: string, id: string, sourceEventIds: string[], updatedAt: string): Promise<void>;
}

export type AppConfig = {
  appEnv?: string;
  adminReviewSecret?: string;
  browserStateSecret?: string;
  accessCodeSecret?: string;
  playerInputLogging?: boolean;
  llmResultRetentionDays?: number;
  llm: {
    LLM_API_KEY?: string;
    LLM_MODEL?: string;
    LLM_BASE_URL?: string;
    LLM_TIMEOUT_MS?: string;
    LLM_REASONING_EFFORT?: string;
    LLM_PROFILE_FAST_MODEL?: string;
    LLM_PROFILE_FAST_REASONING_EFFORT?: string;
    LLM_PROFILE_FAST_TIMEOUT_MS?: string;
    LLM_PROFILE_SUPER_MODEL?: string;
    LLM_PROFILE_SUPER_REASONING_EFFORT?: string;
    LLM_PROFILE_SUPER_TIMEOUT_MS?: string;
    LLM_PROFILE_ULTRA_MODEL?: string;
    LLM_PROFILE_ULTRA_REASONING_EFFORT?: string;
    LLM_PROFILE_ULTRA_TIMEOUT_MS?: string;
    LLM_ANALYTICS_ENABLED?: string;
    LLM_DEBUG_LOGS?: string;
  };
};

export type AppDependencies = {
  store: AppStore;
  config: AppConfig;
};

export type ServerEnv = { Variables: { dependencies: AppDependencies } };

export const SCHEDULED_EVENT_LEASE_MS = 5 * 60 * 1_000;
export const MAX_SESSIONS_PER_PLAYER = 5;
export const DYNAMO_PLAYER_STATE_WARNING_BYTES = 300 * 1024;
export function isStoredSearchAgentEvent(value: unknown): value is StoredSearchAgentEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<StoredSearchAgentEvent> & Record<string, unknown>;
  if (event.kind !== "search_agent"
    || event.talk_id !== SEARCH_AGENT_TALK_ID
    || typeof event.id !== "string"
    || !event.id
    || typeof event.seq !== "number"
    || !Number.isInteger(event.seq)
    || event.seq <= 0
    || typeof event.delivered_at !== "string"
    || !event.delivered_at) return false;
  if (event.event_type === "player_message") return typeof event.body === "string";
  if (event.event_type === "message_block") {
    return typeof event.base_block_id === "string"
      && Boolean(event.base_block_id)
      && typeof event.display_block_id === "string"
      && Boolean(event.display_block_id)
      && typeof event.message_index === "number"
      && Number.isInteger(event.message_index)
      && event.message_index >= 0
      && (event.format_env_json === null || typeof event.format_env_json === "string");
  }
  if (event.event_type === "search_result") {
    if (typeof event.query !== "string"
      || typeof event.found !== "boolean"
      || typeof event.results_json !== "string") return false;
    try {
      const results = JSON.parse(event.results_json) as unknown;
      return Array.isArray(results) && event.found === (results.length > 0);
    } catch {
      return false;
    }
  }
  return false;
}

function stableComparableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item);
}

function normalizedSearchAgentEvents(messages: readonly StoredTranscriptMessage[]) {
  const events = messages.map((message) => {
    if (!isStoredSearchAgentEvent(message)) throw new Error("search_agent_transcript_invalid");
    return message;
  }).sort((left, right) => left.seq - right.seq);
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].seq !== events[index - 1].seq + 1) throw new Error("search_agent_transcript_seq_gap");
  }
  return events;
}

function limitedSearchAgentEvents(events: readonly StoredSearchAgentEvent[]) {
  return events.slice(-MAX_SEARCH_AGENT_DISPLAY_ITEMS);
}

export function limitedTranscript(transcript: StoredTranscript): StoredTranscript {
  if (transcript.streamId !== SEARCH_AGENT_STREAM_ID) return transcript;
  return { ...transcript, messages: limitedSearchAgentEvents(normalizedSearchAgentEvents(transcript.messages)) };
}

export function mergeTranscriptAppend(current: StoredTranscript, append: TranscriptAppend): StoredTranscript {
  if (append.streamId === SEARCH_AGENT_STREAM_ID) {
    const incoming = normalizedSearchAgentEvents(append.messages);
    if (current.transcriptKey !== append.transcriptKey || !current.messages.length) {
      if (incoming.length && incoming[0].seq !== 1) throw new SearchAgentTranscriptConflictError("search_agent_transcript_initial_seq_invalid");
      return limitedTranscript({ ...append, messages: incoming });
    }
    const existing = normalizedSearchAgentEvents(current.messages);
    const firstStoredSeq = existing[0]?.seq ?? 1;
    const bySeq = new Map(existing.map((event) => [event.seq, event]));
    let maxSeq = existing[existing.length - 1]?.seq ?? 0;
    for (const event of incoming) {
      const previous = bySeq.get(event.seq);
      if (previous) {
        if (stableComparableJson(previous) !== stableComparableJson(event)) {
          throw new SearchAgentTranscriptConflictError("search_agent_transcript_seq_conflict");
        }
        continue;
      }
      if (event.seq < firstStoredSeq) continue;
      if (event.seq !== maxSeq + 1) throw new SearchAgentTranscriptConflictError("search_agent_transcript_seq_gap");
      bySeq.set(event.seq, event);
      maxSeq = event.seq;
    }
    return limitedTranscript({
      ...append,
      messages: [...bySeq.values()].sort((left, right) => left.seq - right.seq)
    });
  }
  if (append.messages.some((message) => message.kind === "search_agent")) throw new Error("search_agent_transcript_stream_invalid");
  if (current.transcriptKey !== append.transcriptKey) return { ...append, messages: [...append.messages] };
  if (current.messages.some((message) => message.kind === "search_agent")) throw new Error("search_agent_transcript_stream_invalid");
  const byKey = new Map(current.messages.map((message) => [`event:${message.id}`, message]));
  for (const message of append.messages) {
    if (message.kind === "search_agent") throw new Error("search_agent_transcript_stream_invalid");
    const key = `event:${message.id}`;
    if (!byKey.has(key)) byKey.set(key, message);
  }
  return {
    streamId: append.streamId,
    transcriptKey: append.transcriptKey,
    messages: [...byKey.values()].sort((left, right) => (
      left.delivered_at.localeCompare(right.delivered_at) || left.id.localeCompare(right.id)
    ))
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function scheduledEventLeaseCutoff(at: string) {
  return new Date(Date.parse(at) - SCHEDULED_EVENT_LEASE_MS).toISOString();
}

export function scheduledEventLeaseWakeAt(updatedAt: string) {
  return new Date(Date.parse(updatedAt) + SCHEDULED_EVENT_LEASE_MS).toISOString();
}

function finiteNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function transcriptKey(value: unknown) {
  return typeof value === "string" && value.trim() ? value : crypto.randomUUID();
}

export function normalizeStoredState(value: StoredPlayerState): StoredPlayerState {
  const rawTalks = value.talks ?? {};
  const talks = Object.fromEntries(Object.entries(rawTalks).map(([talkId, talk]) => {
    const key = transcriptKey(talk.transcriptKey);
    return [talkId, {
      from: typeof talk.from === "string" ? talk.from : "",
      turnKey: typeof talk.turnKey === "string" ? talk.turnKey : "",
      blockDisplayCounts: talk.blockDisplayCounts ?? {},
      transcriptKey: key,
      lastMessageSeq: finiteNonNegativeInteger(talk.lastMessageSeq),
      lastDeliveredAt: typeof talk.lastDeliveredAt === "string" && Number.isFinite(Date.parse(talk.lastDeliveredAt))
        ? new Date(talk.lastDeliveredAt).toISOString()
        : "",
      lastOtherMessageId: typeof talk.lastOtherMessageId === "string" ? talk.lastOtherMessageId : "",
      historySlots: Array.isArray(talk.historySlots)
        ? talk.historySlots.flatMap((slot) => (
            slot
            && typeof slot.repairId === "string"
            && slot.repairId
            && Number.isInteger(slot.startSeq)
            && slot.startSeq > 0
            && Number.isInteger(slot.messageCount)
            && slot.messageCount > 0
            && Number.isInteger(slot.blockIndex)
            && slot.blockIndex >= 0
              ? [{ ...slot }]
              : []
          ))
        : [],
      initialHistoryLastSeq: finiteNonNegativeInteger(talk.initialHistoryLastSeq),
      initialVisibleLastSeq: finiteNonNegativeInteger(talk.initialVisibleLastSeq),
      initialFormatEnv: talk.initialFormatEnv && typeof talk.initialFormatEnv === "object"
        ? Object.fromEntries(Object.entries(talk.initialFormatEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {},
      inputVisible: talk.inputVisible !== false,
      inputVisibleAfterSeq: isNonNegativeInteger(talk.inputVisibleAfterSeq) ? talk.inputVisibleAfterSeq : 0,
      inputEnabled: talk.inputEnabled !== false,
      inputEnabledAfterSeq: isNonNegativeInteger(talk.inputEnabledAfterSeq) ? talk.inputEnabledAfterSeq : 0
    } satisfies StoredTalkState];
  }));
  return {
    repairedContentIds: value.repairedContentIds ?? [],
    repairedAppIds: value.repairedAppIds ?? [],
    unlockedContentIds: value.unlockedContentIds ?? [],
    activeTodoIds: value.activeTodoIds ?? [],
    clearedNotificationIds: value.clearedNotificationIds ?? [],
    discoveredTargetKeys: value.discoveredTargetKeys ?? [],
    revealedAttachmentContentIds: value.revealedAttachmentContentIds ?? [],
    revealedMessageLinks: value.revealedMessageLinks ?? [],
    stateValues: value.stateValues ?? {},
    talks,
    talkReadCursors: value.talkReadCursors ?? {},
    incomingCallId: value.incomingCallId ?? null,
    completedIncomingCallIds: Array.isArray(value.completedIncomingCallIds)
      ? [...new Set(value.completedIncomingCallIds.filter((id): id is string => typeof id === "string"))]
      : [],
    browserScheduledEvents: value.browserScheduledEvents ?? []
  };
}

export function copyStoredPlayerState(state: StoredPlayerState): StoredPlayerState {
  return {
    repairedContentIds: [...state.repairedContentIds],
    repairedAppIds: [...state.repairedAppIds],
    unlockedContentIds: [...state.unlockedContentIds],
    activeTodoIds: [...state.activeTodoIds],
    clearedNotificationIds: [...state.clearedNotificationIds],
    discoveredTargetKeys: [...state.discoveredTargetKeys],
    revealedAttachmentContentIds: [...state.revealedAttachmentContentIds],
    revealedMessageLinks: state.revealedMessageLinks.map((link) => ({ ...link })),
    stateValues: { ...state.stateValues },
    talks: Object.fromEntries(Object.entries(state.talks).map(([talkId, talk]) => [
      talkId,
      {
        ...talk,
        blockDisplayCounts: { ...talk.blockDisplayCounts },
        historySlots: talk.historySlots.map((slot) => ({ ...slot })),
        initialFormatEnv: { ...talk.initialFormatEnv },
        inputVisible: talk.inputVisible !== false,
        inputVisibleAfterSeq: isNonNegativeInteger(talk.inputVisibleAfterSeq) ? talk.inputVisibleAfterSeq : 0,
        inputEnabled: talk.inputEnabled !== false,
        inputEnabledAfterSeq: isNonNegativeInteger(talk.inputEnabledAfterSeq) ? talk.inputEnabledAfterSeq : 0
      }
    ])),
    talkReadCursors: { ...state.talkReadCursors },
    incomingCallId: state.incomingCallId,
    completedIncomingCallIds: [...state.completedIncomingCallIds],
    browserScheduledEvents: state.browserScheduledEvents.map((event) => ({ ...event, fields: { ...event.fields } }))
  };
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function storedPlayerStateBytes(state: StoredPlayerState) {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
}

export function storedTranscriptBytes(transcript: StoredTranscript) {
  return new TextEncoder().encode(JSON.stringify(transcript)).byteLength;
}
