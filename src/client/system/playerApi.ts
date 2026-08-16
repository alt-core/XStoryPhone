import type {
  AppId,
  AssistantMessage,
  SearchAgentMessage,
  SearchAgentSearchResult,
  DeviceState,
  MessageAttachment,
  MessageSegment,
  ScenarioTime,
  TodoItem
} from "../scenario-runtime/types";
import { demoProjectConstantsGenerated as projectConstants } from "../generated/demoProjectConstants.generated";
import { safeLocalStorage } from "./browserStorage";

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
  attachment: MessageAttachment | null;
  sentAt: string;
};

export type StoredSmsMessage = StoredTalkMessageBase;

export type StoredChatMessage = StoredTalkMessageBase & {
  senderName: string | null;
};

export type GameOverTalkMessage = StoredTalkMessageBase & {
  kind: "sms" | "chat";
  senderName: string | null;
};

export type GameOverTalkPayload = {
  talkId: string;
  kind: "sms" | "chat";
  reasonMessage?: string;
  messages: GameOverTalkMessage[];
};

export type FormGameOverPayload = {
  kind: "form";
  reasonMessage?: string;
};

export type GameOverPayload = GameOverTalkPayload | FormGameOverPayload;

export type AllClearPayload = {
  kind: "all_clear";
  target: {
    appId: AppId;
    contentId: string;
  };
  autoplay: boolean;
};

export type PublicPlayerState = {
  clientRevision: string;
  revision: string;
  stateVersion: number;
  serialCounter: string;
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
    talkId: string;
    kind: "sms" | "chat";
    canPost: boolean;
    turnKey: string;
    transcriptKey: string;
    lastMessageSeq: number;
  }>;
  searchTranscript: {
    transcriptKey: string;
    lastMessageSeq: number;
  };
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
      kind: "search";
      transcriptKey: string;
      messages: SearchAgentMessage[];
    };

export type PlayerState = PublicPlayerState & {
  smsMessages: StoredSmsMessage[];
  chatMessages: StoredChatMessage[];
  searchAgentMessages: SearchAgentMessage[];
};

type ApiFailure = { ok: false; error: string; playerState?: PlayerState; retryable?: boolean };
type ApiResult<T extends { ok: true }> = T | ApiFailure;
export type TalkReadCursorPayload = { talkId: string; messageId: string; messageSeq: number };

type TranscriptCache = {
  talk: Record<string, { kind: "sms" | "chat"; transcriptKey: string; messages: Array<StoredSmsMessage | StoredChatMessage> }>;
  search: { transcriptKey: string; messages: SearchAgentMessage[] };
};

const TRANSCRIPT_CACHE_VERSION = 1;
const SERVER_TRANSCRIPT_CACHE_KEY = "xstoryphone.transcripts.v1";
const BROWSER_SAVE_KEY = "xstoryphone.browser-save.v1";
export const playerMode = String(projectConstants["player.mode"] ?? "server") === "browser" ? "browser" : "server";
let latestBrowserProgressToken: string | undefined;

function emptyTranscriptCache(): TranscriptCache {
  return { talk: {}, search: { transcriptKey: "", messages: [] } };
}

function loadTranscriptCache(credential: string) {
  const key = playerMode === "browser" ? BROWSER_SAVE_KEY : SERVER_TRANSCRIPT_CACHE_KEY;
  const raw = safeLocalStorage.getItem(key);
  if (!raw) return emptyTranscriptCache();
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      credential?: unknown;
      progressToken?: unknown;
      transcripts?: TranscriptCache;
    };
    if (parsed.version !== TRANSCRIPT_CACHE_VERSION || !parsed.transcripts) return emptyTranscriptCache();
    if (playerMode === "server" && parsed.credential !== credential) return emptyTranscriptCache();
    return parsed.transcripts;
  } catch {
    return emptyTranscriptCache();
  }
}

function saveTranscriptCache(credential: string, state: PublicPlayerState, transcripts: TranscriptCache) {
  if (playerMode === "browser") {
    latestBrowserProgressToken = state.progressToken ?? credential;
    safeLocalStorage.setItem(BROWSER_SAVE_KEY, JSON.stringify({
      version: TRANSCRIPT_CACHE_VERSION,
      progressToken: latestBrowserProgressToken,
      transcripts
    }));
    return;
  }
  safeLocalStorage.setItem(SERVER_TRANSCRIPT_CACHE_KEY, JSON.stringify({
    version: TRANSCRIPT_CACHE_VERSION,
    credential,
    transcripts
  }));
}

function messageSeq(message: { seq?: number }, fallback: number) {
  return typeof message.seq === "number" && Number.isInteger(message.seq) && message.seq > 0 ? message.seq : fallback;
}

