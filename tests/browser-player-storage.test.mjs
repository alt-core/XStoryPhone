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

async function openDatabase(projectId, version = 2, prefix = "") {
  const request = globalThis.indexedDB.open(`${prefix ? `${prefix}:` : ""}xstoryphone-browser-player-${projectId}`, version);
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

async function recordsFor(projectId, prefix = "") {
  const database = await openDatabase(projectId, 2, prefix);
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
  await suite.test("作中の発話表示時刻は進行tokenとともに保存され、再読込と時計変更で変わらない", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const options = { enabled: true, projectId: "display-clock", clientRevision: "client-current" };
    const first = await freshStorageModule();
    await first.initializeBrowserPlayerStorage(options);
    const message = { ...smsMessage(2), displayTime: "12/31 23:59" };
    await first.commitBrowserPlayerResponse(null, playerState({
      token: "token-1", talkLastSeq: 2,
      deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [message] }]
    }), { replaceStreams: true });
    const second = await freshStorageModule();
    await second.initializeBrowserPlayerStorage(options);
    assert.deepEqual(second.loadCachedBrowserPlayerState().smsMessages, [message]);
    const next = playerState({ token: "token-2", talkLastSeq: 2 });
    next.scenarioTime = { date: "2028-02-03", timeLabel: "10:00" };
    await second.commitBrowserPlayerResponse("token-1", next);
    assert.deepEqual(second.loadCachedBrowserPlayerState().smsMessages, [message]);
  });

  for (const mode of ["persistent", "memory"]) {
    await suite.test(`${mode}: 検証・履歴merge・rollback・条件付きclearの共通契約`, async () => {
      globalThis.indexedDB = new IDBFactory();
      installBrowserStorage();
      const storage = await freshStorageModule();
      await storage.initializeBrowserPlayerStorage({
        enabled: true, projectId: `shared-${mode}`, clientRevision: "client-current", storage: { mode, prefix: "" }
      });
      const delta = (...messages) => ({ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages });
      await assert.rejects(storage.commitBrowserPlayerResponse(null, playerState({
        token: "token-1", talkLastSeq: 3, deltas: [delta(smsMessage(3))]
      }), { replaceStreams: true }), (error) => (
        error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
      ));
      assert.equal(await storage.prepareBrowserPlayerRequest(), null);
      assert.equal(storage.loadCachedBrowserPlayerState(), null);
      await storage.commitBrowserPlayerResponse(null, playerState({
        token: "token-2", talkLastSeq: 2, deltas: [delta(smsMessage(2))]
      }), { replaceStreams: true });
      const before = structuredClone(storage.loadCachedBrowserPlayerState());
      for (const [parent, response, kind] of [
        ["old-token", playerState({ token: "token-3", talkLastSeq: 2 }), "conflict"],
        ["token-2", playerState({ token: "token-1", talkLastSeq: 2 }), "corrupt"],
        ["token-2", playerState({ token: "token-3", talkLastSeq: 4, deltas: [delta(smsMessage(4))] }), "corrupt"],
        ["token-2", playerState({ token: "token-3", talkLastSeq: 2, deltas: [delta(smsMessage(2, "異なる本文"))] }), "corrupt"],
        ["token-2", playerState({ token: "token-3", talkLastSeq: 4, deltas: [delta(smsMessage(3))] }), "corrupt"],
        ["token-2", playerState({ token: "token-3", talkLastSeq: 3, deltas: [delta({ ...smsMessage(3), talkId: "別の会話" })] }), "corrupt"]
      ]) {
        await assert.rejects(storage.commitBrowserPlayerResponse(parent, response), (error) => (
          error instanceof storage.BrowserPlayerStorageError && error.kind === kind
        ));
        assert.equal(await storage.prepareBrowserPlayerRequest(), "token-2");
        assert.deepEqual(storage.loadCachedBrowserPlayerState(), before);
        if (mode === "persistent") {
          const records = await recordsFor(`shared-${mode}`);
          assert.equal(records.find((record) => record.key === "current").progressToken, "token-2");
          assert.deepEqual(records.find((record) => record.key === "talk:guide").messages.map((message) => message.seq), [2]);
        }
      }
      await assert.rejects(
        storage.clearBrowserPlayerStorage({ expectedProgressToken: "old-token" }),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
      );
      assert.deepEqual(storage.loadCachedBrowserPlayerState(), before);
      const incoming = smsMessage(3);
      const merged = await storage.commitBrowserPlayerResponse("token-2", {
        ...playerState({ token: "token-3", talkLastSeq: 3, deltas: [delta(smsMessage(2)), delta(incoming)] }),
        transcriptRevision: "transcript-updated",
        revision: "scenario-updated"
      });
      assert.deepEqual(merged.smsMessages.map((message) => message.seq), [2, 3]);
      assert.equal(merged.transcriptRevision, "transcript-updated");
      incoming.body = "呼出し元で変更";
      assert.equal(storage.loadCachedBrowserPlayerState().smsMessages.at(-1).body, "メッセージ3");
      await assert.rejects(
        storage.commitBrowserPlayerResponse("token-3", playerState({ token: "token-4", talkLastSeq: 3 }), { replaceStreams: true }),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
      );
      assert.equal(await storage.prepareBrowserPlayerRequest(), "token-3");
      assert.deepEqual(storage.loadCachedBrowserPlayerState().smsMessages.map((message) => message.seq), [2, 3]);
      const replaced = await storage.commitBrowserPlayerResponse("token-3", playerState({ token: "token-4" }), { replaceStreams: true });
      assert.deepEqual(replaced.smsMessages, []);
      await storage.clearBrowserPlayerStorage({ expectedProgressToken: "token-4" });
      assert.equal(await storage.prepareBrowserPlayerRequest(), null);
      assert.equal(storage.loadBrowserPlayerMarker(), undefined);
      assert.equal(storage.loadCachedBrowserPlayerState(), null);
      await assert.rejects(
        storage.commitBrowserPlayerResponse("token-4", playerState({ token: "token-5" })),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
      );
      await storage.commitBrowserPlayerResponse(null, playerState({ token: "token-5" }), { replaceStreams: true });
      assert.deepEqual(storage.loadCachedBrowserPlayerState().smsMessages, []);
    });
  }

  await suite.test("memoryは初期化前の削除・通常処理・終了でも既存の永続保存へ触れない", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const persistent = await freshStorageModule();
    await persistent.initializeBrowserPlayerStorage({ enabled: true, projectId: "untouched", clientRevision: "client-current" });
    await persistent.commitBrowserPlayerResponse(null, playerState({ token: "token-1" }));
    const retained = await recordsFor("untouched");
    const descriptors = [
      [globalThis, "indexedDB"], [globalThis.window, "localStorage"], [globalThis.window, "sessionStorage"]
    ].map(([object, key]) => ({ object, key, descriptor: Object.getOwnPropertyDescriptor(object, key) }));
    let accesses = 0;
    for (const { object, key } of descriptors) {
      Object.defineProperty(object, key, {
        configurable: true,
        get() { accesses += 1; throw new Error(`${key}へ触れました`); }
      });
    }
    try {
      const memory = await freshStorageModule();
      const settings = { mode: "memory", prefix: "" };
      await memory.deleteBrowserPlayerDatabase("untouched", settings);
      await memory.initializeBrowserPlayerStorage({
        enabled: true, projectId: "untouched", clientRevision: "client-current", storage: settings
      });
      assert.equal(await memory.prepareBrowserPlayerRequest(), null);
      await memory.commitBrowserPlayerResponse(null, playerState({ token: "token-2" }));
      await memory.clearBrowserPlayerStorage();
      await memory.commitBrowserPlayerResponse(null, playerState({ token: "token-3" }));
      await memory.deleteBrowserPlayerDatabase("untouched");
      assert.equal(memory.loadBrowserPlayerMarker(), undefined);
      assert.equal(memory.loadCachedBrowserPlayerState(), null);
      await memory.initializeBrowserPlayerStorage({ enabled: true, projectId: "untouched", clientRevision: "client-current" });
      assert.equal(await memory.prepareBrowserPlayerRequest(), null);
      assert.equal(accesses, 0);
    } finally {
      for (const { object, key, descriptor } of descriptors) {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else delete object[key];
      }
    }
    assert.deepEqual(await recordsFor("untouched"), retained);
    assert.equal(await persistent.prepareBrowserPlayerRequest(), "token-1");
  });

  await suite.test("memoryの別ページ・通常reloadは独立し、設定とprojectは実行中に切り替わらない", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const first = await freshStorageModule();
    const second = await freshStorageModule();
    const settings = { mode: "memory", prefix: "shared-prefix" };
    const options = { enabled: true, projectId: "independent", clientRevision: "client-current", storage: settings };
    await first.initializeBrowserPlayerStorage(options);
    await second.initializeBrowserPlayerStorage(options);
    await first.commitBrowserPlayerResponse(null, playerState({ token: "first-1" }));
    assert.equal(await second.prepareBrowserPlayerRequest(), null);
    await second.commitBrowserPlayerResponse(null, playerState({ token: "second-2" }));
    await first.clearBrowserPlayerStorage();
    assert.equal(await second.prepareBrowserPlayerRequest(), "second-2");
    await first.deleteBrowserPlayerDatabase("independent");
    assert.equal(await second.prepareBrowserPlayerRequest(), "second-2");
    const reload = await freshStorageModule();
    await reload.initializeBrowserPlayerStorage(options);
    assert.equal(await reload.prepareBrowserPlayerRequest(), null);
    for (const changed of [
      { ...options, projectId: "other-project" },
      { ...options, storage: { mode: "persistent", prefix: "shared-prefix" } },
      { ...options, storage: { mode: "memory", prefix: "other-prefix" } }
    ]) {
      await assert.rejects(first.initializeBrowserPlayerStorage(changed), (error) => (
        error instanceof first.BrowserPlayerStorageError && error.kind === "unavailable"
      ));
    }
    await assert.rejects(
      second.deleteBrowserPlayerDatabase("independent", { mode: "persistent", prefix: "shared-prefix" }),
      (error) => error instanceof second.BrowserPlayerStorageError && error.kind === "unavailable"
    );
    settings.mode = "persistent";
    settings.prefix = "mutated";
    assert.equal(await second.prepareBrowserPlayerRequest(), "second-2");
    assert.deepEqual(await globalThis.indexedDB.databases(), []);
  });

  await suite.test("prefix付きDBのopen・削除は旧保存と別prefixを読み込まず消さない", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const old = await freshStorageModule();
    await old.initializeBrowserPlayerStorage({ enabled: true, projectId: "namespaced", clientRevision: "client-current" });
    await old.commitBrowserPlayerResponse(null, playerState({ token: "old-1" }));
    const modules = new Map();
    for (const prefix of ["author-A", "author-B"]) {
      const storage = await freshStorageModule();
      await storage.initializeBrowserPlayerStorage({
        enabled: true, projectId: "namespaced", clientRevision: "client-current", storage: { mode: "persistent", prefix }
      });
      assert.equal(await storage.prepareBrowserPlayerRequest(), null);
      await storage.commitBrowserPlayerResponse(null, playerState({ token: `${prefix}-2` }));
      modules.set(prefix, storage);
    }
    await modules.get("author-A").deleteBrowserPlayerDatabase("namespaced");
    assert.equal(await modules.get("author-B").prepareBrowserPlayerRequest(), "author-B-2");
    assert.equal(await old.prepareBrowserPlayerRequest(), "old-1");
    assert.deepEqual((await globalThis.indexedDB.databases()).map((database) => database.name).sort(), [
      "author-B:xstoryphone-browser-player-namespaced", "xstoryphone-browser-player-namespaced"
    ]);
    const recovery = await freshStorageModule();
    await recovery.deleteBrowserPlayerDatabase("namespaced", { mode: "persistent", prefix: "author-B" });
    assert.deepEqual((await globalThis.indexedDB.databases()).map((database) => database.name), ["xstoryphone-browser-player-namespaced"]);
    assert.equal((await recordsFor("namespaced")).find((record) => record.key === "current").progressToken, "old-1");
  });

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
      await assert.rejects(
        storage.deleteBrowserPlayerDatabase("unavailable"),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unavailable"
      );
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
      else delete globalThis.indexedDB;
    }
  });

  await suite.test("現行保存の差分追加・別タブ競合・reset・条件付きclearを維持する", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "current", clientRevision: "client-current" });
    assert.equal(await storage.prepareBrowserPlayerRequest(), null);
    await storage.commitBrowserPlayerResponse(null, playerState({
      token: "token-1",
      talkLastSeq: 2,
      searchLastSeq: 2,
      deltas: [
        { kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2)] },
        {
          kind: "search_agent",
          talkId: SEARCH_AGENT_PUBLIC_TALK_ID,
          transcriptKey: "search-key",
          messages: [searchMessage(1), searchMessage(2)]
        }
      ]
    }));

    assert.equal(await storage.prepareBrowserPlayerRequest(), "token-1");
    assert.equal(storage.loadBrowserPlayerMarker(), storage.BROWSER_PLAYER_MARKER);
    assert.deepEqual(storage.loadCachedBrowserPlayerState().smsMessages.map((message) => message.seq), [2]);
    assert.deepEqual((await recordsFor("current")).map((record) => record.key).sort(), ["current", "talk:guide", `talk:${SEARCH_AGENT_PUBLIC_TALK_ID}`]);

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

    await replaceCurrentToken("current", "other-tab-token");
    await assert.rejects(
      storage.prepareBrowserPlayerRequest(),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
    );
    await replaceCurrentToken("current", "token-2");

    await assert.rejects(
      storage.commitBrowserPlayerResponse("wrong-parent", playerState({
        token: "token-3",
        talkLastSeq: 3,
        searchLastSeq: 3
      })),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
    );
    assert.equal((await recordsFor("current")).find((record) => record.key === "current").progressToken, "token-2");

    const reset = await storage.commitBrowserPlayerResponse("token-2", playerState({
      token: "token-4",
      talkLastSeq: 1,
      searchLastSeq: 0
    }), { replaceStreams: true });
    assert.deepEqual(reset.smsMessages, []);
    assert.deepEqual((await recordsFor("current")).map((record) => record.key), ["current"]);

    await assert.rejects(
      storage.clearBrowserPlayerStorage({ expectedProgressToken: "old-token" }),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "conflict"
    );
    await storage.clearBrowserPlayerStorage({ expectedProgressToken: "token-4" });
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);
    assert.deepEqual(await recordsFor("current"), []);
  });

  await suite.test("起動時にlocalStorageを参照・変更しない", async () => {
    globalThis.indexedDB = new IDBFactory();
    let localStorageAccesses = 0;
    globalThis.window = {
      get localStorage() {
        localStorageAccesses += 1;
        throw new Error("localStorageへ触れました");
      }
    };
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "indexeddb-only", clientRevision: "client-current" });
    assert.equal(localStorageAccesses, 0);
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);
    assert.deepEqual(await recordsFor("indexeddb-only"), []);
  });

  await suite.test("旧schemaとsnapshot欠落は補完・削除せずcorruptにする", async () => {
    for (const version of [1, 2]) {
      globalThis.indexedDB = new IDBFactory();
      installBrowserStorage();
      const projectId = `unsupported-record-${version}`;
      const database = await openDatabase(projectId, version);
      const transaction = database.transaction("records", "readwrite");
      const done = transactionDone(transaction);
      const records = [{ key: "current", projectId, schemaVersion: version, progressToken: "token-1", publicState: null }];
      if (version === 1) records.push({ key: "search", transcriptKey: "search-key", messages: [searchMessage(1)] });
      for (const record of records) transaction.objectStore("records").put(record);
      await done;
      database.close();

      const storage = await freshStorageModule();
      await assert.rejects(
        storage.initializeBrowserPlayerStorage({ enabled: true, projectId, clientRevision: "client-current" }),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
      );
      await assert.rejects(
        storage.commitBrowserPlayerResponse("token-1", playerState({ token: "token-2" })),
        (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
      );
      assert.deepEqual(await recordsFor(projectId), records);
    }
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
    installBrowserStorage();
    const oldModule = await freshStorageModule();
    await oldModule.initializeBrowserPlayerStorage({ enabled: true, projectId: "revision", clientRevision: "client-old" });
    await oldModule.commitBrowserPlayerResponse(null, playerState({
      token: "token-1",
      clientRevision: "client-old",
      talkLastSeq: 2,
      deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2)] }]
    }), { replaceStreams: true });

    const newModule = await freshStorageModule();
    await newModule.initializeBrowserPlayerStorage({ enabled: true, projectId: "revision", clientRevision: "client-new" });
    assert.equal(await newModule.prepareBrowserPlayerRequest(), "token-1");
    assert.equal(newModule.loadCachedBrowserPlayerState(), null);
    assert.equal(newModule.loadBrowserPlayerMarker(), newModule.BROWSER_PLAYER_MARKER);

    const refreshed = await newModule.commitBrowserPlayerResponse("token-1", playerState({
      token: "token-1-next",
      clientRevision: "client-new",
      talkLastSeq: 2,
      deltas: []
    }));
    assert.equal(refreshed.stateVersion, 1);
    assert.equal(refreshed.revision, "revision-token-1-next");
    assert.deepEqual(refreshed.smsMessages.map((message) => message.seq), [2]);
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
    assert.equal((await recordsFor("broken")).find((record) => record.key === "current").progressToken, "token-1");
    await storage.deleteBrowserPlayerDatabase("broken");
    assert.deepEqual(await globalThis.indexedDB.databases(), []);
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "broken", clientRevision: "client-current" });
    assert.equal(await storage.prepareBrowserPlayerRequest(), null);
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);
  });

  await suite.test("初期化前に壊れたschemaを含む指定projectだけを明示消去できる", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const retained = await freshStorageModule();
    await retained.initializeBrowserPlayerStorage({ enabled: true, projectId: "retained", clientRevision: "client-current" });
    await retained.commitBrowserPlayerResponse(null, playerState({ token: "token-1" }));

    const request = globalThis.indexedDB.open("xstoryphone-browser-player-broken-schema", 2);
    const brokenDatabase = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore("unexpected-store");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    brokenDatabase.close();

    const recovery = await freshStorageModule();
    await recovery.deleteBrowserPlayerDatabase("broken-schema");
    assert.deepEqual((await globalThis.indexedDB.databases()).map((database) => database.name), ["xstoryphone-browser-player-retained"]);
    assert.equal(await retained.prepareBrowserPlayerRequest(), "token-1");
    assert.equal((await recordsFor("retained")).find((record) => record.key === "current").progressToken, "token-1");
    await recovery.initializeBrowserPlayerStorage({ enabled: true, projectId: "broken-schema", clientRevision: "client-current" });
    assert.equal(await recovery.prepareBrowserPlayerRequest(), null);
  });

  await suite.test("接続済み保存の明示消去後に同じmoduleで新規開始できる", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "explicit-delete", clientRevision: "client-current" });
    await storage.commitBrowserPlayerResponse(null, playerState({
      token: "token-1",
      talkLastSeq: 2,
      deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2)] }]
    }));
    await storage.deleteBrowserPlayerDatabase("explicit-delete");
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);
    assert.equal(storage.loadCachedBrowserPlayerState(), null);
    assert.deepEqual(await globalThis.indexedDB.databases(), []);
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "explicit-delete", clientRevision: "client-current" });
    const restarted = await storage.commitBrowserPlayerResponse(null, playerState({ token: "token-2" }));
    assert.deepEqual(restarted.smsMessages, []);
    assert.equal(await storage.prepareBrowserPlayerRequest(), "token-2");
  });

  await suite.test("別projectを消去しても現在のconnectionとmirrorを維持する", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "active", clientRevision: "client-current" });
    await storage.commitBrowserPlayerResponse(null, playerState({ token: "token-1" }));
    const other = await openDatabase("other");
    other.close();
    await storage.deleteBrowserPlayerDatabase("other");
    assert.equal(await storage.prepareBrowserPlayerRequest(), "token-1");
    assert.equal(storage.loadBrowserPlayerMarker(), storage.BROWSER_PLAYER_MARKER);
    assert.deepEqual((await globalThis.indexedDB.databases()).map((database) => database.name), ["xstoryphone-browser-player-active"]);
  });

  await suite.test("別画面による明示消去のblockedを成功扱いにしない", async () => {
    globalThis.indexedDB = new IDBFactory();
    installBrowserStorage();
    const storage = await freshStorageModule();
    await storage.initializeBrowserPlayerStorage({ enabled: true, projectId: "blocked-delete", clientRevision: "client-current" });
    await storage.commitBrowserPlayerResponse(null, playerState({ token: "token-1" }));
    const blocker = await openDatabase("blocked-delete");
    try {
      await assert.rejects(
        storage.deleteBrowserPlayerDatabase("blocked-delete"),
        (error) => error instanceof storage.BrowserPlayerStorageError
          && error.kind === "unavailable"
          && error.message.includes("別の画面")
      );
      const transaction = blocker.transaction("records", "readonly");
      const done = transactionDone(transaction);
      const request = transaction.objectStore("records").get("current");
      const current = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await done;
      assert.equal(current.progressToken, "token-1");
      assert.equal(storage.loadBrowserPlayerMarker(), storage.BROWSER_PLAYER_MARKER);
    } finally {
      blocker.close();
    }
    // blockedで通知済みでも、要求した削除は他画面のconnection解放後に完了し得る。
    await storage.deleteBrowserPlayerDatabase("blocked-delete");
    assert.deepEqual(await globalThis.indexedDB.databases(), []);
  });

  await suite.test("明示消去の開始失敗とrequest errorをtyped errorにする", async () => {
    installBrowserStorage();
    const storage = await freshStorageModule();
    let calls = 0;
    globalThis.indexedDB = {
      deleteDatabase() {
        calls += 1;
        throw new DOMException("blocked", "SecurityError");
      }
    };
    await assert.rejects(
      storage.deleteBrowserPlayerDatabase(""),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unavailable"
    );
    assert.equal(calls, 0);
    await assert.rejects(
      storage.deleteBrowserPlayerDatabase("cannot-delete"),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unavailable"
    );
    globalThis.indexedDB = {
      deleteDatabase() {
        const request = { error: new DOMException("失敗", "UnknownError") };
        queueMicrotask(() => request.onerror());
        return request;
      }
    };
    await assert.rejects(
      storage.deleteBrowserPlayerDatabase("cannot-delete"),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unavailable"
    );
  });
});
