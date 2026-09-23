import type {
  AppId,
  AssistantMessage,
  SearchAgentMessage,
  DeviceState,
  MessageAttachment,
  MessageSegment,
  ScenarioTime,
  TodoItem
} from "../scenario-runtime/types";
import type {
  PublicPresentationEffect,
  PublicPresentationPayload,
  PublicPresentationResponse,
  PublicPresentationSequence,
  PublicPresentationTalkMessage
} from "../../shared/presentation.ts";
import { demoProjectConstantsGenerated as projectConstants } from "../generated/demoProjectConstants.generated.ts";
import { localPlayerExecution } from "../generated/playerExecution.generated.ts";
import {
  BROWSER_PLAYER_CLEARED_EVENT,
  BROWSER_PLAYER_MARKER,
  BROWSER_PLAYER_STORAGE_ERROR_EVENT,
  BrowserPlayerStorageError,
  commitBrowserPlayerResponse,
  clearBrowserPlayerStorage,
  isBrowserPlayerStorageError,
  prepareBrowserPlayerRequest
} from "./browserPlayerStorage.ts";
import { safeLocalStorage } from "./browserStorage.ts";
import { isMemoryStorage } from "./clientStorage.ts";
import { apiUrl } from "./resourceUrls.ts";
import { browserPlayerRequestInit } from "./playerTransport.ts";
import { limitedSearchAgentItems } from "./transcriptLimit.ts";
import { transcriptCacheCompatible, transcriptCacheVersion } from "./transcriptCachePolicy.ts";

type StoredTalkMessageBase = {
  seq?: number;
  id: string;
  talkId: string;
  sender: "owner" | "other";
  body: string;
  avatarUrl?: string;
  segments?: MessageSegment[];
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
  historyRepairId?: string;
  attachment: MessageAttachment | null;
  quickReplies?: string[];
  sentAt: string;
  displayTime?: string;
};

export type StoredSmsMessage = StoredTalkMessageBase;

export type StoredChatMessage = StoredTalkMessageBase & {
  senderName: string | null;
};

export type GameOverTalkMessage = PublicPresentationTalkMessage;

export type GameOverTalkPayload = {
  talkId: string;
  kind: "sms" | "chat";
  reasonMessage?: string;
  messages: GameOverTalkMessage[];
};

export type GenericGameOverPayload = {
  kind: "generic";
  reasonMessage?: string;
};

export type GameOverPayload = GameOverTalkPayload | GenericGameOverPayload;

export type AllClearPayload = {
  target: {
    appId: AppId;
    contentId: string;
  };
  autoplay: boolean;
};

export type PresentationEffect = PublicPresentationEffect;
export type PresentationSequence = PublicPresentationSequence;
export type PresentationPayload = PublicPresentationPayload;
export type PresentationResponse = PublicPresentationResponse;

export type PublicPlayerState = {
  clientRevision: string;
  transcriptRevision: string;
  revision: string;
  stateVersion: number;
  nextScenarioWakeAt: string | null;
  scenarioTime: ScenarioTime;
  projectState: Readonly<Record<string, string | number | boolean>>;
  visibleDeviceState: Partial<DeviceState>;
  todos: TodoItem[];
  assistantMessages: AssistantMessage[];
  contentStates: Array<{
    contentId: string;
    state: string;
    appId: string | null;
    updatedAt: string;
  }>;
  unlockedAttachments: Array<{
    contentId: string;
    title: string;
    body: string;
    imageUrl?: string;
  }>;
  talks: Array<{
    transcriptKey: string;
    talkId: string;
    kind: "sms" | "chat";
    canPost: boolean;
    turnKey: string;
    lastMessageSeq: number;
    historyRevision: number;
    inputVisible: boolean;
    inputVisibleAfterSeq: number;
    inputEnabled: boolean;
    inputEnabledAfterSeq: number;
  } | {
    transcriptKey: string;
    talkId: string;
    kind: "search_agent";
    label: string;
    canPost: boolean;
    turnKey: string;
    lastMessageSeq: number;
    historyRevision: 0;
    inputVisible: boolean;
    inputVisibleAfterSeq: number;
    inputEnabled: boolean;
    inputEnabledAfterSeq: number;
  }>;
};

