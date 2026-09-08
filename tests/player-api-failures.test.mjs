import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

function responseState(stateVersion) {
  return {
    clientRevision: "client-test",
    transcriptRevision: "transcript-test",
    revision: `revision-${stateVersion}`,
    stateVersion,
    nextScenarioWakeAt: null,
    scenarioTime: { date: "2026-09-07", timeLabel: "12:00" },
    projectState: { eventCount: stateVersion },
    visibleDeviceState: {},
    todos: [],
    assistantMessages: [],
    contentStates: [],
    unlockedAttachments: [],
    talks: [{
      talkId: "t_search_agent",
      kind: "search_agent",
      label: "検索AIナビ",
      canPost: true,
      turnKey: `turn-search-${stateVersion}`,
      transcriptKey: "search-key",
      lastMessageSeq: 0,
      historyRevision: 0,
      inputVisible: true,
      inputVisibleAfterSeq: 0,
      inputEnabled: true,
      inputEnabledAfterSeq: 0
    }],
    transcriptDeltas: [],
    progressToken: `token-${stateVersion}`
  };
}

test("API失敗のstatusは本文ではなくHTTP応答に従い、既存の再試行判定を維持する", async () => {
  const api = await import("../src/client/system/playerApi.ts");
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 408, 409, 413, 422, 429, 500, 502, 503, 504]) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        ok: false,
        error: "request_rejected",
        status: 200
      }), { status });
      const result = await api.verifyDevicePin("0000");
      assert.equal(result.ok, false);
      assert.equal(result.status, status);
      assert.equal(result.error, status === 429 ? "rate_limited" : "request_rejected");
      assert.equal(Boolean(result.retryable), [408, 429, 502, 503, 504].includes(status));
    }

    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: false, error: "event_not_callable", status: 422
    }), { status: 403 });
    assert.equal((await api.verifyDevicePin("0000")).status, 403, "本文による422の偽装を受け入れない");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("作品のinvalid_response拒否は再試行せず、JSON解析不正と実HTTPの一時障害は再試行する", async () => {
  const api = await import("../src/client/system/playerApi.ts");
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [409, 422, 500, 503]) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        ok: false, error: "invalid_response", status: 503
      }), { status });
      const result = await api.verifyDevicePin("0000");
      assert.equal(result.error, "invalid_response");
      assert.equal(result.status, status);
      assert.equal(Boolean(result.retryable), status === 503, "理由の文字列や本文statusでは再試行を追加しない");
    }

    for (const status of [200, 422, 503]) {
      for (const raw of ["{", "null", "[]", '{"ok":false,"error":123}']) {
        globalThis.fetch = async () => new Response(raw, { status });
        assert.deepEqual(await api.verifyDevicePin("0000"), {
          ok: false, error: "invalid_response", status, retryable: true
        }, "本当の解析不正はHTTP422でも既存の再試行対象にする");
      }
    }

    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: false, error: "request_rejected", retryable: true
    }), { status: 422 });
    assert.equal((await api.verifyDevicePin("0000")).retryable, true, "明示されたretryableは削除しない");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browserの作品拒否は保存後に元の理由を返し、不正422と実401を混同しない", async () => {
  globalThis.indexedDB = new IDBFactory();
  const windowTarget = new EventTarget();
  windowTarget.localStorage = memoryStorage();
  windowTarget.sessionStorage = memoryStorage();
  const originalWindow = globalThis.window;
  globalThis.window = windowTarget;
  const storage = await import("../src/client/system/browserPlayerStorage.ts");
  const api = await import("../src/client/system/playerApi.ts?stage-failures");
  await storage.initializeBrowserPlayerStorage({
    enabled: true,
    projectId: "player-api-failures-test",
    clientRevision: "client-test"
  });

  const responses = [];
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const next = responses.shift();
    assert.ok(next, `未定義のfetchです: ${String(url)}`);
    return new Response(next.raw ?? JSON.stringify(next.body), { status: next.status });
  };

  let storageErrorCount = 0;
  windowTarget.addEventListener(storage.BROWSER_PLAYER_STORAGE_ERROR_EVENT, () => { storageErrorCount += 1; });
  try {
    responses.push({
      status: 200,
      body: { ok: true, sessionToken: "token-1", playerState: responseState(1) }
    });
    assert.equal((await api.startSession("")).ok, true);

    let stateVersion = 1;
    for (const [status, error] of [
      [409, "incoming_call_active"],
      [422, "wrong_password"],
      [422, "conflict"],
      [422, "invalid_response"],
      [422, "unauthorized"],
      [422, "browser_progress_too_large"],
      [422, "llm_unavailable"]
    ]) {
      const parentToken = `token-${stateVersion}`;
      stateVersion += 1;
      responses.push({ status, body: {
        ok: false, error, status: 401, playerState: responseState(stateVersion)
      } });
      const rejected = await api.recordScenarioEvent(storage.BROWSER_PLAYER_MARKER, "stage.attempt");
      assert.equal(rejected.ok, false);
      assert.equal(rejected.error, error);
      assert.equal(rejected.status, status);
      assert.equal(Boolean(rejected.retryable), false, "正常な拒否に再試行指示を追加しない");
      assert.equal(rejected.playerState.stateVersion, stateVersion);
      assert.equal("progressToken" in rejected.playerState, false);
      assert.equal("transcriptDeltas" in rejected.playerState, false);
      assert.equal(JSON.parse(requests.at(-1).init.body).progressToken, parentToken);
      assert.equal(await storage.prepareBrowserPlayerRequest(), `token-${stateVersion}`, "拒否の状態も保存してから返す");
    }
    assert.equal(storageErrorCount, 0, "拒否理由の文字列だけでbrowser保存を停止しない");

    const beforeMalformed = storage.loadCachedBrowserPlayerState();
    for (const raw of [
      "{",
      "null",
      "[]",
      "false",
      JSON.stringify({ ok: "false", error: "wrong_password", playerState: responseState(8) }),
      JSON.stringify({ error: "wrong_password", playerState: responseState(8) }),
      JSON.stringify({ ok: false, error: 123, playerState: responseState(8) }),
      ...[null, false, [], "invalid-state"].map((playerState) => JSON.stringify({
        ok: false, error: "wrong_password", playerState
      }))
    ]) {
      responses.push({ status: 422, raw });
      const malformed = await api.recordScenarioEvent(storage.BROWSER_PLAYER_MARKER, "stage.attempt");
      assert.deepEqual(malformed, { ok: false, error: "invalid_response", status: 422, retryable: true });
      assert.equal(await storage.prepareBrowserPlayerRequest(), `token-${stateVersion}`);
      assert.deepEqual(storage.loadCachedBrowserPlayerState(), beforeMalformed, "不正な応答は保存しない");
    }
    assert.equal(storageErrorCount, 0, "不正JSONやenvelopeは保存停止ではなく再試行対象にする");

    responses.push({ status: 422, body: { ok: false, error: "wrong_password" } });
    const missingState = await api.recordScenarioEvent(storage.BROWSER_PLAYER_MARKER, "stage.attempt");
    assert.deepEqual(missingState, { ok: false, error: "wrong_password", status: 422 });

    stateVersion += 1;
    responses.push({ status: 200, body: { ok: true, playerState: responseState(stateVersion) } });
    assert.equal((await api.recordScenarioEvent(storage.BROWSER_PLAYER_MARKER, "stage.attempt")).ok, true);

    responses.push({ status: 401, body: { ok: false, error: "unauthorized", status: 422 } });
    const beforeUnauthorized = storage.loadCachedBrowserPlayerState();
    await assert.rejects(api.recordScenarioEvent(storage.BROWSER_PLAYER_MARKER, "stage.attempt"),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unauthorized");
    assert.deepEqual(storage.loadCachedBrowserPlayerState(), beforeUnauthorized);
    assert.equal(await storage.prepareBrowserPlayerRequest(), `token-${stateVersion}`);
    const requestCount = requests.length;
    await assert.rejects(api.recordScenarioEvent(storage.BROWSER_PLAYER_MARKER, "stage.attempt"),
      (error) => error instanceof storage.BrowserPlayerStorageError && error.kind === "unauthorized");
    assert.equal(requests.length, requestCount, "実401ではreloadまで送信を止める");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
