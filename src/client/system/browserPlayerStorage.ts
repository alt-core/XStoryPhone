import type { SearchAgentMessage } from "../scenario-runtime/types.ts";
import type {
  PlayerState,
  PlayerStateResponse,
  PublicPlayerState,
  StoredChatMessage,
  StoredSmsMessage,
  TranscriptDelta
} from "./playerApi.ts";
import { limitedSearchAgentItems } from "./transcriptLimit.ts";
import { prefixStorageKey, type ClientStorageSettings } from "../../shared/clientStorage.ts";
import { clientStorageSettings } from "./clientStorage.ts";

const DATABASE_VERSION = 2;
const STORE_NAME = "records";
const CURRENT_KEY = "current";

export const BROWSER_PLAYER_MARKER = "browser-player";
export const BROWSER_PLAYER_STORAGE_ERROR_EVENT = "xstoryphone:browser-player-storage-error";
export const BROWSER_PLAYER_CLEARED_EVENT = "xstoryphone:browser-player-cleared";

export type BrowserPlayerStorageErrorKind = "unavailable" | "conflict" | "corrupt" | "unauthorized";

export class BrowserPlayerStorageError extends Error {
  readonly kind: BrowserPlayerStorageErrorKind;

  constructor(kind: BrowserPlayerStorageErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "BrowserPlayerStorageError";
    this.kind = kind;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export function isBrowserPlayerStorageError(error: unknown): error is BrowserPlayerStorageError {
  return error instanceof BrowserPlayerStorageError;
}

type CurrentRecord = {
  key: "current";
  projectId: string;
  schemaVersion: 2;
  progressToken: string;
  publicState: PublicPlayerState;
};

type StoredMessage = StoredSmsMessage | StoredChatMessage | SearchAgentMessage;
type StreamRecord = {
  key: `talk:${string}`;
  kind: "sms" | "chat" | "search_agent";
  transcriptKey: string;
  messages: StoredMessage[];
};
type GroupedDelta = StreamRecord;

let database: IDBDatabase | null = null;
let configuredProjectId = "";
let configuredClientRevision = "";
let configuredStorage: ClientStorageSettings | null = null;
let storageEnabled = false;
let connectionInvalidated = false;
let currentMirror: CurrentRecord | null = null;
let streamMirror = new Map<string, StreamRecord>();
let cachedPlayerStateMirror: PlayerState | null = null;

function unavailable(message: string, cause?: unknown) { return new BrowserPlayerStorageError("unavailable", message, cause); }
function conflict(message: string) { return new BrowserPlayerStorageError("conflict", message); }
function corrupt(message: string, cause?: unknown) { return new BrowserPlayerStorageError("corrupt", message, cause); }
function normalizeStorageError(error: unknown, fallbackMessage: string) { return isBrowserPlayerStorageError(error) ? error : unavailable(fallbackMessage, error); }

function idbCall<T>(message: string, operation: () => T) {
  try {
    return operation();
  } catch (error) {
    throw unavailable(message, error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }

function messageSeq(value: unknown) {
  if (!isRecord(value) || typeof value.seq !== "number" || !Number.isInteger(value.seq) || value.seq <= 0) {
    throw corrupt("browser履歴のseqが不正です。");
  }
  return value.seq;
}

function validMessage(value: unknown, kind: StreamRecord["kind"]) {
  if (!isRecord(value) || !isNonEmptyString(value.id) || typeof value.sentAt !== "string") return false;
  if (value.quickReplies !== undefined && (!Array.isArray(value.quickReplies) || value.quickReplies.some((reply) => typeof reply !== "string"))) {
    return false;
  }
  if (kind === "search_agent") {
    if (value.kind === "message") return isNonEmptyString(value.talkId) && (value.sender === "owner" || value.sender === "other") && typeof value.body === "string";
    if (value.kind === "search_results") return isNonEmptyString(value.talkId) && value.sender === "other" && Array.isArray(value.results);
    return false;
  }
  if (typeof value.body !== "string") return false;
  return isNonEmptyString(value.talkId)
    && (value.sender === "owner" || value.sender === "other")
    && (value.attachment === null || isRecord(value.attachment))
    && (kind !== "chat" || value.senderName === null || typeof value.senderName === "string");
}

function comparableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => isRecord(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item);
}

function normalizedMessages<T>(
  values: readonly T[],
  kind: StreamRecord["kind"]
) {
  const bySeq = new Map<number, T>();
  for (const value of values) {
    if (!validMessage(value, kind)) throw corrupt("browser履歴のmessage形式が不正です。");
    const seq = messageSeq(value);
    const previous = bySeq.get(seq);
    if (previous && comparableJson(previous) !== comparableJson(value)) {
      throw corrupt(`browser履歴の同じseqに異なるmessageがあります: ${seq}`);
    }
    if (!previous) bySeq.set(seq, value);
  }
  const messages = [...bySeq.entries()].sort(([left], [right]) => left - right).map(([, value]) => value);
  return messages;
}

function assertConsecutiveMessages(messages: readonly StoredMessage[]) {
  for (let index = 1; index < messages.length; index += 1) {
    if (messageSeq(messages[index]) !== messageSeq(messages[index - 1]) + 1) {
      throw corrupt("browser履歴のseqに欠番があります。");
    }
  }
}

function validPublicState(value: unknown): value is PublicPlayerState {
  if (!isRecord(value)) return false;
  return typeof value.clientRevision === "string"
    && typeof value.transcriptRevision === "string"
    && typeof value.revision === "string"
    && isNonNegativeInteger(value.stateVersion)
    && isRecord(value.scenarioTime)
    && isRecord(value.projectState)
    && isRecord(value.visibleDeviceState)
    && Array.isArray(value.todos)
    && Array.isArray(value.assistantMessages)
    && Array.isArray(value.contentStates)
    && Array.isArray(value.unlockedAttachments)
    && Array.isArray(value.talks);
}

function publicStateSnapshot(value: unknown): PublicPlayerState {
  if (!validPublicState(value)) throw corrupt("browser PlayerStateの形式が不正です。");
  const snapshot = structuredClone(value) as Record<string, unknown>;
  delete snapshot.transcriptDeltas;
  delete snapshot.progressToken;
  delete snapshot.smsMessages;
  delete snapshot.chatMessages;
  delete snapshot.searchAgentMessages;
  return snapshot as PublicPlayerState;
}

function currentRecord(value: unknown): CurrentRecord {
  const publicState = isRecord(value) ? value.publicState : null;
  if (!isRecord(value)
    || value.key !== CURRENT_KEY
    || value.projectId !== configuredProjectId
    || value.schemaVersion !== DATABASE_VERSION
    || !isNonEmptyString(value.progressToken)
    || !validPublicState(value.publicState)
    || (isRecord(publicState) && ["progressToken", "transcriptDeltas", "smsMessages", "chatMessages", "searchAgentMessages"]
      .some((key) => key in publicState))) {
    throw corrupt("browser current recordの形式が不正です。");
  }
  return value as CurrentRecord;
}

function streamRecord(value: unknown): StreamRecord {
  if (!isRecord(value) || !isNonEmptyString(value.transcriptKey) || !Array.isArray(value.messages)) {
    throw corrupt("browser stream recordの形式が不正です。");
  }
  if (typeof value.key === "string" && value.key.startsWith("talk:") && (value.kind === "sms" || value.kind === "chat" || value.kind === "search_agent")) {
    const talkId = value.key.slice("talk:".length);
    if (!talkId) throw corrupt("browser talk streamのIDが空です。");
    const messages = normalizedMessages(value.messages, value.kind);
    assertConsecutiveMessages(messages as StoredMessage[]);
    if (messages.some((message) => !isRecord(message) || message.talkId !== talkId)) {
      throw corrupt(`browser talk履歴のtalk IDがrecord keyと一致しません: ${talkId}`);
    }
    return {
      key: value.key as `talk:${string}`,
      kind: value.kind,
      transcriptKey: value.transcriptKey,
      messages: value.kind === "search_agent"
        ? limitedSearchAgentItems(messages as SearchAgentMessage[])
        : messages as StoredMessage[]
    };
  }
  throw corrupt("browser stream recordのkindが不正です。");
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(unavailable("IndexedDB transactionが中断されました。", transaction.error));
    transaction.onerror = () => undefined;
  });
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(unavailable("IndexedDB requestに失敗しました。", request.error));
  });
}

