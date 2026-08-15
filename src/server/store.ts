import type { StoredTalkMessage } from "../shared/scenario.ts";

export type StoredTalkState = {
  from: string;
  turnKey: string;
  blockDisplayCounts: Record<string, number>;
  transcriptKey: string;
  lastMessageSeq: number;
  lastOtherMessageSeq: number;
  lastReadMessageSeq: number;
};

export type StoredSearchAgentMessage = {
  seq: number;
  id: string;
  requestId: string;
  role: "user" | "assistant";
  body: string;
  results?: Array<{
    contentId: string;
    appId: string;
    targetKind: "app" | "content";
    title?: string;
    thumbnailUrl?: string;
    repairable?: boolean;
  }>;
  sentAt: string;
};

export type StoredTranscriptMessage = StoredTalkMessage | StoredSearchAgentMessage;

export type StoredTranscript = {
  streamId: string;
  transcriptKey: string;
  messages: StoredTranscriptMessage[];
};

export type TranscriptUpdate = StoredTranscript;

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
  openedContentIds: string[];
  unlockedContentIds: string[];
  clearedTodoIds: string[];
  clearedNotificationIds: string[];
  discoveredTargetKeys: string[];
  revealedAttachmentContentIds: string[];
  revealedMessageLinks: RevealedMessageLink[];
  stateValues: Record<string, string | number | boolean>;
  talks: Record<string, StoredTalkState>;
  searchTranscriptKey: string;
  searchLastMessageSeq: number;
  incomingCallId: string | null;
  browserScheduledEvents: BrowserScheduledEvent[];
};

export type PlayerRecord = {
  id: string;
  state: StoredPlayerState;
  stateVersion: number;
  legacyTranscripts?: TranscriptUpdate[];
  transcriptDeltas?: TranscriptUpdate[];
};

export type ScheduledEvent = {
  id: string;
  scheduleId: string;
  eventId: string;
  fields: Record<string, string>;
};

export type InputEventRecord = {
  eventType: "search" | "talk_send";
  playerId: string;
  requestKey: string;
  appId: string;
  talkId?: string;
  fromId?: string;
  userInput: string;
  status: string;
  matched: boolean;
  ruleId?: string;
  nextFromId?: string;
  responseSnapshot?: Record<string, unknown>;
};

export type GeneratedAudioJob = {
  id: string;
  audioId: string;
  provider: string;
  externalJobId: string | null;
  inputHash: string;
  outputKey: string | null;
  status: "queued" | "running" | "ready" | "failed";
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
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
};

