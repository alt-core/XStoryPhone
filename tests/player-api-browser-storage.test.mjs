import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

const SEARCH_AGENT_PUBLIC_TALK_ID = "t_search_agent";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

function smsMessage(seq) {
  return {
    seq,
    id: `guide-${seq}`,
    talkId: "guide",
    sender: seq % 2 ? "other" : "owner",
    body: `メッセージ${seq}`,
    attachment: null,
    sentAt: `2026-08-30T00:00:${String(seq).padStart(2, "0")}.000Z`
  };
}

function responseState({
  token,
  stateVersion,
  talkLastSeq = 1,
  talkTranscriptKey = "talk-key",
  searchTalkTranscriptKey = "search-key",
  deltas = []
}) {
  return {
    clientRevision: "client-test",
    transcriptRevision: "transcript-test",
    revision: `revision-${stateVersion}`,
    stateVersion,
    nextScenarioWakeAt: null,
    scenarioTime: { date: "2026-08-30", timeLabel: "12:00" },
    projectState: {},
    visibleDeviceState: {
      messages: [{
        id: "guide",
        contentId: "guide",
        contactName: "案内",
        messages: [smsMessage(1)]
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
      turnKey: `turn-${stateVersion}`,
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
      turnKey: `turn-search-${stateVersion}`,
      transcriptKey: searchTalkTranscriptKey,
      lastMessageSeq: 0,
      historyRevision: 0,
      inputVisible: true,
      inputVisibleAfterSeq: 0,
      inputEnabled: true,
      inputEnabledAfterSeq: 0
    }],
    transcriptDeltas: deltas,
    progressToken: token
  };
}

test("browser player APIはIndexedDB commit後だけ表示状態を返し、resetとunauthorizedを区別する", async () => {
  globalThis.indexedDB = new IDBFactory();
  const windowTarget = new EventTarget();
  windowTarget.localStorage = memoryStorage();
  windowTarget.sessionStorage = memoryStorage();
  globalThis.window = windowTarget;

  const storage = await import("../src/client/system/browserPlayerStorage.ts");
  const api = await import("../src/client/system/playerApi.ts");
  await storage.initializeBrowserPlayerStorage({
    enabled: true,
    projectId: "player-api-test",
    clientRevision: "client-test"
  });

  const requests = [];
  const responses = [
    {
      status: 200,
      body: {
        ok: true,
        sessionToken: "token-1",
        playerState: responseState({ token: "token-1", stateVersion: 1 })
      }
    },
    {
      status: 200,
      body: {
        ok: true,
        playerState: responseState({
          token: "token-2",
          stateVersion: 2,
          talkLastSeq: 2,
          deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(2)] }]
        })
      }
    },
    {
      status: 422,
      body: {
        ok: false,
        error: "rejected",
        playerState: responseState({ token: "token-3", stateVersion: 3, talkLastSeq: 2 })
      }
    },
    {
      status: 200,
      body: {
        ok: true,
        playerState: responseState({
          token: "token-4",
          stateVersion: 4,
          talkTranscriptKey: "talk-reset",
          searchTalkTranscriptKey: "search-reset"
        })
      }
    },
    { status: 401, body: { ok: false, error: "unauthorized" } }
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const next = responses.shift();
    assert.ok(next, `未定義のfetchです: ${String(url)}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const started = await api.startSession("");
    assert.equal(started.ok, true);
    assert.equal(started.sessionToken, storage.BROWSER_PLAYER_MARKER);
    assert.equal("progressToken" in started.playerState, false);
    assert.equal("transcriptDeltas" in started.playerState, false);

    const loaded = await api.loadPlayerState(storage.BROWSER_PLAYER_MARKER);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.playerState.smsMessages.map((message) => message.seq), [2]);
    assert.deepEqual(JSON.parse(requests[1].init.body), { progressToken: "token-1" });

    const rejectedReset = await api.resetPlayerState(storage.BROWSER_PLAYER_MARKER);
    assert.equal(rejectedReset.ok, false);
    assert.deepEqual(rejectedReset.playerState.smsMessages.map((message) => message.seq), [2]);
    assert.equal(await storage.prepareBrowserPlayerRequest(), "token-3");

    const reset = await api.resetPlayerState(storage.BROWSER_PLAYER_MARKER);
    assert.equal(reset.ok, true);
    assert.deepEqual(reset.playerState.smsMessages, []);
    assert.equal(await storage.prepareBrowserPlayerRequest(), "token-4");

    const unauthorized = await api.loadPlayerState(storage.BROWSER_PLAYER_MARKER);
    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.error, "unauthorized");
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);

    const requestCountAfterUnauthorized = requests.length;
    const alreadyCleared = await api.loadPlayerState(storage.BROWSER_PLAYER_MARKER);
    assert.equal(alreadyCleared.ok, false);
    assert.equal(alreadyCleared.error, "unauthorized");
    assert.equal(requests.length, requestCountAfterUnauthorized, "currentが空ならnetworkへ送らない");

    responses.push({
      status: 422,
      body: {
        ok: false,
        error: "start_rejected",
        playerState: responseState({ token: "ignored-token", stateVersion: 5 })
      }
    });
    const rejectedStart = await api.startSession("");
    assert.equal(rejectedStart.ok, false);
    assert.equal("playerState" in rejectedStart, false);
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);

    responses.push({
      status: 200,
      body: {
        ok: true,
        sessionToken: "token-6",
        playerState: responseState({ token: "token-6", stateVersion: 6 })
      }
    });
    assert.equal((await api.startSession("")).ok, true);
    await api.clearPlayerStorageForLogout();
    assert.equal(storage.loadBrowserPlayerMarker(), undefined);

    responses.push({
      status: 200,
      body: {
        ok: true,
        sessionToken: "broken-token",
        playerState: responseState({
          token: "broken-token",
          stateVersion: 5,
          talkLastSeq: 3,
          deltas: [{ kind: "sms", talkId: "guide", transcriptKey: "talk-key", messages: [smsMessage(3)] }]
        })
      }
    });
    let storageError;
    windowTarget.addEventListener(storage.BROWSER_PLAYER_STORAGE_ERROR_EVENT, (event) => {
      storageError = event.detail;
    }, { once: true });
    await assert.rejects(
      api.startSession(""),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "corrupt"
    );
    assert.equal(storageError?.kind, "corrupt");

    const requestCountAfterStorageError = requests.length;
    responses.push({
      status: 200,
      body: {
        ok: true,
        sessionToken: "token-6",
        playerState: responseState({ token: "token-6", stateVersion: 6 })
      }
    });
    await assert.rejects(
      api.startSession(""),
      (error) => error === storageError
    );
    assert.equal(requests.length, requestCountAfterStorageError, "storage error後はreloadまでnetworkへ送らない");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