function databaseName(projectId: string, storage: ClientStorageSettings) {
  return prefixStorageKey(`xstoryphone-browser-player-${projectId}`, storage.prefix);
}

async function openDatabase(projectId: string, storage: ClientStorageSettings) {
  const factory = idbCall("IndexedDBを参照できません。", () => globalThis.indexedDB);
  if (!factory) throw unavailable("IndexedDBを利用できません。");
  const name = databaseName(projectId, storage);
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const request = idbCall("IndexedDBを開けません。", () => factory.open(name, DATABASE_VERSION));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onerror = () => {
      settled = true;
      reject(unavailable("IndexedDBを開けません。", request.error));
    };
    request.onblocked = () => {
      settled = true;
      reject(unavailable("IndexedDBの更新が別の画面に阻まれています。"));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
  });
}

function readyStorage() {
  if (!storageEnabled || connectionInvalidated || !configuredStorage) {
    throw unavailable("browser player storageが初期化されていません。");
  }
}

function readyDatabase() {
  readyStorage();
  if (!database) throw unavailable("browser player storageが初期化されていません。");
  return database;
}

function storageTransaction(mode: IDBTransactionMode) {
  return idbCall("IndexedDB transactionを開始できません。", () => readyDatabase().transaction(STORE_NAME, mode));
}

