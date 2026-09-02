import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";

let moduleSerial = 0;
const SEARCH_AGENT_PUBLIC_TALK_ID = "t_search_agent";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); }
    }
  };
}

function installBrowserStorage(initial = {}) {
  const local = memoryStorage(initial);
  const session = memoryStorage();
  globalThis.window = {
    localStorage: local.storage,
    sessionStorage: session.storage
  };
  return local.values;
}

async function freshStorageModule() {
  moduleSerial += 1;
  return import(`../src/client/system/browserPlayerStorage.ts?browser-storage-test=${moduleSerial}`);
}

function smsMessage(seq, body = `メッセージ${seq}`) {
  return {
    seq,
    id: `sms-${seq}`,
    talkId: "guide",
    sender: seq % 2 ? "other" : "owner",
    body,
    attachment: null,
    sentAt: `2026-08-30T00:00:${String(seq).padStart(2, "0")}.000Z`
  };
}

function searchMessage(seq, body = `検索${seq}`) {
  return {
    seq,
    id: `search-${seq}`,
    kind: "message",
    talkId: SEARCH_AGENT_PUBLIC_TALK_ID,
    sender: seq % 2 ? "owner" : "other",
    body,
    sentAt: `2026-08-30T00:01:${String(seq).padStart(2, "0")}.000Z`
  };
}

function playerState({
  token,
  clientRevision = "client-current",
  talkLastSeq = 1,
  searchLastSeq = 0,
  talkTranscriptKey = "talk-key",
  searchTalkTranscriptKey = "search-key",
  deltas = [],
  initialMessages = [smsMessage(1, "初期メッセージ")],
  brokenHistoryRanges = []
}) {
  return {
    clientRevision,
    transcriptRevision: "transcript-current",
    revision: `revision-${token}`,
    stateVersion: Number(token.replace(/\D/gu, "")) || 1,
    nextScenarioWakeAt: null,
    scenarioTime: { date: "2026-08-30", timeLabel: "12:00" },
    projectState: {},
    visibleDeviceState: {
      messages: [{
        id: "guide",
        contentId: "guide",
        contactName: "案内",
        messages: initialMessages,
        ...(brokenHistoryRanges.length ? { brokenHistoryRanges } : {})
      }],
      chatThreads: []
    },
    todos: [],
    assistantMessages: [],
    contentStates: [],
    unlockedAttachments: [],
    talks: [{
      talkId: "guide",
      kind: "sms",
      canPost: true,
      turnKey: "turn-guide",
      transcriptKey: talkTranscriptKey,
      lastMessageSeq: talkLastSeq,
      historyRevision: 0,
      inputVisible: true,
      inputVisibleAfterSeq: 0,
      inputEnabled: true,
      inputEnabledAfterSeq: 0
    }, {
      talkId: SEARCH_AGENT_PUBLIC_TALK_ID,
      kind: "search_agent",
      label: "検索AIナビ",
      canPost: true,
      turnKey: "turn-search-agent",
      transcriptKey: searchTalkTranscriptKey,
      lastMessageSeq: searchLastSeq,
      historyRevision: 0,
      inputVisible: true,
      inputVisibleAfterSeq: searchLastSeq,
      inputEnabled: true,
      inputEnabledAfterSeq: 0
    }],
    transcriptDeltas: deltas,
    progressToken: token
  };
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
    transaction.onerror = () => undefined;
  });
}