function mergeMessages<T extends { seq?: number }>(current: T[], incoming: T[]) {
  const bySeq = new Map<number, T>();
  current.forEach((message, index) => bySeq.set(messageSeq(message, index + 1), message));
  incoming.forEach((message, index) => {
    const seq = messageSeq(message, current.length + index + 1);
    if (!bySeq.has(seq)) bySeq.set(seq, message);
  });
  return [...bySeq.entries()].sort(([left], [right]) => left - right).map(([, message]) => message);
}

function applyTranscriptDelta(cache: TranscriptCache, delta: TranscriptDelta) {
  if (delta.kind === "search") {
    cache.search = delta.transcriptKey === cache.search.transcriptKey
      ? { ...cache.search, messages: mergeMessages(cache.search.messages, delta.messages) }
      : { transcriptKey: delta.transcriptKey, messages: mergeMessages([], delta.messages) };
    return;
  }
  const current = cache.talk[delta.talkId];
  cache.talk[delta.talkId] = current?.transcriptKey === delta.transcriptKey
    ? { ...current, kind: delta.kind, messages: mergeMessages(current.messages, delta.messages) }
    : { kind: delta.kind, transcriptKey: delta.transcriptKey, messages: mergeMessages([], delta.messages) };
}

function authHeaders(sessionToken: string): Record<string, string> {
  return playerMode === "browser"
    ? { "x-xstoryphone-progress": sessionToken }
    : { authorization: `Bearer ${sessionToken}` };
}

async function fetchTranscriptDelta(credential: string, stream: string, after: number) {
  let lastError: unknown = new Error("transcript_unavailable");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`/api/transcript/${encodeURIComponent(stream)}?after=${after}`, {
        headers: authHeaders(credential)
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

async function hydratePlayerState(publicState: PublicPlayerState, credential: string): Promise<PlayerState> {
  const cache = loadTranscriptCache(credential);
  for (const delta of publicState.transcriptDeltas ?? []) applyTranscriptDelta(cache, delta);

  if (playerMode === "server") {
    const missing = publicState.talks.filter((talk) => {
      const cached = cache.talk[talk.talkId];
      const lastSeq = cached?.messages.reduce((max, message, index) => Math.max(max, messageSeq(message, index + 1)), 0) ?? 0;
      return cached?.transcriptKey !== talk.transcriptKey || lastSeq < talk.lastMessageSeq;
    });
    const searchLastSeq = cache.search.messages.reduce((max, message, index) => Math.max(max, messageSeq(message, index + 1)), 0);
    const requests: Array<Promise<TranscriptDelta | null>> = missing.map((talk) => {
      const cached = cache.talk[talk.talkId];
      const after = cached?.transcriptKey === talk.transcriptKey
        ? cached.messages.reduce((max, message, index) => Math.max(max, messageSeq(message, index + 1)), 0)
        : 0;
      return fetchTranscriptDelta(credential, talk.talkId, after);
    });
    if (
      cache.search.transcriptKey !== publicState.searchTranscript.transcriptKey
      || searchLastSeq < publicState.searchTranscript.lastMessageSeq
    ) {
      requests.push(fetchTranscriptDelta(
        credential,
        "search",
        cache.search.transcriptKey === publicState.searchTranscript.transcriptKey ? searchLastSeq : 0
      ));
    }
    for (const delta of await Promise.all(requests)) {
      if (delta) applyTranscriptDelta(cache, delta);
    }
  }

  saveTranscriptCache(credential, publicState, cache);
  const visibleTalks = new Map(publicState.talks.map((talk) => [talk.talkId, talk]));
  const visibleTranscripts = Object.entries(cache.talk).filter(([talkId, transcript]) =>
    visibleTalks.get(talkId)?.transcriptKey === transcript.transcriptKey
  );
  return {
    ...publicState,
    smsMessages: visibleTranscripts
      .filter(([, transcript]) => transcript.kind === "sms")
      .flatMap(([, transcript]) => transcript.messages as StoredSmsMessage[]),
    chatMessages: visibleTranscripts
      .filter(([, transcript]) => transcript.kind === "chat")
      .flatMap(([, transcript]) => transcript.messages as StoredChatMessage[]),
    searchAgentMessages: cache.search.transcriptKey === publicState.searchTranscript.transcriptKey ? cache.search.messages : []
  };
}

export function loadBrowserProgressToken() {
  if (playerMode !== "browser") return undefined;
  if (latestBrowserProgressToken) return latestBrowserProgressToken;
  try {
    const parsed = JSON.parse(safeLocalStorage.getItem(BROWSER_SAVE_KEY) ?? "null") as { version?: unknown; progressToken?: unknown } | null;
    latestBrowserProgressToken = parsed?.version === TRANSCRIPT_CACHE_VERSION && typeof parsed.progressToken === "string"
      ? parsed.progressToken
      : undefined;
    return latestBrowserProgressToken;
  } catch {
    return undefined;
  }
}

export function clearTranscriptStorage() {
  latestBrowserProgressToken = undefined;
  safeLocalStorage.removeItem(playerMode === "browser" ? BROWSER_SAVE_KEY : SERVER_TRANSCRIPT_CACHE_KEY);
}

let browserRequestQueue: Promise<unknown> = Promise.resolve();

async function readJson<T extends { ok: true }>(response: Response, credential = ""): Promise<ApiResult<T>> {
  if (response.status === 429) {
    return { ok: false, error: "rate_limited", retryable: true };
  }

  const payload = (await response.json().catch(() => ({ ok: false, error: "invalid_response" }))) as ApiResult<T>;
  const mutable = payload as ApiResult<T> & { playerState?: PublicPlayerState; sessionToken?: string };
  if (mutable.playerState) {
    const hydrationCredential = mutable.playerState.progressToken ?? mutable.sessionToken ?? credential;
    mutable.playerState = await hydratePlayerState(mutable.playerState, hydrationCredential);
  }
  if (
    !payload.ok
    && (payload.error === "invalid_response" || response.status === 408 || response.status === 502 || response.status === 503 || response.status === 504)
  ) {
    return { ...payload, retryable: true };
  }
  return payload;
}

async function playerRequest<T extends { ok: true }>(
  url: string,
  sessionToken: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
): Promise<ApiResult<T>> {
  const execute = async () => {
    const credential = playerMode === "browser" ? loadBrowserProgressToken() ?? sessionToken : sessionToken;
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, ...authHeaders(credential) }
    });
    return readJson<T>(response, credential);
  };
  if (playerMode !== "browser") return execute();
  const result = browserRequestQueue.then(execute, execute);
  browserRequestQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function startSession(serialCode: string) {
  const response = await fetch("/api/session/start", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ serialCode })
  });

  return readJson<{ ok: true; sessionToken: string; playerState: PlayerState }>(response);
}