async function storedRecords() {
  const transaction = storageTransaction("readonly");
  const request = idbCall("browser保存の読込を開始できません。", () => transaction.objectStore(STORE_NAME).getAll());
  const complete = transactionDone(transaction);
  const [records] = await Promise.all([requestValue(request), complete]);
  return records;
}

function talkInitialRange(state: PublicPlayerState, talkId: string, kind: "sms" | "chat") {
  const source = kind === "sms" ? state.visibleDeviceState.messages : state.visibleDeviceState.chatThreads;
  const thread = Array.isArray(source)
    ? source.find((candidate) => isRecord(candidate) && candidate.id === talkId)
    : undefined;
  if (!isRecord(thread)) return { visibleLast: 0, boundary: 0 };
  const messageMax = Array.isArray(thread.messages)
    ? thread.messages.reduce((max, message) => Math.max(max, isRecord(message) && typeof message.seq === "number" ? message.seq : 0), 0)
    : 0;
  const brokenMax = Array.isArray(thread.brokenHistoryRanges)
    ? thread.brokenHistoryRanges.reduce((max, range) => (
        Math.max(max, isRecord(range) && typeof range.beforeSeq === "number" ? range.beforeSeq - 1 : 0)
      ), 0)
    : 0;
  return { visibleLast: messageMax, boundary: Math.max(messageMax, brokenMax) };
}

function validateStateStreams(state: PublicPlayerState, streams: ReadonlyMap<string, StreamRecord>) {
  let searchTalkCount = 0;
  for (const value of state.talks) {
    if (!isRecord(value)
      || !isNonEmptyString(value.talkId)
      || (value.kind !== "sms" && value.kind !== "chat" && value.kind !== "search_agent")
      || !isNonEmptyString(value.transcriptKey)
      || !isNonNegativeInteger(value.lastMessageSeq)) {
      throw corrupt("browser talk状態の形式が不正です。");
    }
    const stream = streams.get(`talk:${value.talkId}`);
    if (stream?.transcriptKey === value.transcriptKey && stream.kind !== value.kind) {
      throw corrupt(`browser talk履歴のkindがPlayerStateと一致しません: ${value.talkId}`);
    }
    const matching = stream && stream.kind === value.kind && stream.transcriptKey === value.transcriptKey ? stream : null;
    if (value.kind === "search_agent") {
      searchTalkCount += 1;
      if (typeof value.inputVisible !== "boolean"
        || !isNonNegativeInteger(value.inputVisibleAfterSeq)
        || typeof value.inputEnabled !== "boolean"
        || !isNonNegativeInteger(value.inputEnabledAfterSeq)) {
        throw corrupt("browser検索talk状態の形式が不正です。");
      }
      const streamLast = matching?.messages.length
        ? messageSeq(matching.messages[matching.messages.length - 1])
        : 0;
      if (streamLast !== value.lastMessageSeq) {
        throw corrupt("browser検索talk履歴とPlayerStateの最終seqが一致しません。");
      }
      continue;
    }
    if (typeof value.inputVisible !== "boolean"
      || !isNonNegativeInteger(value.inputVisibleAfterSeq)
      || typeof value.inputEnabled !== "boolean"
      || !isNonNegativeInteger(value.inputEnabledAfterSeq)) {
      throw corrupt("browser talk入力状態の形式が不正です。");
    }
    const initial = talkInitialRange(state, value.talkId, value.kind);
    const streamLast = matching?.messages.length
      ? messageSeq(matching.messages[matching.messages.length - 1])
      : 0;
    if (matching?.messages.length) {
      const expectedFirst = initial.boundary + 1;
      if (messageSeq(matching.messages[0]) !== expectedFirst) {
        throw corrupt(`browser talk履歴の先頭seqが不正です: ${value.talkId}`);
      }
    }
    if (Math.max(initial.visibleLast, streamLast) !== value.lastMessageSeq) {
      throw corrupt(`browser talk履歴とPlayerStateの最終seqが一致しません: ${value.talkId}`);
    }
  }
  if (searchTalkCount !== 1) throw corrupt("browser検索talkは1件必要です。");
}