async function openDatabase(projectId) {
  const request = globalThis.indexedDB.open(`xstoryphone-browser-player-${projectId}`, 2);
  const database = await new Promise((resolve, reject) => {
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("records")) {
        request.result.createObjectStore("records", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function recordsFor(projectId) {
  const database = await openDatabase(projectId);
  const transaction = database.transaction("records", "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore("records").getAll();
  const records = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await done;
  database.close();
  return records;
}

async function replaceCurrentToken(projectId, token) {
  const database = await openDatabase(projectId);
  const transaction = database.transaction("records", "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore("records");
  const request = store.get("current");
  request.onsuccess = () => store.put({ ...request.result, progressToken: token });
  await done;
  database.close();
}

test("browser player storage", async (suite) => {
  await suite.test("serverモードではIndexedDBへ触れない", async () => {
    installBrowserStorage();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() { throw new Error("IndexedDBへ触れました"); }
    });
    try {
      const storage = await freshStorageModule();
      await storage.initializeBrowserPlayerStorage({ enabled: false, projectId: "server", clientRevision: "client" });
      assert.equal(storage.loadBrowserPlayerMarker(), undefined);
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
      else delete globalThis.indexedDB;
    }
  });

  await suite.test("IndexedDBの同期例外をtyped storage errorへ変換する", async () => {
    installBrowserStorage();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() { throw new DOMException("blocked", "SecurityError"); }
    });
    try {
      const storage = await freshStorageModule();
      await assert.rejects(
        storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "unavailable", clientRevision: "client" }),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unavailable"
      );
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
      else delete globalThis.indexedDB;
    }
  });

  await suite.test("旧localStorage保存を一度だけ原子的に移行する", async () => {
    globalThis.indexedDB = new IDBFactory();
    const legacyState = {
      ...playerState({ token: "token-1", talkLastSeq: 2, searchLastSeq: 2 }),
      smsMessages: [smsMessage(2)],
      chatMessages: [],
      searchAgentMessages: [searchMessage(1), searchMessage(2)]
    };
    const values = installBrowserStorage({
      "xstoryphone.browser-save.v2": JSON.stringify({
        version: 2,
        progressToken: "token-1",
        clientRevision: "client-current",
        transcriptRevision: "transcript-current",
        transcripts: {
          talk: {
            guide: {
              kind: "sms",
              transcriptKey: "talk-key",
              messages: [smsMessage(2)]
            }
          },
          search: {
            transcriptKey: "search-key",
            messages: [searchMessage(1), searchMessage(2)]
          }
        }
      }),
      "xstoryphone.player-state-cache": JSON.stringify({
        version: 11,
        sessionToken: "token-1",
        playerState: legacyState
      }),
      "xstoryphone.ui": JSON.stringify({ version: 5, locked: false, sessionToken: "token-1", lastContentByAppId: {} })
    });
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "legacy", clientRevision: "client-current" });

    assert.equal(await storage.prepareBrowserPlayerRequest(), "token-1");
    assert.equal(storage.loadBrowserPlayerMarker(), storage.BROWSER_PLAYER_MARKER);
    assert.equal(storage.loadCachedBrowserPlayerState(), null, "旧snapshotは検索talk統合前のため再利用しない");
    assert.equal(values.has("xstoryphone.browser-save.v2"), false);
    assert.equal(values.has("xstoryphone.player-state-cache"), false);
    assert.equal("sessionToken" in JSON.parse(values.get("xstoryphone.ui")), false);
    assert.deepEqual((await recordsFor("legacy")).map((record) => record.key).sort(), ["current", "talk:guide"]);

    const prepared = await storage.prepareBrowserPlayerRequest();
    assert.equal(prepared, "token-1");
    const committed = await storage.commitBrowserPlayerResponse("token-1", playerState({
      token: "token-2",
      talkLastSeq: 3,
      searchLastSeq: 3,
      deltas: [
        { kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2), smsMessage(3)] },
        {
          kind: "search_agent",
          talkId: SEARCH_AGENT_PUBLIC_TALK_ID,
          transcriptKey: "search-key",
          messages: [searchMessage(1), searchMessage(2), searchMessage(3)]
        }
      ]
    }));
    assert.deepEqual(committed.smsMessages.map((message) => message.seq), [2, 3]);
    assert.deepEqual(committed.searchAgentMessages.map((message) => message.seq), [1, 2, 3]);
    assert.equal("progressToken" in committed, false);

    await replaceCurrentToken("legacy", "other-tab-token");
    await assert.rejects(
      storage.prepareBrowserPlayerRequest(),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
    );
    await replaceCurrentToken("legacy", "token-2");

    await assert.rejects(
      storage.commitBrowserPlayerResponse("wrong-parent", playerState({
        token: "token-3",
        talkLastSeq: 3,
        searchLastSeq: 3
      })),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
    );
    assert.equal((await recordsFor("legacy")).find((record) => record.key === "current").progressToken, "token-2");

    const reset = await storage.commitBrowserPlayerResponse("token-2", playerState({
      token: "token-4",
      talkLastSeq: 1,
      searchLastSeq: 0
    }), { replaceStreams: true });
    assert.deepEqual(reset.smsMessages, []);
    assert.deepEqual((await recordsFor("legacy")).map((record) => record.key), ["current"]);

    await assert.rejects(
      storage.clearBrowserPlayerStorage({ expectedProgressToken: "old-token" }),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
    );
    await storage.clearBrowserPlayerStorage({ expectedProgressToken: "token-4" });
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);
    assert.deepEqual(await recordsFor("legacy"), []);

    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage({
      "xstoryphone.browser-save.v2": JSON.stringify({
        version: 3,
        progressToken: "token-1",
        transcripts: {
          talk: { guide: { kind: "sms", transcriptKey: "talk-key", messages: [smsMessage(2)] } },
          search: { transcriptKey: "search-key", messages: [searchMessage(1), searchMessage(2)] }
        }
      }),
      "xstoryphone.player-state-cache": JSON.stringify({
        version: 11,
        sessionToken: "token-1",
        playerState: legacyState
      })
    });
    const version3Storage = await freshStorageModule();
    await version3Storage.initializeBrowserPlayerStorage({
      enabled: true,
      projectId: "legacy-v3",
      clientRevision: "client-current"
    });
    assert.equal(await version3Storage.prepareBrowserPlayerRequest(), "token-1");
  });

  await suite.test("不整合な旧保存は破棄し、移行書込失敗時は旧保存を残す", async () => {
    globalThis.indexedDB = new IDBFactory();
    const legacySave = ({ malformed = false } = {}) => ({
      "xstoryphone.browser-save.v2": JSON.stringify({
        version: 2,
        progressToken: "token-1",
        transcripts: {
          talk: { guide: { kind: "sms", transcriptKey: malformed ? "" : "talk-key", messages: [smsMessage(2)] } },
          search: { transcriptKey: "", messages: [] }
        }
      }),
      "xstoryphone.player-state-cache": JSON.stringify({
        version: 11,
        sessionToken: "token-1",
        playerState: {
          ...playerState({ token: "token-1", talkLastSeq: 2, clientRevision: "client-old" }),
          smsMessages: [smsMessage(2)],
          chatMessages: [],
          searchAgentMessages: []
        }
      })
    });
    const invalidValues = installBrowserStorage(legacySave({ malformed: true }));
    const invalidStorage = await freshStorageModule();
    await invalidStorage.initializeBrowserPlayerStorage({ enabled: true, projectId: "invalid-legacy", clientRevision: "client-current" });
    assert.equal(invalidStorage.loadBrowserPlayerMarker(), undefined);
    assert.equal(invalidValues.has("xstoryphone.browser-save.v2"), false);
    assert.deepEqual(await recordsFor("invalid-legacy"), []);

    globalThis.indexedDB = new IDBFactory();
    const failedValues = installBrowserStorage(legacySave());
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function putFailure() {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      const failedStorage = await freshStorageModule();
      await assert.rejects(
        failedStorage.initializeBrowserPlayerStorage({ enabled: true, projectId: "failed-legacy", clientRevision: "client-current" }),
        (error) => error instanceof failedStorage.BrowserPlayerStorageError && error.kind === "unavailable"
      );
      assert.equal(failedValues.has("xstoryphone.browser-save.v2"), true);
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    globalThis.indexedDB = new IDBFactory();
    const snapshotlessLegacy = legacySave();
    delete snapshotlessLegacy["xstoryphone.player-state-cache"];
    installBrowserStorage(snapshotlessLegacy);
    const snapshotlessStorage = await freshStorageModule();
    await snapshotlessStorage.initializeBrowserPlayerStorage({
      enabled: true,
      projectId: "snapshotless-legacy",
      clientRevision: "client-current"
    });
    await assert.rejects(
      snapshotlessStorage.commitBrowserPlayerResponse("token-1", playerState({
        token: "token-2",
        talkLastSeq: 3
      })),
      (error) => error instanceof snapshotlessStorage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
    assert.deepEqual(await recordsFor("snapshotless-legacy"), []);
  });

  await suite.test("seq欠番・異内容・不正な初回streamを保存せずrollbackする", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "sequence", clientRevision: "client-current" });

    await assert.rejects(
      storage.commitBrowserPlayerResponse(null, playerState({
        token: "token-1",
        talkLastSeq: 3,
        deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(3)] }]
      }), { replaceStreams: true }),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
    assert.deepEqual(await recordsFor("sequence"), []);

    await assert.rejects(
      storage.commitBrowserPlayerResponse(null, playerState({
        token: "token-1",
        talkLastSeq: 2,
        deltas: [{
          kind: "sms",
          talkId: "guide",
          transcriptKey: "talk-key",
          messages: [{ ...smsMessage(2), talkId: "different-talk" }]
        }]
      }), { replaceStreams: true }),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
    assert.deepEqual(await recordsFor("sequence"), []);

    await storage.commitBrowserPlayerResponse(null, playerState({
      token: "token-1",
      talkLastSeq: 2,
      deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2)] }]
    }), { replaceStreams: true });

    await assert.rejects(
      storage.commitBrowserPlayerResponse("token-1", playerState({
        token: "token-2",
        talkLastSeq: 2,
        searchLastSeq: 2,
        deltas: [{
          kind: "search_agent",
          talkId: SEARCH_AGENT_PUBLIC_TALK_ID,
          transcriptKey: "search-key",
          messages: [searchMessage(2)]
        }]
      })),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );

    await assert.rejects(
      storage.commitBrowserPlayerResponse("token-1", playerState({
        token: "token-2",
        talkLastSeq: 2,
        deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2, "異なる本文")] }]
      })),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
    await assert.rejects(
      storage.commitBrowserPlayerResponse("token-1", playerState({
        token: "token-2",
        talkLastSeq: 4,
        deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(4)] }]
      })),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
    assert.equal((await recordsFor("sequence")).find((record) => record.key === "current").progressToken, "token-1");

    const replaced = await storage.commitBrowserPlayerResponse("token-1", playerState({
      token: "token-2",
      talkLastSeq: 2,
      talkTranscriptKey: "talk-key-new",
      deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key-new", messages: [smsMessage(2)] }]
    }));
    assert.deepEqual(replaced.smsMessages.map((message) => message.seq), [2]);
    assert.equal((await recordsFor("sequence")).find((record) => record.key === "talk:guide").transcriptKey, "talk-key-new");

    const grouped = await storage.commitBrowserPlayerResponse("token-2", playerState({
      token: "token-3",
      talkLastSeq: 4,
      talkTranscriptKey: "talk-key-new",
      deltas: [
        { kind: "sms", talkId: "guide", transcriptKey: "talk-key-new", messages: [smsMessage(3)] },
        { kind: "sms", talkId: "guide", transcriptKey: "talk-key-new", messages: [smsMessage(4)] }
      ]
    }));
    assert.deepEqual(grouped.smsMessages.map((message) => message.seq), [2, 3, 4]);

    const afterBrokenInitialHistory = await storage.commitBrowserPlayerResponse("token-3", playerState({
      token: "token-4",
      talkLastSeq: 4,
      talkTranscriptKey: "talk-key-with-broken-history",
      initialMessages: [smsMessage(1), smsMessage(2)],
      brokenHistoryRanges: [{ beforeSeq: 4 }],
      deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key-with-broken-history", messages: [smsMessage(4)] }]
    }));
    assert.deepEqual(afterBrokenInitialHistory.smsMessages.map((message) => message.seq), [4]);

    await assert.rejects(
      storage.commitBrowserPlayerResponse("token-4", playerState({
        token: "token-3",
        talkLastSeq: 4,
        talkTranscriptKey: "talk-key-with-broken-history",
        initialMessages: [smsMessage(1), smsMessage(2)],
        brokenHistoryRanges: [{ beforeSeq: 4 }]
      })),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
    const sameVersionProjection = await storage.commitBrowserPlayerResponse("token-4", {
        ...playerState({
          token: "token-4-same-version",
          talkLastSeq: 4,
          talkTranscriptKey: "talk-key-with-broken-history",
          initialMessages: [smsMessage(1), smsMessage(2)],
          brokenHistoryRanges: [{ beforeSeq: 4 }]
        }),
        revision: "different-revision"
      });
    assert.equal(sameVersionProjection.revision, "different-revision");

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function failCurrentAfterStream(value, ...args) {
      if (value?.key === "current") throw new DOMException("quota", "QuotaExceededError");
      return originalPut.call(this, value, ...args);
    };
    try {
      await assert.rejects(
        storage.commitBrowserPlayerResponse("token-4-same-version", playerState({
          token: "token-5",
          talkLastSeq: 5,
          talkTranscriptKey: "talk-key-with-broken-history",
          initialMessages: [smsMessage(1), smsMessage(2)],
          brokenHistoryRanges: [{ beforeSeq: 4 }],
          deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key-with-broken-history", messages: [smsMessage(5)] }]
        })),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unavailable"
      );
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const recordsAfterAbort = await recordsFor("sequence");
    assert.equal(recordsAfterAbort.find((record) => record.key === "current").progressToken, "token-4-same-version");
    assert.deepEqual(recordsAfterAbort.find((record) => record.key === "talk:guide").messages.map((message) => message.seq), [4]);
  });

  await suite.test("古いclient revisionのsnapshotは表示せずtokenとstreamを維持する", async () => {
    globalThis.indexedDB = new IDBFactory();
    const values = installBrowserStorage();
    const oldModule = await freshStorageModule();
    await oldModule.initializeBrowserPlayerStorage({ enabled: true, projectId: "revision", clientRevision: "client-old" });
    await oldModule.commitBrowserPlayerResponse(null, playerState({
      token: "token-1",
      clientRevision: "client-old",
      talkLastSeq: 2,
      deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2)] }]
    }), { replaceStreams: true });
    values.set("xstoryphone.browser-save.v2", "旧browser保存");
    values.set("xstoryphone.player-state-cache", "旧表示cache");

    const newModule = await freshStorageModule();
    await newModule.initializeBrowserPlayerStorage({ enabled: true, projectId: "revision", clientRevision: "client-new" });
    assert.equal(await newModule.prepareBrowserPlayerRequest(), "token-1");
    assert.equal(newModule.loadCachedBrowserPlayerState(), null);
    assert.equal(newModule.loadBrowserPlayerMarker(), newModule.BROWSER_PLAYER_MARKER);
    assert.equal(values.has("xstoryphone.browser-save.v2"), false);
    assert.equal(values.has("xstoryphone.player-state-cache"), false);

    const refreshed = await newModule.commitBrowserPlayerResponse("token-1", playerState({
      token: "token-1-next",
      clientRevision: "client-new",
      talkLastSeq: 2,
      deltas: []
    }));
    assert.equal(refreshed.stateVersion, 1);
    assert.equal(refreshed.revision, "revision-token-1-next");
  });

  await suite.test("trim済み検索履歴では古い再送を無視して新しいseqだけを追加する", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "trimmed-search", clientRevision: "client-current" });
    await storage.commitBrowserPlayerResponse(null, playerState({
      token: "token-202",
      searchLastSeq: 202,
      deltas: [{
        kind: "search_agent",
        talkId: SEARCH_AGENT_PUBLIC_TALK_ID,
        transcriptKey: "search-key",
        messages: Array.from({ length: 202 }, (_, index) => searchMessage(index + 1))
      }]
    }), { replaceStreams: true });
    const next = await storage.commitBrowserPlayerResponse("token-202", playerState({
      token: "token-204",
      searchLastSeq: 204,
      deltas: [{
        kind: "search_agent",
        talkId: SEARCH_AGENT_PUBLIC_TALK_ID,
        transcriptKey: "search-key",
        messages: [searchMessage(1), searchMessage(2), searchMessage(203), searchMessage(204)]
      }]
    }));
    assert.equal(next.searchAgentMessages.length, 200);
    assert.equal(next.searchAgentMessages[0].seq, 5);
    assert.equal(next.searchAgentMessages.at(-1).seq, 204);
  });

  await suite.test("起動時にsnapshotとstreamの欠落を検出する", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const database = await openDatabase("broken");
    const transaction = database.transaction("records", "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore("records");
    const state = playerState({ token: "token-1", talkLastSeq: 3 });
    const { transcriptDeltas, progressToken, ...snapshot } = state;
    store.put({ key: "current", projectId: "broken", schemaVersion: 2, progressToken, publicState: snapshot });
    store.put({ key: "talk:guide", kind: "sms", transcriptKey: "talk-key", messages: [smsMessage(3)] });
    await done;
    database.close();

    const storage = await freshStorageModule();
    await assert.rejects(
      storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "broken", clientRevision: "client-current" }),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
  });
});