export async function verifyDevicePin(pin: string) {
  const response = await fetch("/api/device-pin/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ pin })
  });

  return readJson<{ ok: true }>(response);
}

export async function loadPlayerState(sessionToken: string) {
  return playerRequest<{ ok: true; playerState: PlayerState }>("/api/player-state", sessionToken);
}

export async function resetPlayerState(sessionToken: string) {
  return playerRequest<{ ok: true; playerState: PlayerState }>("/api/reset-for-testing", sessionToken, {
    method: "POST"
  });
}

export async function recordContentOpened(
  sessionToken: string,
  content: {
    contentId: string;
    appId: AppId;
  },
  talkReadCursors: TalkReadCursorPayload[] = []
) {
  return playerRequest<{ ok: true; playerState: PlayerState }>("/api/content/opened", sessionToken, {
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
  return playerRequest<{ ok: true; state: "unlocked"; playerState: PlayerState }>("/api/content/unlock", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ contentId, password })
  });
}

export async function searchAgentSearch(sessionToken: string, query: string, requestId: string) {
  return playerRequest<{
    ok: true;
    matched: boolean;
    body: string;
    results: SearchAgentSearchResult[];
    playerState?: PlayerState;
  }>("/api/search-agent/search", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ query, requestId })
  });
}

export async function recordScenarioEvent(sessionToken: string, eventId: string, payload: Record<string, unknown> = {}) {
  return playerRequest<{ ok: true; playerState: PlayerState; allClear?: AllClearPayload }>("/api/scenario/event", sessionToken, {
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
  }
) {
  return playerRequest<{
    ok: true;
    playerState: PlayerState;
    target: {
      appId: AppId;
      contentId: string;
    };
  }>("/api/message-link/open", sessionToken, {
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
  talkReadCursors: TalkReadCursorPayload[] = []
) {
  return playerRequest<{ ok: true; playerState: PlayerState; stale?: boolean; gameOver?: GameOverTalkPayload; allClear?: AllClearPayload }>("/api/talk/send", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      talkId,
      turnKey,
      message,
      ...(talkReadCursors.length ? { talkReadCursors } : {})
    })
  });
}

export async function submitRadioForm(sessionToken: string, formId: string, fields: Record<string, string>) {
  return playerRequest<{ ok: true; playerState: PlayerState; gameOver?: FormGameOverPayload }>("/api/form/submit", sessionToken, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ formId, fields })
  });
}