function composePlayerState(state: PublicPlayerState, streams: ReadonlyMap<string, StreamRecord>): PlayerState {
  const visibleTalks = new Map(state.talks.map((talk) => [talk.talkId, talk]));
  const visibleStreams = [...streams.values()].filter((stream) => {
    const talk = visibleTalks.get(stream.key.slice("talk:".length));
    return talk?.kind === stream.kind && talk.transcriptKey === stream.transcriptKey;
  });
  return {
    ...state,
    smsMessages: visibleStreams.filter((stream) => stream.kind === "sms").flatMap((stream) => stream.messages as StoredSmsMessage[]),
    chatMessages: visibleStreams.filter((stream) => stream.kind === "chat").flatMap((stream) => stream.messages as StoredChatMessage[]),
    searchAgentMessages: visibleStreams
      .filter((stream) => stream.kind === "search_agent")
      .flatMap((stream) => stream.messages) as SearchAgentMessage[]
  } satisfies PlayerState;
}

function playerStateFrom(current: CurrentRecord | null, streams: ReadonlyMap<string, StreamRecord>) {
  if (!current) return null;
  validateStateStreams(current.publicState, streams);
  return composePlayerState(current.publicState, streams);
}

function mirrorsFromRecords(records: unknown[]) {
  let current: CurrentRecord | null = null;
  const streams = new Map<string, StreamRecord>();
  for (const value of records) {
    if (isRecord(value) && value.key === CURRENT_KEY) {
      if (current) throw corrupt("browser current recordが重複しています。");
      current = currentRecord(value);
      continue;
    }
    const stream = streamRecord(value);
    streams.set(stream.key, stream);
  }
  if (!current && streams.size) throw corrupt("browser current recordなしで履歴だけが残っています。");
  return { current, streams };
}

function selectedStorage(storage?: ClientStorageSettings) {
  const selected = storage ?? configuredStorage ?? clientStorageSettings;
  if (configuredStorage && (selected.mode !== configuredStorage.mode || selected.prefix !== configuredStorage.prefix)) {
    throw unavailable("browser storageの保存方針・prefixは実行中に変更できません。");
  }
  return selected;
}

function clearMirrors() {
  currentMirror = null;
  streamMirror = new Map();
  cachedPlayerStateMirror = null;
}

export async function initializeBrowserPlayerStorage(options: {
  enabled: boolean;
  projectId: string;
  clientRevision: string;
  storage?: ClientStorageSettings;
}) {
  if (!options.enabled) return;
  if (!isNonEmptyString(options.projectId)) throw unavailable("project IDが未設定です。");
  const storage = selectedStorage(options.storage);
  if (configuredProjectId && configuredProjectId !== options.projectId) {
    throw unavailable("異なるprojectのbrowser storageを再初期化できません。");
  }
  if (storageEnabled && (storage.mode === "memory" || database)) return;

  storageEnabled = true;
  configuredProjectId = options.projectId;
  configuredClientRevision = options.clientRevision;
  configuredStorage = Object.freeze({ ...storage });
  connectionInvalidated = false;
  if (storage.mode === "memory") return;
  database = await openDatabase(options.projectId, storage);
  database.onversionchange = () => {
    connectionInvalidated = true;
    database?.close();
  };
  if (!idbCall("IndexedDB schemaを確認できません。", () => database?.objectStoreNames.contains(STORE_NAME))) {
    throw corrupt("IndexedDB records storeがありません。");
  }

  const loaded = mirrorsFromRecords(await storedRecords());
  const cached = loaded.current?.publicState.clientRevision === configuredClientRevision
    ? playerStateFrom(loaded.current, loaded.streams)
    : null;
  currentMirror = loaded.current;
  streamMirror = loaded.streams;
  cachedPlayerStateMirror = cached;
}