export type PlayerStateResponse = PublicPlayerState & {
  transcriptDeltas: TranscriptDelta[];
  progressToken?: string;
};

export type TranscriptDelta =
  | {
      kind: "sms" | "chat";
      talkId: string;
      transcriptKey: string;
      messages: Array<StoredSmsMessage | StoredChatMessage>;
    }
  | {
      kind: "search_agent";
      talkId: string;
      transcriptKey: string;
      messages: SearchAgentMessage[];
    };

export type PlayerState = PublicPlayerState & {
  smsMessages: StoredSmsMessage[];
  chatMessages: StoredChatMessage[];
  searchAgentMessages: SearchAgentMessage[];
};

type ApiFailure = { ok: false; error: string; status?: number; playerState?: PlayerState; retryable?: boolean };
type ApiResult<T extends { ok: true }> = T | ApiFailure;
export type TalkReadCursorPayload = { talkId: string; messageId: string };

type TranscriptCache = {
  talk: Record<string, {
    kind: "sms" | "chat";
    transcriptKey: string;
    historyRevision?: number;
    messages: Array<StoredSmsMessage | StoredChatMessage>;
  } | {
    kind: "search_agent";
    transcriptKey: string;
    historyRevision?: number;
    messages: SearchAgentMessage[];
  }>;
};

export type TranscriptFetchPlan = {
  stream: string;
  after: number;
};

type StoredTranscriptCache = {
  version?: unknown;
  credential?: unknown;
  clientRevision?: unknown;
  transcriptRevision?: unknown;
  transcripts?: TranscriptCache;
};

const SERVER_TRANSCRIPT_CACHE_KEY = "xstoryphone.transcripts.v2";
const configuredPlayerMode = String(projectConstants["player.mode"] ?? "server");
export const playerMode = configuredPlayerMode === "static" ? "static" : configuredPlayerMode === "browser" ? "browser" : "server";
let startupPin: string | undefined;

function emptyTranscriptCache(): TranscriptCache {
  return { talk: {} };
}

function loadTranscriptCache(credential: string, transcriptRevision: string) {
  const raw = safeLocalStorage.getItem(SERVER_TRANSCRIPT_CACHE_KEY);
  if (!raw) return emptyTranscriptCache();
  try {
    const parsed = JSON.parse(raw) as StoredTranscriptCache;
    if (!transcriptCacheCompatible(parsed, credential, transcriptRevision)) return emptyTranscriptCache();
    return parsed.transcripts ?? emptyTranscriptCache();
  } catch {
    return emptyTranscriptCache();
  }
}

function saveTranscriptCache(credential: string, state: PlayerStateResponse, transcripts: TranscriptCache) {
  safeLocalStorage.setItem(SERVER_TRANSCRIPT_CACHE_KEY, JSON.stringify({
    version: transcriptCacheVersion,
    credential,
    clientRevision: state.clientRevision,
    transcriptRevision: state.transcriptRevision,
    transcripts
  }));
}

function messageSeq(message: { seq?: number }) {
  if (typeof message.seq !== "number" || !Number.isInteger(message.seq) || message.seq <= 0) {
    throw new Error("transcript_invalid_seq");
  }
  return message.seq;
}

function lastMessageSeq(messages: readonly { seq?: number }[]) {
  return messages.reduce((max, message) => Math.max(max, messageSeq(message)), 0);
}

function missingTranscriptAfter(
  current: { transcriptKey: string; historyRevision?: number; messages: readonly { seq?: number }[] } | undefined,
  expected: { transcriptKey: string; lastMessageSeq: number; historyRevision?: number },
  incoming: readonly { seq?: number }[]
) {
  if (current?.transcriptKey !== expected.transcriptKey) return 0;
  if (
    typeof expected.historyRevision === "number"
    && (current.historyRevision ?? 0) !== expected.historyRevision
  ) {
    return 0;
  }

  let currentLastSeq: number;
  try {
    currentLastSeq = lastMessageSeq(current.messages);
  } catch {
    // cacheの番号を推測せず、サーバーに保存された履歴を取得し直す。
    return 0;
  }
  if (currentLastSeq === expected.lastMessageSeq) return null;
  if (currentLastSeq > expected.lastMessageSeq) return 0;
  const incomingSeqs = new Set(incoming.flatMap((message) => (
    typeof message.seq === "number" && Number.isInteger(message.seq) && message.seq > 0 ? [message.seq] : []
  )));
  for (let seq = currentLastSeq + 1; seq <= expected.lastMessageSeq; seq += 1) {
    if (!incomingSeqs.has(seq)) return currentLastSeq;
  }
  return null;
}