export type ReviewTrialInput = {
  id: string;
  actualRuleId: string;
  userInput: string;
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
  createPasscodeSession(accessCode: string, initialState: StoredPlayerState): Promise<{
    playerId: string;
    sessionToken: string;
    created: boolean;
  }>;
  playerForSession(sessionToken: string): Promise<PlayerRecord | null>;
  loadTranscript(playerId: string, streamId: string, transcriptKey: string): Promise<StoredTranscript>;
  savePlayer(player: PlayerRecord, nextState: StoredPlayerState, transcripts?: TranscriptUpdate[]): Promise<boolean>;
  clearPlayerRuntimeJobs(playerId: string): Promise<void>;

  queueScheduledEvent(playerId: string, scheduleId: string, eventId: string, fields: Record<string, string>, dueAt: string): Promise<void>;
  cancelScheduledEvent(playerId: string, scheduleId: string): Promise<void>;
  nextScheduledWakeAt(playerId: string): Promise<string | null>;
  dueScheduledEvents(playerId: string, at: string): Promise<ScheduledEvent[]>;
  claimScheduledEvent(playerId: string, id: string): Promise<boolean>;
  completeScheduledEvent(playerId: string, id: string): Promise<void>;
  requeueScheduledEvent(playerId: string, id: string): Promise<void>;

  recordInputEvent(event: InputEventRecord, enabled: boolean): Promise<void>;

  generatedAudioJob(playerId: string, audioId: string): Promise<GeneratedAudioJob | null>;
  saveGeneratedAudioJob(playerId: string, job: GeneratedAudioJob): Promise<void>;
  pendingGeneratedAudioJobs(playerId: string): Promise<GeneratedAudioJob[]>;
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
  playerInputLogging?: boolean;
  llm: {
    LLM_API_KEY?: string;
    LLM_MODEL?: string;
    LLM_BASE_URL?: string;
    LLM_TIMEOUT_MS?: string;
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

function transcriptKey(value: unknown) {
  return typeof value === "string" && value.trim() ? value : crypto.randomUUID();
}

export function normalizeStoredPlayerState(value: StoredPlayerState): {
  state: StoredPlayerState;
  legacyTranscripts: TranscriptUpdate[];
} {
  const legacyTranscripts: TranscriptUpdate[] = [];
  const rawTalks = value.talks ?? {};
  const talks = Object.fromEntries(Object.entries(rawTalks).map(([talkId, talk]) => {
    const rawMessages = Array.isArray((talk as StoredTalkState & { messages?: StoredTalkMessage[] }).messages)
      ? (talk as StoredTalkState & { messages: StoredTalkMessage[] }).messages
      : [];
    const messages = rawMessages.map((message, index) => ({
      ...message,
      seq: finiteNonNegativeInteger(message.seq) || index + 1
    }));
    const key = transcriptKey(talk.transcriptKey);
    const lastMessageSeq = Math.max(
      finiteNonNegativeInteger(talk.lastMessageSeq),
      ...messages.map((message) => message.seq)
    );
    const lastOtherMessageSeq = Math.max(
      finiteNonNegativeInteger(talk.lastOtherMessageSeq),
      ...messages.filter((message) => message.sender === "other").map((message) => message.seq)
    );
    const legacyLastReadMessageId = (talk as StoredTalkState & { lastReadMessageId?: string | null }).lastReadMessageId;
    const legacyLastReadMessageSeq = messages.find((message) => message.id === legacyLastReadMessageId)?.seq ?? 0;
    if (messages.length) {
      legacyTranscripts.push({ streamId: `talk:${talkId}`, transcriptKey: key, messages });
    }
    return [talkId, {
      from: typeof talk.from === "string" ? talk.from : "",
      turnKey: typeof talk.turnKey === "string" ? talk.turnKey : "",
      blockDisplayCounts: talk.blockDisplayCounts ?? {},
      transcriptKey: key,
      lastMessageSeq,
      lastOtherMessageSeq,
      lastReadMessageSeq: Math.max(finiteNonNegativeInteger(talk.lastReadMessageSeq), legacyLastReadMessageSeq)
    } satisfies StoredTalkState];
  }));
  const legacySearchMessages = Array.isArray((value as StoredPlayerState & { searchAgentMessages?: StoredSearchAgentMessage[] }).searchAgentMessages)
    ? (value as StoredPlayerState & { searchAgentMessages: StoredSearchAgentMessage[] }).searchAgentMessages
    : [];
  const searchMessages = legacySearchMessages.map((message, index) => ({
    ...message,
    seq: finiteNonNegativeInteger(message.seq) || index + 1
  }));
  const searchTranscriptKey = transcriptKey(value.searchTranscriptKey);
  if (searchMessages.length) {
    legacyTranscripts.push({ streamId: "search", transcriptKey: searchTranscriptKey, messages: searchMessages });
  }
  const legacyDiscoveredTargetKeys = searchMessages.flatMap((message) =>
    message.role === "assistant"
      ? (message.results ?? [])
          .filter((result) => result.repairable !== false)
          .map((result) => `${result.appId}:${result.contentId}`)
      : []
  );
  return {
    state: {
    repairedContentIds: value.repairedContentIds ?? [],
    repairedAppIds: value.repairedAppIds ?? [],
    openedContentIds: value.openedContentIds ?? [],
    unlockedContentIds: value.unlockedContentIds ?? [],
    clearedTodoIds: value.clearedTodoIds ?? [],
    clearedNotificationIds: value.clearedNotificationIds ?? [],
    discoveredTargetKeys: [...new Set([...(value.discoveredTargetKeys ?? []), ...legacyDiscoveredTargetKeys])],
    revealedAttachmentContentIds: value.revealedAttachmentContentIds ?? [],
    revealedMessageLinks: value.revealedMessageLinks ?? [],
    stateValues: value.stateValues ?? {},
    talks,
    searchTranscriptKey,
    searchLastMessageSeq: Math.max(
      finiteNonNegativeInteger(value.searchLastMessageSeq),
      ...searchMessages.map((message) => message.seq)
    ),
    incomingCallId: value.incomingCallId ?? null,
    browserScheduledEvents: value.browserScheduledEvents ?? []
    },
    legacyTranscripts
  };
}

export function normalizeStoredState(value: StoredPlayerState): StoredPlayerState {
  return normalizeStoredPlayerState(value).state;
}

export function copyStoredPlayerState(state: StoredPlayerState): StoredPlayerState {
  return {
    repairedContentIds: [...state.repairedContentIds],
    repairedAppIds: [...state.repairedAppIds],
    openedContentIds: [...state.openedContentIds],
    unlockedContentIds: [...state.unlockedContentIds],
    clearedTodoIds: [...state.clearedTodoIds],
    clearedNotificationIds: [...state.clearedNotificationIds],
    discoveredTargetKeys: [...state.discoveredTargetKeys],
    revealedAttachmentContentIds: [...state.revealedAttachmentContentIds],
    revealedMessageLinks: state.revealedMessageLinks.map((link) => ({ ...link })),
    stateValues: { ...state.stateValues },
    talks: Object.fromEntries(Object.entries(state.talks).map(([talkId, talk]) => [
      talkId,
      { ...talk, blockDisplayCounts: { ...talk.blockDisplayCounts } }
    ])),
    searchTranscriptKey: state.searchTranscriptKey,
    searchLastMessageSeq: state.searchLastMessageSeq,
    incomingCallId: state.incomingCallId,
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