// 起動前または保存検査に失敗した後の明示初期化用。呼出し側で削除内容の確認を済ませる。
export async function deleteBrowserPlayerDatabase(projectId: string, settings?: ClientStorageSettings): Promise<void> {
  if (!isNonEmptyString(projectId)) throw unavailable("project IDが未設定です。");
  const storage = selectedStorage(settings);
  if (storage.mode === "memory") {
    if (configuredProjectId === projectId) {
      clearMirrors();
      storageEnabled = false;
    }
    return;
  }
  const factory = idbCall("IndexedDBを参照できません。", () => globalThis.indexedDB);
  if (!factory) throw unavailable("IndexedDBを利用できません。");
  if (configuredProjectId === projectId && database) {
    idbCall("IndexedDB connectionを閉じられません。", () => database?.close());
    database = null;
    connectionInvalidated = true;
    storageEnabled = false;
  }
  await new Promise<void>((resolve, reject) => {
    const request = idbCall("browser保存の初期化を開始できません。", () => factory.deleteDatabase(databaseName(projectId, storage)));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(unavailable("browser保存の初期化に失敗しました。", request.error));
    request.onblocked = () => reject(unavailable("browser保存の初期化が別の画面に阻まれています。他の画面を閉じてから再読み込みしてください。"));
  });
  if (configuredProjectId === projectId) {
    clearMirrors();
    configuredClientRevision = "";
    storageEnabled = false;
  }
}

export function loadBrowserPlayerMarker() { return currentMirror ? BROWSER_PLAYER_MARKER : undefined; }
export function loadCachedBrowserPlayerState() { return cachedPlayerStateMirror; }

export async function prepareBrowserPlayerRequest() {
  readyStorage();
  if (configuredStorage?.mode === "memory") return currentMirror?.progressToken ?? null;
  const transaction = storageTransaction("readonly");
  const request = idbCall("browser currentの読込を開始できません。", () => transaction.objectStore(STORE_NAME).get(CURRENT_KEY));
  const complete = transactionDone(transaction);
  const [raw] = await Promise.all([requestValue(request), complete]);
  const stored = raw === undefined ? null : currentRecord(raw);
  if (stored?.progressToken !== currentMirror?.progressToken) {
    throw conflict("別の画面でbrowser進行が更新されています。");
  }
  return stored?.progressToken ?? null;
}

function groupedDeltas(deltas: readonly TranscriptDelta[] | unknown) {
  if (!Array.isArray(deltas)) throw corrupt("browser transcript deltaが配列ではありません。");
  const grouped = new Map<string, GroupedDelta>();
  for (const delta of deltas) {
    if (!isRecord(delta) || !Array.isArray(delta.messages) || !isNonEmptyString(delta.transcriptKey)) {
      throw corrupt("browser transcript deltaの形式が不正です。");
    }
    const key = (delta.kind === "sms" || delta.kind === "chat" || delta.kind === "search_agent") && isNonEmptyString(delta.talkId)
        ? `talk:${delta.talkId}`
        : null;
    if (!key) throw corrupt("browser transcript deltaのstreamが不正です。");
    const kind = delta.kind as StreamRecord["kind"];
    const current = grouped.get(key);
    if (current && (current.kind !== kind || current.transcriptKey !== delta.transcriptKey)) {
      throw corrupt("同じresponse内でbrowser streamの識別情報が競合しています。");
    }
    grouped.set(key, {
      key: key as StreamRecord["key"],
      kind,
      transcriptKey: delta.transcriptKey,
      messages: [...(current?.messages ?? []), ...delta.messages]
    });
  }
  for (const group of grouped.values()) {
    group.messages = normalizedMessages(group.messages, group.kind) as GroupedDelta["messages"];
  }
  return grouped;
}