export function serverTranscriptFetchPlans(
  publicState: Pick<PlayerStateResponse, "talks" | "transcriptDeltas">,
  cache: TranscriptCache
): TranscriptFetchPlan[] {
  const plans = publicState.talks.flatMap((talk) => {
    const incoming: Array<{ seq?: number }> = publicState.transcriptDeltas.flatMap((delta) => (
      delta.talkId === talk.talkId && delta.transcriptKey === talk.transcriptKey
        ? delta.messages.map((message) => ({ seq: message.seq }))
        : []
    ));
    const after = missingTranscriptAfter(cache.talk[talk.talkId], talk, incoming);
    return after === null ? [] : [{ stream: talk.talkId, after }];
  });
  return plans;
}

function mergeMessages<T extends { seq?: number }>(current: T[], incoming: T[]) {
  const bySeq = new Map<number, T>();
  current.forEach((message) => bySeq.set(messageSeq(message), message));
  incoming.forEach((message) => {
    const seq = messageSeq(message);
    if (!bySeq.has(seq)) bySeq.set(seq, message);
  });
  return [...bySeq.entries()].sort(([left], [right]) => left - right).map(([, message]) => message);
}

function applyTranscriptDelta(cache: TranscriptCache, delta: TranscriptDelta) {
  const current = cache.talk[delta.talkId];
  if (delta.kind === "search_agent") {
    const messages = current?.kind === "search_agent" && current.transcriptKey === delta.transcriptKey
      ? mergeMessages(current.messages, delta.messages)
      : mergeMessages<SearchAgentMessage>([], delta.messages);
    cache.talk[delta.talkId] = {
      kind: "search_agent",
      transcriptKey: delta.transcriptKey,
      messages: limitedSearchAgentItems(messages)
    };
    return;
  }
  const messages = current?.kind === delta.kind && current.transcriptKey === delta.transcriptKey
    ? mergeMessages(current.messages, delta.messages)
    : mergeMessages<StoredSmsMessage | StoredChatMessage>([], delta.messages);
  cache.talk[delta.talkId] = { kind: delta.kind, transcriptKey: delta.transcriptKey, messages };
}

function serverAuthHeaders(sessionToken: string): Record<string, string> {
  return { authorization: `Bearer ${sessionToken}` };
}

function fetchPlayerApi(url: string, init: RequestInit = {}) {
  if (localPlayerExecution) return localPlayerExecution.request(url, init);
  return fetch(apiUrl(url), isMemoryStorage ? { ...init, credentials: "omit", cache: "no-store" } : init);
}

