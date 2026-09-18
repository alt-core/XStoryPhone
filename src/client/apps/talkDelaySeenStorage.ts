import { clientStorageKey, isMemoryStorage } from "../system/clientStorage.ts";

export type SeenMessageIdsByThread = Record<string, Set<string>>;
type TalkDelayScope = "messages" | "chat" | "search_agent";

const STORAGE_KEY = clientStorageKey("xstoryphone.talk-delay-seen");
const STORAGE_VERSION = 1;
const MAX_SCOPES = 24;
const MAX_THREADS_PER_SCOPE = 120;
const MAX_MESSAGE_IDS_PER_THREAD = 600;

type StoredTalkDelaySeen = {
  version: number;
  scopes?: Record<string, Record<string, string[]>>;
};

let memoryStore: StoredTalkDelaySeen = { version: STORAGE_VERSION, scopes: {} };
const clearedScopeKeys = new Set<string>();

function availableStorage() {
  if (isMemoryStorage) return undefined;
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function scopeKey(scope: TalkDelayScope, memoryKey: string) {
  return `${scope}:${stableHash(memoryKey || "local")}`;
}

function readStore(): StoredTalkDelaySeen {
  const storage = availableStorage();
  if (!storage) {
    return memoryStore;
  }

  let rawValue: string | null;
  try {
    rawValue = storage.getItem(STORAGE_KEY);
  } catch {
    return memoryStore;
  }
  if (!rawValue) {
    memoryStore = { version: STORAGE_VERSION, scopes: {} };
    return memoryStore;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredTalkDelaySeen;
    if (parsed.version !== STORAGE_VERSION || !parsed.scopes || typeof parsed.scopes !== "object" || Array.isArray(parsed.scopes)) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        // 読み込み不能な環境では、同一SPAセッションのmemoryStoreだけを使う。
      }
      memoryStore = { version: STORAGE_VERSION, scopes: {} };
      return memoryStore;
    }
    memoryStore = parsed;
    return parsed;
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // 読み込み不能な環境では、同一SPAセッションのmemoryStoreだけを使う。
    }
    memoryStore = { version: STORAGE_VERSION, scopes: {} };
    return memoryStore;
  }
}

function writeStore(store: StoredTalkDelaySeen) {
  memoryStore = store;
  const storage = availableStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage が使えない環境では、memoryStore による同一 SPA セッション内の記憶にフォールバックする。
  }
}

function storedScopeFromSeenMessages(seenMessages: SeenMessageIdsByThread) {
  return Object.fromEntries(
    Object.entries(seenMessages)
      .filter(([threadId]) => threadId.trim())
      .slice(-MAX_THREADS_PER_SCOPE)
      .map(([threadId, messageIds]) => [
        threadId,
        [...messageIds].filter((messageId) => messageId.trim()).slice(-MAX_MESSAGE_IDS_PER_THREAD)
      ])
      .filter(([, messageIds]) => messageIds.length)
  );
}

function seenMessagesFromStoredScope(scope: Record<string, string[]> | undefined): SeenMessageIdsByThread {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(scope)
      .filter(([threadId, messageIds]) => threadId.trim() && Array.isArray(messageIds))
      .map(([threadId, messageIds]) => [
        threadId,
        new Set(messageIds.filter((messageId) => typeof messageId === "string" && messageId.trim()))
      ])
  );
}

function mergeSeenMessages(base: SeenMessageIdsByThread, extra: SeenMessageIdsByThread): SeenMessageIdsByThread {
  const merged: SeenMessageIdsByThread = {};
  for (const [threadId, messageIds] of [...Object.entries(base), ...Object.entries(extra)]) {
    if (!merged[threadId]) {
      merged[threadId] = new Set<string>();
    }

    for (const messageId of messageIds) {
      merged[threadId].add(messageId);
    }
  }
  return merged;
}

export function loadTalkDelaySeenMessages(scope: TalkDelayScope, memoryKey: string): SeenMessageIdsByThread {
  clearedScopeKeys.delete(scopeKey(scope, memoryKey));
  const store = readStore();
  return seenMessagesFromStoredScope(store.scopes?.[scopeKey(scope, memoryKey)]);
}

export function saveTalkDelaySeenMessages(scope: TalkDelayScope, memoryKey: string, seenMessages: SeenMessageIdsByThread) {
  const store = readStore();
  const key = scopeKey(scope, memoryKey);
  if (clearedScopeKeys.has(key)) {
    return;
  }

  const scopes = { ...(store.scopes ?? {}) };
  const storedScope = storedScopeFromSeenMessages(mergeSeenMessages(seenMessagesFromStoredScope(scopes[key]), seenMessages));

  delete scopes[key];
  if (Object.keys(storedScope).length) {
    scopes[key] = storedScope;
  }

  writeStore({
    version: STORAGE_VERSION,
    scopes: Object.fromEntries(Object.entries(scopes).slice(-MAX_SCOPES))
  });
}

export function clearTalkDelaySeenMessagesForMemoryKey(memoryKey: string | undefined) {
  if (!memoryKey) {
    return;
  }

  const store = readStore();
  const scopes = { ...(store.scopes ?? {}) };
  const messagesScopeKey = scopeKey("messages", memoryKey);
  const chatScopeKey = scopeKey("chat", memoryKey);
  const searchAgentScopeKey = scopeKey("search_agent", memoryKey);
  clearedScopeKeys.add(messagesScopeKey);
  clearedScopeKeys.add(chatScopeKey);
  clearedScopeKeys.add(searchAgentScopeKey);
  delete scopes[messagesScopeKey];
  delete scopes[chatScopeKey];
  delete scopes[searchAgentScopeKey];
  writeStore({ version: STORAGE_VERSION, scopes });
}