function mergedStream(
  existingValue: unknown,
  group: GroupedDelta,
  snapshot: PublicPlayerState
): StreamRecord | null {
  const existing = existingValue === undefined ? null : streamRecord(existingValue);
  const same = existing?.kind === group.kind && existing.transcriptKey === group.transcriptKey && existing.messages.length
    ? existing
    : null;
  const incoming = group.messages;
  if (!incoming.length) return same;

  if (!same) {
    const expectedFirst = group.kind === "search_agent"
      ? 1
      : talkInitialRange(snapshot, group.key.slice("talk:".length), group.kind).boundary + 1;
    if (messageSeq(incoming[0]) !== expectedFirst) {
      throw corrupt(`新しいbrowser streamの先頭seqが不正です: ${group.key}`);
    }
    return streamRecord({ ...group, messages: incoming });
  }

  const messages = [...same.messages] as GroupedDelta["messages"];
  const bySeq = new Map(messages.map((message) => [messageSeq(message), message]));
  const first = messages.length ? messageSeq(messages[0]) : 0;
  let max = messages.length ? messageSeq(messages[messages.length - 1]) : 0;
  for (const message of incoming) {
    const seq = messageSeq(message);
    const previous = bySeq.get(seq);
    if (previous) {
      if (comparableJson(previous) !== comparableJson(message)) throw corrupt(`同じseqのbrowser履歴が競合しています: ${group.key}/${seq}`);
      continue;
    }
    if (group.kind === "search_agent" && first > 1 && seq < first) continue;
    if (seq !== max + 1) throw corrupt(`browser履歴の追加seqが連続していません: ${group.key}/${seq}`);
    bySeq.set(seq, message);
    max = seq;
  }
  const merged = [...bySeq.values()].sort((left, right) => messageSeq(left) - messageSeq(right));
  return streamRecord({
    key: group.key,
    kind: group.kind,
    transcriptKey: group.transcriptKey,
    messages: group.kind === "search_agent"
      ? limitedSearchAgentItems(merged as SearchAgentMessage[])
      : merged
  });
}

// 保存先に依存しない検証を終えてから、current・履歴・表示stateをまとめて確定する。
function responseCandidate(
  parentProgressToken: string | null,
  nextCurrent: CurrentRecord,
  groups: ReadonlyMap<string, GroupedDelta>,
  storedCurrentValue: unknown,
  storedStreams: ReadonlyMap<string, unknown>,
  replaceStreams: boolean
) {
  const storedCurrent = storedCurrentValue === undefined ? null : currentRecord(storedCurrentValue);
  if (storedCurrent?.progressToken !== (parentProgressToken ?? undefined)) {
    throw conflict("browser応答の親tokenが現在の進行と一致しません。");
  }
  const snapshot = nextCurrent.publicState;
  if (storedCurrent && snapshot.stateVersion < storedCurrent.publicState.stateVersion) {
    throw corrupt("browser応答のstate versionが保存済み状態より古くなっています。");
  }
  const nextStreams = replaceStreams ? new Map<string, StreamRecord>() : new Map(streamMirror);
  for (const [key, group] of groups) {
    const merged = mergedStream(replaceStreams ? undefined : storedStreams.get(key), group, snapshot);
    if (merged) nextStreams.set(key, merged);
  }
  validateStateStreams(snapshot, nextStreams);
  return {
    current: nextCurrent,
    streams: nextStreams,
    playerState: composePlayerState(snapshot, nextStreams)
  };
}

function commitMirrors(candidate: ReturnType<typeof responseCandidate>) {
  currentMirror = candidate.current;
  streamMirror = candidate.streams;
  cachedPlayerStateMirror = candidate.playerState;
  return candidate.playerState;
}