async function fetchTranscriptDelta(credential: string, stream: string, after: number) {
  let lastError: unknown = new Error("transcript_unavailable");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchPlayerApi(`/api/transcript/${encodeURIComponent(stream)}?after=${after}`, {
        headers: serverAuthHeaders(credential)
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; delta?: TranscriptDelta } | null;
      if (response.ok && payload?.ok && payload.delta) return payload.delta;
      lastError = new Error(`transcript_unavailable:${response.status}`);
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function hydratePlayerState(publicState: PlayerStateResponse, credential: string): Promise<PlayerState> {
  const cache = loadTranscriptCache(credential, publicState.transcriptRevision);
  const serverFetchPlans = serverTranscriptFetchPlans(publicState, cache);
  for (const plan of serverFetchPlans) {
    if (plan.after === 0) delete cache.talk[plan.stream];
  }
  for (const delta of publicState.transcriptDeltas ?? []) applyTranscriptDelta(cache, delta);

  const requests = serverFetchPlans.map((plan) => fetchTranscriptDelta(credential, plan.stream, plan.after));
  for (const delta of await Promise.all(requests)) {
    if (delta) applyTranscriptDelta(cache, delta);
  }

  for (const talk of publicState.talks) {
    const cached = cache.talk[talk.talkId];
    if (cached?.transcriptKey === talk.transcriptKey) {
      cached.historyRevision = talk.historyRevision;
    }
  }

  saveTranscriptCache(credential, publicState, cache);
  const visibleTalks = new Map(publicState.talks.map((talk) => [talk.talkId, talk]));
  const visibleTranscripts = Object.entries(cache.talk).filter(([talkId, transcript]) =>
    visibleTalks.get(talkId)?.transcriptKey === transcript.transcriptKey
  );
  const searchAgentTranscript = visibleTranscripts.find(([, transcript]) => transcript.kind === "search_agent")?.[1];
  return {
    ...publicStateWithoutTransportFields(publicState),
    smsMessages: visibleTranscripts
      .filter(([, transcript]) => transcript.kind === "sms")
      .flatMap(([, transcript]) => transcript.messages as StoredSmsMessage[]),
    chatMessages: visibleTranscripts
      .filter(([, transcript]) => transcript.kind === "chat")
      .flatMap(([, transcript]) => transcript.messages as StoredChatMessage[]),
    searchAgentMessages: searchAgentTranscript?.kind === "search_agent"
      ? searchAgentTranscript.messages
      : []
  };
}

function publicStateWithoutTransportFields(state: PlayerStateResponse): PublicPlayerState {
  const { transcriptDeltas: _transcriptDeltas, progressToken: _progressToken, ...publicState } = state;
  return publicState;
}

export function clearTranscriptStorage() {
  safeLocalStorage.removeItem(SERVER_TRANSCRIPT_CACHE_KEY);
}

let browserRequestQueue: Promise<unknown> = Promise.resolve();
let browserStorageFailure: BrowserPlayerStorageError | null = null;

type ReadJsonOptions = {
  credential?: string;
  browserParentToken?: string | null;
  replaceBrowserStreamsOnSuccess?: boolean;
};

function queueBrowserPlayerOperation<T>(operation: () => Promise<T>) {
  const result = browserRequestQueue.then(operation, operation);
  browserRequestQueue = result.then(() => undefined, () => undefined);
  return result;
}

function notifyBrowserPlayerStorageError(error: unknown) {
  if (isBrowserPlayerStorageError(error) && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BROWSER_PLAYER_STORAGE_ERROR_EVENT, { detail: error }));
  }
}

function notifyBrowserPlayerCleared() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BROWSER_PLAYER_CLEARED_EVENT));
  }
}

async function runBrowserPlayerOperation<T>(operation: () => Promise<T>) {
  if (browserStorageFailure) throw browserStorageFailure;
  try {
    return await operation();
  } catch (error) {
    if (isBrowserPlayerStorageError(error)) browserStorageFailure = error;
    notifyBrowserPlayerStorageError(error);
    throw error;
  }
}

function isResponseRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson<T extends { ok: true }>(response: Response, options: ReadJsonOptions = {}): Promise<ApiResult<T>> {
  if (response.status === 429) {
    return { ok: false, error: "rate_limited", status: response.status, retryable: true };
  }

  const parsed: unknown = await response.json().catch(() => null);
  if (
    !isResponseRecord(parsed)
    || typeof parsed.ok !== "boolean"
    || (parsed.ok === false && typeof parsed.error !== "string")
    || (parsed.playerState !== undefined && !isResponseRecord(parsed.playerState))
  ) {
    // 不正な応答は作品の拒否理由として扱わず、状態を渡さない既存の再試行経路へ倒す。
    return { ok: false, error: "invalid_response", status: response.status, retryable: true };
  }
  const payload = parsed as ApiResult<T>;
  // 本文に同名の値があっても、失敗の分類には実際のHTTPステータスだけを使う。
  if (!payload.ok) payload.status = response.status;
  const mutable = payload as ApiResult<T> & { playerState?: PlayerStateResponse | PlayerState; sessionToken?: string };
  if (
    playerMode === "browser"
    && response.status === 401
    && !payload.ok
    && payload.error === "unauthorized"
    && options.browserParentToken
  ) {
    // 鍵の設定不一致でも起こるため、保存を消さず既存の停止・リロード経路へ倒す。
    throw new BrowserPlayerStorageError("unauthorized", "保存されたプレイデータをサーバーで確認できません。");
  } else if (playerMode === "browser" && !payload.ok && options.browserParentToken === null) {
    delete mutable.playerState;
  } else if (mutable.playerState && !localPlayerExecution) {
    const responseState = mutable.playerState as PlayerStateResponse;
    if (playerMode === "browser") {
      mutable.playerState = await commitBrowserPlayerResponse(
        options.browserParentToken ?? null,
        responseState,
        { replaceStreams: payload.ok && options.replaceBrowserStreamsOnSuccess === true }
      );
    } else {
      const hydrationCredential = mutable.sessionToken ?? options.credential ?? "";
      mutable.playerState = await hydratePlayerState(responseState, hydrationCredential);
    }
  }
  if (playerMode === "browser" && payload.ok && typeof mutable.sessionToken === "string") {
    mutable.sessionToken = BROWSER_PLAYER_MARKER;
  }
  if (
    !payload.ok
    && payload.retryable !== false
    && (response.status === 408 || response.status === 502 || response.status === 503 || response.status === 504)
  ) {
    return { ...payload, retryable: true };
  }
  return payload;
}

async function playerRequest<T extends { ok: true }>(
  url: string,
  sessionToken: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
  options: { replaceBrowserStreamsOnSuccess?: boolean } = {}
): Promise<ApiResult<T>> {
  const execute = async () => {
    if (localPlayerExecution) return readJson<T>(await fetchPlayerApi(url, init));
    if (playerMode === "browser") {
      const parentToken = await prepareBrowserPlayerRequest();
      if (!parentToken) {
        notifyBrowserPlayerCleared();
        return { ok: false as const, error: "unauthorized" };
      }
      const response = await fetchPlayerApi(url, browserPlayerRequestInit(init, parentToken));
      return readJson<T>(response, {
        browserParentToken: parentToken,
        replaceBrowserStreamsOnSuccess: options.replaceBrowserStreamsOnSuccess
      });
    }
    const requestInit = { ...init, headers: { ...init.headers, ...serverAuthHeaders(sessionToken) } };
    const response = await fetchPlayerApi(url, requestInit);
    return readJson<T>(response, { credential: sessionToken });
  };
  if (playerMode === "static") return runBrowserPlayerOperation(execute);
  if (playerMode !== "browser") return execute();
  return queueBrowserPlayerOperation(() => runBrowserPlayerOperation(execute));
}

export async function startSession(serialCode: string) {
  const execute = async () => {
    if (playerMode === "browser" && await prepareBrowserPlayerRequest()) {
      throw new BrowserPlayerStorageError("conflict", "開始済みのbrowser playerがあります。");
    }
    const response = await fetchPlayerApi("/api/session/start", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ serialCode, ...(startupPin ? { pin: startupPin } : {}) })
    });

    const result = await readJson<{ ok: true; sessionToken: string; playerState: PlayerState } & PresentationResponse>(response, {
      ...(playerMode === "browser"
        ? { browserParentToken: null, replaceBrowserStreamsOnSuccess: true }
        : {})
    });
    if (result.ok) startupPin = undefined;
    return result;
  };
  return playerMode === "browser"
    ? queueBrowserPlayerOperation(() => runBrowserPlayerOperation(execute))
    : playerMode === "static" ? runBrowserPlayerOperation(execute) : execute();
}

export async function verifyDevicePin(pin: string, sessionToken = "") {
  const execute = async () => {
    const parentToken = playerMode === "browser" && sessionToken ? await prepareBrowserPlayerRequest() : undefined;
    const init = {
      method: "POST", headers: { "content-type": "application/json", ...(playerMode === "server" && sessionToken ? serverAuthHeaders(sessionToken) : {}) },
      body: JSON.stringify({ pin })
    };
    const response = await fetchPlayerApi("/api/device-pin/verify", parentToken ? browserPlayerRequestInit(init, parentToken) : init);
    const result = await readJson<{ ok: true; playerState?: PlayerState } & PresentationResponse>(response, {
      credential: sessionToken, ...(playerMode === "browser" ? { browserParentToken: parentToken ?? null } : {})
    });
    if (result.ok) startupPin = result.playerState ? undefined : pin;
    return result;
  };
  return playerMode === "browser" ? queueBrowserPlayerOperation(() => runBrowserPlayerOperation(execute)) : runBrowserPlayerOperation(execute);
}

export async function verifyAccessCode(serialCode: string) {
  return readJson<{ ok: true }>(await fetchPlayerApi("/api/access-code/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serialCode })
  }));
}

export async function loadPlayerState(sessionToken: string) {
  return playerRequest<{ ok: true; playerState: PlayerState }>("/api/player-state", sessionToken, { method: "POST" });
}

export async function resetPlayerState(sessionToken: string) {
  if (playerMode === "browser") {
    if (!(import.meta.env?.DEV || import.meta.env?.VITE_XSTORYPHONE_RESET_FOR_TESTING === "true")) return {ok:false as const,error:"not_found",status:404};
    return queueBrowserPlayerOperation(() => runBrowserPlayerOperation(async () => {
      const parent = await prepareBrowserPlayerRequest();
      await clearBrowserPlayerStorage({expectedProgressToken:parent});
      return {ok:true as const};
    }));
  }
  return playerRequest<{ ok: true }>("/api/reset-for-testing", sessionToken, {
    method: "POST"
  });
}

export async function recordContentOpened(
  sessionToken: string,
  content: {
    contentId: string;
    appId: AppId;
    mediaContentIds?: string[];
  },
  talkReadCursors: TalkReadCursorPayload[] = []
) {
  return playerRequest<{ ok: true; playerState: PlayerState } & PresentationResponse>("/api/content/opened", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ...content,
      ...(talkReadCursors.length ? { talkReadCursors } : {})
    })
  });
}

export async function recordContentMediaObserved(
  sessionToken: string,
  content: {
    contentId: string;
    appId: AppId;
    mediaContentIds: string[];
  }
) {
  return playerRequest<{ ok: true; playerState: PlayerState }>("/api/content/media-observed", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(content)
  });
}

export async function unlockContent(sessionToken: string, contentId: string, password: string) {
  return playerRequest<{ ok: true; state: "unlocked"; playerState: PlayerState } & PresentationResponse>("/api/content/unlock", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ contentId, password })
  });
}

export async function recordScenarioEvent(sessionToken: string, eventId: string, payload: Record<string, unknown> = {}) {
  return playerRequest<{ ok: true; playerState: PlayerState } & PresentationResponse>("/api/scenario/event", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ eventId, ...payload })
  });
}

export async function openMessageLink(
  sessionToken: string,
  payload: {
    talkId: string;
    messageRef: string;
    segmentIndex: number;
    linkId?: string;
  }
) {
  return playerRequest<{
    ok: true;
    playerState: PlayerState;
    target: {
      appId: AppId;
      contentId: string;
    } | null;
  } & PresentationResponse>("/api/message-link/open", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function sendTalkMessage(
  sessionToken: string,
  talkId: string,
  turnKey: string,
  message: string,
  talkReadCursors: TalkReadCursorPayload[] = [],
  recentMessages: readonly { speaker: string; body: string }[] = []
) {
  return playerRequest<{ ok: true; playerState: PlayerState; stale?: boolean } & PresentationResponse>("/api/talk/send", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      talkId,
      turnKey,
      message,
      ...(recentMessages.length ? { recentMessages } : {}),
      ...(talkReadCursors.length ? { talkReadCursors } : {})
    })
  });
}

export async function submitRadioForm(sessionToken: string, formId: string, fields: Record<string, string>) {
  return playerRequest<{ ok: true; playerState: PlayerState } & PresentationResponse>("/api/form/submit", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ formId, fields })
  });
}