export function commitBrowserPlayerResponse(
  parentProgressToken: string | null,
  state: PlayerStateResponse,
  options: { replaceStreams?: boolean } = {}
) {
  if (!isNonEmptyString(state.progressToken)) {
    return Promise.reject(corrupt("browser応答に新しいprogress tokenがありません。"));
  }
  let snapshot: PublicPlayerState;
  let groups: Map<string, GroupedDelta>;
  try {
    snapshot = publicStateSnapshot(state);
    groups = groupedDeltas(structuredClone(state.transcriptDeltas));
  } catch (error) {
    return Promise.reject(normalizeStorageError(error, "browser応答の保存準備に失敗しました。"));
  }
  const nextCurrent: CurrentRecord = {
    key: CURRENT_KEY,
    projectId: configuredProjectId,
    schemaVersion: DATABASE_VERSION,
    progressToken: state.progressToken,
    publicState: snapshot
  };

  return new Promise<PlayerState>((resolve, reject) => {
    if (configuredStorage?.mode === "memory") {
      try {
        readyStorage();
        const candidate = responseCandidate(
          parentProgressToken, nextCurrent, groups, currentMirror ?? undefined, streamMirror, Boolean(options.replaceStreams)
        );
        // awaitを挟まず、一度だけmirrorを差し替える。
        resolve(commitMirrors(candidate));
      } catch (error) {
        reject(normalizeStorageError(error, "browser応答の保存に失敗しました。"));
      }
      return;
    }
    const transaction = storageTransaction("readwrite");
    const store = idbCall("browser保存storeを開けません。", () => transaction.objectStore(STORE_NAME));
    const currentRead = idbCall("browser currentの読込を開始できません。", () => store.get(CURRENT_KEY));
    const streamReads = options.replaceStreams
      ? new Map<string, IDBRequest>()
      : new Map([...groups.keys()].map((key) => [
          key,
          idbCall("browser streamの読込を開始できません。", () => store.get(key))
        ]));
    let remaining = 1 + streamReads.size;
    let failure: BrowserPlayerStorageError | null = null;
    let candidate: ReturnType<typeof responseCandidate> | null = null;

    const abort = (error: unknown) => {
      failure = normalizeStorageError(error, "browser応答の保存に失敗しました。");
      try { transaction.abort(); } catch { /* transaction側のerrorを使用する。 */ }
    };
    const finishReads = () => {
      remaining -= 1;
      if (remaining > 0 || failure) return;
      try {
        const next = responseCandidate(
          parentProgressToken,
          nextCurrent,
          groups,
          currentRead.result,
          new Map([...streamReads].map(([key, request]) => [key, request.result])),
          Boolean(options.replaceStreams)
        );

        if (options.replaceStreams) store.clear();
        for (const [key] of groups) {
          const stream = next.streams.get(key);
          if (stream) store.put(stream);
        }
        store.put(next.current);
        candidate = next;
      } catch (error) {
        abort(error);
      }
    };

    currentRead.onsuccess = finishReads;
    currentRead.onerror = () => abort(unavailable("browser currentの読込に失敗しました。", currentRead.error));
    for (const request of streamReads.values()) {
      request.onsuccess = finishReads;
      request.onerror = () => abort(unavailable("browser streamの読込に失敗しました。", request.error));
    }
    transaction.oncomplete = () => {
      if (!candidate) {
        reject(corrupt("browser保存transactionが結果なしで完了しました。"));
        return;
      }
      resolve(commitMirrors(candidate));
    };
    transaction.onabort = () => reject(failure ?? unavailable("browser保存transactionが中断されました。", transaction.error));
    transaction.onerror = () => undefined;
  });
}

export function clearBrowserPlayerStorage(options: { expectedProgressToken?: string | null } = {}) {
  return new Promise<void>((resolve, reject) => {
    const conditional = Object.prototype.hasOwnProperty.call(options, "expectedProgressToken");
    if (configuredStorage?.mode === "memory") {
      readyStorage();
      if (conditional && currentMirror?.progressToken !== (options.expectedProgressToken ?? undefined)) {
        throw conflict("browser保存を消去する親tokenが現在の進行と一致しません。");
      }
      clearMirrors();
      resolve();
      return;
    }
    const transaction = storageTransaction("readwrite");
    const store = idbCall("browser保存storeを開けません。", () => transaction.objectStore(STORE_NAME));
    const currentRead = conditional
      ? idbCall("browser currentの読込を開始できません。", () => store.get(CURRENT_KEY))
      : null;
    let failure: BrowserPlayerStorageError | null = null;

    const clear = () => {
      try {
        if (currentRead) {
          const stored = currentRead.result === undefined ? null : currentRecord(currentRead.result);
          if (stored?.progressToken !== (options.expectedProgressToken ?? undefined)) {
            throw conflict("browser保存を消去する親tokenが現在の進行と一致しません。");
          }
        }
        store.clear();
      } catch (error) {
        failure = normalizeStorageError(error, "browser保存の消去に失敗しました。");
        try { transaction.abort(); } catch { /* transaction側のerrorを使用する。 */ }
      }
    };
    if (currentRead) {
      currentRead.onsuccess = clear;
      currentRead.onerror = () => {
        failure = unavailable("browser currentの読込に失敗しました。", currentRead.error);
      };
    } else {
      clear();
    }
    transaction.oncomplete = () => {
      clearMirrors();
      resolve();
    };
    transaction.onabort = () => reject(failure ?? unavailable("browser保存の消去transactionが中断されました。", transaction.error));
    transaction.onerror = () => undefined;
  });
}
