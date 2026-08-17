import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import { accessCodeCheckDigits } from "../src/server/accessCode.ts";
import { scenarioHookHandlers } from "../src/project/hooks.ts";
import { createInitialPlayerState, nextTalkTurnKey, reconcileScenarioState, workerScenario } from "../src/worker/scenario.ts";

const configuredPlayerMode = workerScenario.playerMode;
test.before(() => { workerScenario.playerMode = "server"; });
test.after(() => { workerScenario.playerMode = configuredPlayerMode; });

class MemoryStore {
  player = { id: "player-1", state: createInitialPlayerState(), stateVersion: 0 };
  transcripts = new Map();
  schedules = [];
  createCalls = 0;
  playerCalls = 0;
  reviewEvents = [];
  reviewJudgmentRows = [];
  reviewInputRequests = [];
  reviewTrialRequests = [];
  reviewClusterRows = [];
  replacedClusters = null;
  savedReviewTrial = null;
  updatedJudgment = null;
  saveConflictsRemaining = 0;
  accessCodeAttempts = new Map();
  lastAccessCode = null;
  playerInputReviewRows = [];
  playerInputReviewFilters = null;

  async createPasscodeSession(accessCode) {
    this.createCalls += 1;
    this.lastAccessCode = accessCode;
    return { playerId: this.player.id, sessionToken: "memory-token", created: true };
  }
  async isAccessCodeLocked(counter, at) {
    const attempt = this.accessCodeAttempts.get(counter);
    return Boolean(attempt?.lockedUntil && Date.parse(attempt.lockedUntil) > Date.parse(at));
  }
  async recordAccessCodeAttempt(counter, success, at) {
    if (success) this.accessCodeAttempts.delete(counter);
    else this.accessCodeAttempts.set(counter, { failedCount: (this.accessCodeAttempts.get(counter)?.failedCount ?? 0) + 1, updatedAt: at });
  }
  async playerForSession(token) {
    this.playerCalls += 1;
    return token === "memory-token" ? structuredClone(this.player) : null;
  }
  async loadTranscript(playerId, streamId, transcriptKey) {
    const transcript = this.transcripts.get(`${playerId}\0${streamId}`);
    return transcript?.transcriptKey === transcriptKey
      ? structuredClone(transcript)
      : { streamId, transcriptKey, messages: [] };
  }
  async savePlayer(player, nextState, transcripts = []) {
    if (this.saveConflictsRemaining > 0) {
      this.saveConflictsRemaining -= 1;
      return false;
    }
    if (player.stateVersion !== this.player.stateVersion) return false;
    this.player = { ...player, state: structuredClone(nextState), stateVersion: player.stateVersion + 1 };
    for (const transcript of transcripts) {
      this.transcripts.set(`${player.id}\0${transcript.streamId}`, structuredClone(transcript));
    }
    return true;
  }
  async clearPlayerRuntimeJobs() { this.schedules = []; }
  async queueScheduledEvent(playerId, scheduleId, eventId, fields, dueAt) {
    this.schedules.push({ id: scheduleId, scheduleId, eventId, fields, dueAt, playerId, status: "queued" });
  }
  async cancelScheduledEvent() {}
  async nextScheduledWakeAt() { return this.schedules.filter((item) => item.status !== "completed").map((item) => item.dueAt).sort()[0] ?? null; }
  async dueScheduledEvents(_playerId, at) {
    return this.schedules.filter((item) => item.status === "queued" && item.dueAt <= at).map((item) => structuredClone(item));
  }
  async claimScheduledEvent(_playerId, id) {
    const event = this.schedules.find((item) => item.id === id && item.status === "queued");
    if (!event) return false;
    event.status = "running";
    return true;
  }
  async completeScheduledEvent(_playerId, id) {
    const event = this.schedules.find((item) => item.id === id);
    if (event) event.status = "completed";
  }
  async requeueScheduledEvent(_playerId, id) {
    const event = this.schedules.find((item) => item.id === id);
    if (event) event.status = "queued";
  }
  async recordInputEvent() {}
  async playerInputEvents(filters) {
    this.playerInputReviewFilters = filters;
    return this.playerInputReviewRows;
  }
  async generatedAudioJob() { return null; }
  async saveGeneratedAudioJob() {}
  async pendingGeneratedAudioJobs() { return []; }
  async generatedAudioJobs() { return []; }
  async reviewJudgments() { return this.reviewJudgmentRows; }
  async reviewInputEvents(talkId, fromId) {
    this.reviewInputRequests.push([talkId, fromId]);
    return this.reviewEvents;
  }
  async reviewTrialInputs(talkId, fromId) {
    this.reviewTrialRequests.push([talkId, fromId]);
    return [];
  }
  async reviewClusters() { return this.reviewClusterRows; }
  async replaceReviewClusters(...args) { this.replacedClusters = args; }
  async saveReviewTrialInput(input) { this.savedReviewTrial = input; }
  async saveReviewJudgment() {}
  async updateReviewJudgment(...args) { this.updatedJudgment = args; }
  async updateReviewJudgmentStatus() {}
  async deleteReviewTrialInput() { return false; }
  async updateReviewJudgmentSourceIds() {}
}

test("共通HonoアプリはStoreを注入してセッション開始と状態取得を処理する", async () => {
  const store = new MemoryStore();
  const app = createApp({
    store,
    config: { appEnv: "development", playerInputLogging: false, llm: {} }
  });

  const health = await app.request("http://localhost/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const started = await app.request("http://localhost/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serialCode: "1234" })
  });
  assert.equal(started.status, 200);
  const startBody = await started.json();
  assert.equal(startBody.sessionToken, "memory-token");
  assert.equal(store.createCalls, 1);
  assert.ok(store.playerCalls >= 1);

  const state = await app.request("http://localhost/api/player-state", {
    method: "POST",
    headers: { authorization: "Bearer memory-token" }
  });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).playerState.stateVersion, store.player.stateVersion);

});

test("固定PINはクライアントへ正解を渡さずサーバーで一致判定する", async () => {
  const originalLockScreen = workerScenario.project.lockScreen;
  workerScenario.project.lockScreen = { method: "fixed-pin", pin: "0420" };
  try {
    const store = new MemoryStore();
    const app = createApp({
      store,
      config: { appEnv: "development", playerInputLogging: false, llm: {} }
    });
    const rejected = await app.request("http://localhost/api/device-pin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "1234" })
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, "invalid");

    const accepted = await app.request("http://localhost/api/device-pin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "0420" })
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).ok, true);
    assert.equal(store.createCalls, 0);
    assert.equal(store.playerCalls, 0);
  } finally {
    workerScenario.project.lockScreen = originalLockScreen;
  }
});

test("検索でtalk初期履歴blockを修復し、元のseqへ保存する", async () => {
  const store = new MemoryStore();
  const initialized = await reconcileScenarioState(store.player.state, store.player.id);
  store.player.state = initialized.state;
  for (const transcript of initialized.transcriptAppends) {
    store.transcripts.set(`${store.player.id}\0${transcript.streamId}`, structuredClone(transcript));
  }
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const historyContent = workerScenario.contents.find((content) => content.id === "guide_history_archive_a");
  const guide = workerScenario.talks.find((talk) => talk.id === "guide");
  assert.ok(historyContent);
  assert.ok(guide);

  const searched = await app.request("http://localhost/api/search-agent/search", {
    method: "POST",
    headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
    body: JSON.stringify({ query: "消えた連絡記録", requestId: "history-repair-search" })
  });
  assert.equal(searched.status, 200);
  const searchBody = await searched.json();
  assert.equal(searchBody.results[0]?.targetKind, "talk_history");
  assert.equal(searchBody.results[0]?.targetTalkId, guide.publicId);

  const opened = await app.request("http://localhost/api/content/opened", {
    method: "POST",
    headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
    body: JSON.stringify({ appId: "messages", contentId: historyContent.publicId })
  });
  assert.equal(opened.status, 200);
  const openedBody = await opened.json();
  const restoredDelta = openedBody.playerState.transcriptDeltas.find((delta) => delta.talkId === guide.publicId);
  assert.deepEqual(restoredDelta?.messages.map((message) => message.seq), [1, 2]);
  assert.ok(restoredDelta?.messages.every((message) => message.historyRepairId === historyContent.publicId));
  assert.deepEqual(
    openedBody.playerState.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId)?.brokenHistoryRanges,
    [{ beforeSeq: 4 }]
  );
  assert.equal(openedBody.playerState.talks.find((talk) => talk.talkId === guide.publicId)?.historyRevision, 1);
  assert.deepEqual(
    store.transcripts.get(`${store.player.id}\0talk:guide`).messages.map((message) => message.seq),
    [1, 2, 4]
  );
});

test("設定時だけアクセスコードのHMACチェック桁を検証する", async () => {
  const store = new MemoryStore();
  const secret = "paid-experience-secret";
  const counter = "0042";
  const checkDigits = await accessCodeCheckDigits(counter, secret);
  const app = createApp({
    store,
    config: { appEnv: "prod", accessCodeSecret: secret, playerInputLogging: false, llm: {} }
  });
  const invalidDigits = `${checkDigits[0] === "0" ? "1" : "0"}${checkDigits.slice(1)}`;
  const rejected = await app.request("https://example.test/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serialCode: `${invalidDigits}${counter}` })
  });
  assert.equal(rejected.status, 400);
  assert.equal(store.accessCodeAttempts.get(counter)?.failedCount, 1);

  const accepted = await app.request("https://example.test/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serialCode: `${checkDigits}${counter}` })
  });
  assert.equal(accepted.status, 200);
  assert.equal(store.lastAccessCode, counter);
  assert.equal(store.accessCodeAttempts.has(counter), false);
});

test("テストプレイ用進行リセットはdevとstgだけで公開ホストから利用できる", async () => {
  for (const appEnv of ["dev", "development", "stg", "staging"]) {
    const store = new MemoryStore();
    const app = createApp({ store, config: { appEnv, playerInputLogging: false, llm: {} } });
    const response = await app.request("https://example.com/api/reset-for-testing", {
      method: "POST",
      headers: { authorization: "Bearer memory-token" }
    });

    assert.equal(response.status, 200, `${appEnv}ではリセットできる`);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.playerState.todos.map((todo) => todo.id), ["find_old_note"]);
  }

  for (const appEnv of ["prod", "production"]) {
    const store = new MemoryStore();
    const app = createApp({ store, config: { appEnv, playerInputLogging: false, llm: {} } });
    const response = await app.request("http://localhost/api/reset-for-testing", {
      method: "POST",
      headers: { authorization: "Bearer memory-token" }
    });

    assert.equal(response.status, 404, `${appEnv}ではlocalhostでもリセットできない`);
    assert.equal(store.playerCalls, 0);
  }

  const publicStore = new MemoryStore();
  const publicApp = createApp({ store: publicStore, config: { playerInputLogging: false, llm: {} } });
  const publicResponse = await publicApp.request("https://example.com/api/reset-for-testing", {
    method: "POST",
    headers: { authorization: "Bearer memory-token" }
  });
  assert.equal(publicResponse.status, 404);
  assert.equal(publicStore.playerCalls, 0);

  const localStore = new MemoryStore();
  const localApp = createApp({ store: localStore, config: { playerInputLogging: false, llm: {} } });
  const localResponse = await localApp.request("http://localhost/api/reset-for-testing", {
    method: "POST",
    headers: { authorization: "Bearer memory-token" }
  });
  assert.equal(localResponse.status, 200);
});

test("browserモードはDBを使わず署名済み進行トークンと差分履歴で進行する", async () => {
  const store = new MemoryStore();
  const originalMode = workerScenario.playerMode;
  const originalRevision = workerScenario.revision;
  const originalScheduleHandler = scenarioHookHandlers.schedule_demo_call;
  const originalShowHandler = scenarioHookHandlers.show_demo_call;
  workerScenario.playerMode = "browser";
  workerScenario.clientCallableEvents.push("schedule_demo_call");
  scenarioHookHandlers.schedule_demo_call = (context) => {
    context.schedule.after("demo_call_once", 0, "show_demo_call");
  };
  try {
    const app = createApp({
      store,
      config: {
        appEnv: "production",
        browserStateSecret: "browser-mode-test-secret",
        playerInputLogging: false,
        llm: {}
      }
    });
    const started = await app.request("http://localhost/api/session/start", { method: "POST" });
    assert.equal(started.status, 200);
    const startBody = await started.json();
    let firstToken = startBody.playerState.progressToken;
    assert.equal(typeof firstToken, "string");
    assert.equal(startBody.sessionToken, firstToken);
    assert.ok(startBody.playerState.transcriptDeltas.some((delta) => delta.kind === "sms"));

    workerScenario.revision = `${originalRevision}-updated`;
    const refreshedAfterUpdate = await app.request("http://localhost/api/player-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: firstToken })
    });
    assert.equal(refreshedAfterUpdate.status, 200);
    const refreshedAfterUpdateBody = await refreshedAfterUpdate.json();
    assert.notEqual(refreshedAfterUpdateBody.playerState.progressToken, firstToken);
    firstToken = refreshedAfterUpdateBody.playerState.progressToken;

    const searched = await app.request("http://localhost/api/search-agent/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: firstToken, query: "古いメモ", requestId: "browser-search-1" })
    });
    assert.equal(searched.status, 200);
    const searchBody = await searched.json();
    const secondToken = searchBody.playerState.progressToken;
    assert.notEqual(secondToken, firstToken);
    assert.equal(searchBody.playerState.transcriptDeltas.at(-1)?.kind, "search");

    const oldNote = workerScenario.contents.find((content) => content.id === "old_note");
    const opened = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: secondToken, appId: "notes", contentId: oldNote.publicId })
    });
    assert.equal(opened.status, 200);
    const openedBody = await opened.json();

    const scheduled = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: openedBody.playerState.progressToken, eventId: "schedule_demo_call" })
    });
    assert.equal(scheduled.status, 200);
    const scheduledBody = await scheduled.json();
    assert.match(scheduledBody.playerState.nextScenarioWakeAt, /^\d{4}-/u);
    scenarioHookHandlers.show_demo_call = () => { throw new Error("一時的な予定イベント失敗"); };
    const originalConsoleError = console.error;
    console.error = () => {};
    let failedDue;
    try {
      failedDue = await app.request("http://localhost/api/player-state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progressToken: scheduledBody.playerState.progressToken })
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(failedDue.status, 503);
    scenarioHookHandlers.show_demo_call = originalShowHandler;
    const due = await app.request("http://localhost/api/player-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: scheduledBody.playerState.progressToken })
    });
    assert.equal(due.status, 200);
    assert.equal((await due.json()).playerState.visibleDeviceState.incomingCall.id, workerScenario.publicIds.incomingCall.demo_call);

    const rejected = await app.request("http://localhost/api/player-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: `${secondToken}x` })
    });
    assert.equal(rejected.status, 401);
    assert.equal(store.createCalls, 0);
    assert.equal(store.playerCalls, 0);
    assert.equal(store.transcripts.size, 0);
  } finally {
    workerScenario.playerMode = originalMode;
    workerScenario.revision = originalRevision;
    workerScenario.clientCallableEvents.pop();
    scenarioHookHandlers.schedule_demo_call = originalScheduleHandler;
    scenarioHookHandlers.show_demo_call = originalShowHandler;
  }
});

test("browserモードの既定署名鍵はローカル開発以外では使わない", async () => {
  const originalMode = workerScenario.playerMode;
  workerScenario.playerMode = "browser";
  try {
    const app = createApp({
      store: new MemoryStore(),
      config: { appEnv: "prod", playerInputLogging: false, llm: {} }
    });
    const response = await app.request("https://example.com/api/session/start", { method: "POST" });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "browser_state_secret_missing");
  } finally {
    workerScenario.playerMode = originalMode;
  }
});

test("browserモードでもtalk初期履歴blockを進行tokenと差分で修復する", async () => {
  const originalMode = workerScenario.playerMode;
  workerScenario.playerMode = "browser";
  try {
    const app = createApp({
      store: new MemoryStore(),
      config: {
        appEnv: "production",
        browserStateSecret: "browser-history-repair-secret",
        playerInputLogging: false,
        llm: {}
      }
    });
    const started = await app.request("http://localhost/api/session/start", { method: "POST" });
    const startBody = await started.json();
    const searched = await app.request("http://localhost/api/search-agent/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressToken: startBody.playerState.progressToken,
        query: "消えた連絡記録",
        requestId: "browser-history-repair-search"
      })
    });
    assert.equal(searched.status, 200);
    const searchBody = await searched.json();
    const historyContent = workerScenario.contents.find((content) => content.id === "guide_history_archive_a");
    assert.ok(historyContent);
    const opened = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressToken: searchBody.playerState.progressToken,
        appId: "messages",
        contentId: historyContent.publicId
      })
    });
    assert.equal(opened.status, 200);
    const openedBody = await opened.json();
    assert.equal(typeof openedBody.playerState.progressToken, "string");
    assert.deepEqual(
      openedBody.playerState.transcriptDeltas.find((delta) => delta.kind === "sms")?.messages.map((message) => message.seq),
      [1, 2]
    );
    assert.equal(openedBody.playerState.talks.find((talk) => talk.kind === "sms")?.historyRevision, 1);
  } finally {
    workerScenario.playerMode = originalMode;
  }
});

test("browserモードの進行データ上限超過は専用エラーで切り分けられる", async () => {
  const originalMode = workerScenario.playerMode;
  const oversizedSchedule = {
    id: "test_oversized_progress",
    eventId: "schedule_demo_call",
    delayMs: 60_000,
    fields: { padding: Array.from({ length: 3_000 }, () => crypto.randomUUID()).join("") }
  };
  workerScenario.playerMode = "browser";
  workerScenario.initialSchedules.push(oversizedSchedule);

  try {
    const app = createApp({
      store: new MemoryStore(),
      config: {
        appEnv: "production",
        browserStateSecret: "browser-mode-test-secret",
        playerInputLogging: false,
        llm: {}
      }
    });
    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    try {
      response = await app.request("http://localhost/api/session/start", { method: "POST" });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "browser_progress_too_large");
  } finally {
    workerScenario.playerMode = originalMode;
    workerScenario.initialSchedules.splice(workerScenario.initialSchedules.indexOf(oversizedSchedule), 1);
  }
});

test("prod表記でもlocalhostの認証緩和と監修認証省略を無効にする", async () => {
  const app = createApp({
    store: new MemoryStore(),
    config: { appEnv: "prod", playerInputLogging: false, llm: {} }
  });
  const shortCode = await app.request("http://localhost/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serialCode: "1234" })
  });
  assert.equal(shortCode.status, 400);

  const review = await app.request("http://localhost/api/admin/talk-branch-review/froms");
  assert.equal(review.status, 503);
});

test("同じturnKeyの会話再送はstaleとして本文と返信を二重保存しない", async () => {
  const store = new MemoryStore();
  let capturedTalkEvent = null;
  const talkHook = {
    event: "talk_sent",
    target: "guide",
    handler: "test_capture_talk_transition",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(talkHook);
  scenarioHookHandlers.test_capture_talk_transition = (_context, event) => { capturedTalkEvent = structuredClone(event); };
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  try {
    const started = await app.request("http://localhost/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serialCode: "1234" })
    });
    const startBody = await started.json();
    const talk = startBody.playerState.talks.find((item) => item.talkId === workerScenario.publicIds.talk.guide);
    assert.ok(talk);
    const request = () => app.request("http://localhost/api/talk/send", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ talkId: talk.talkId, message: "見つけた", turnKey: talk.turnKey })
    });

    const sent = await request();
    assert.equal(sent.status, 200);
    const sentBody = await sent.json();
    assert.equal(sentBody.stale, undefined);
    assert.equal(capturedTalkEvent.target, "guide");
    assert.equal(capturedTalkEvent.playerInput, "見つけた");
    assert.equal(capturedTalkEvent.ruleId, capturedTalkEvent.fields.ruleId);
    assert.equal(capturedTalkEvent.fields.kind, "sms");
    assert.ok(capturedTalkEvent.fields.fromId);
    assert.ok(capturedTalkEvent.fields.nextFromId);
    const nextTalk = sentBody.playerState.talks.find((item) => item.talkId === talk.talkId);
    assert.equal(
      nextTalk.turnKey,
      await nextTalkTurnKey(store.player.id, "guide", talk.turnKey, capturedTalkEvent.fields.nextFromId)
    );
    const transcriptAfterSend = structuredClone(store.transcripts.get(`${store.player.id}\0talk:guide`));
    assert.ok(transcriptAfterSend.messages.some((message) => message.sender === "owner" && message.body === "見つけた"));

    const replayed = await request();
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json()).stale, true);
    assert.deepEqual(store.transcripts.get(`${store.player.id}\0talk:guide`), transcriptAfterSend);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(talkHook), 1);
    delete scenarioHookHandlers.test_capture_talk_transition;
  }
});

test("会話を開いた時に表示済みの通常添付だけをアルバムへ同期する", async () => {
  const store = new MemoryStore();
  store.player.state = (await reconcileScenarioState(store.player.state, store.player.id)).state;
  store.player.state.revealedAttachmentContentIds.push("rainy_window", "sealed_note");
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const response = await app.request("http://localhost/api/content/opened", {
    method: "POST",
    headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
    body: JSON.stringify({
      appId: "messages",
      contentId: workerScenario.publicIds.talk.guide,
      mediaContentIds: [
        workerScenario.publicIds.content.rainy_window,
        workerScenario.publicIds.content.sealed_note
      ]
    })
  });
  assert.equal(response.status, 200);
  assert.ok(store.player.state.repairedContentIds.includes("rainy_window"));
  assert.equal(store.player.state.repairedContentIds.includes("sealed_note"), false);
});

test("修復対象を開く時は修復hookの後に開封hookを実行する", async () => {
  const store = new MemoryStore();
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const order = [];
  const repairedHook = {
    event: "content_repaired",
    target: "old_note",
    handler: "test_capture_repaired_order",
    cond: "",
    llm: false
  };
  const openedHook = {
    event: "content_opened",
    target: "old_note",
    handler: "test_capture_opened_order",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(repairedHook, openedHook);
  scenarioHookHandlers.test_capture_repaired_order = () => { order.push("repaired"); };
  scenarioHookHandlers.test_capture_opened_order = () => { order.push("opened"); };
  try {
    const searched = await app.request("http://localhost/api/search-agent/search", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ query: "古いメモ", requestId: "repair-order-search" })
    });
    assert.equal(searched.status, 200);

    const opened = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ appId: "notes", contentId: workerScenario.publicIds.content.old_note })
    });
    assert.equal(opened.status, 200);
    assert.deepEqual(order, ["repaired", "opened"]);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(repairedHook), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(openedHook), 1);
    delete scenarioHookHandlers.test_capture_repaired_order;
    delete scenarioHookHandlers.test_capture_opened_order;
  }
});

test("開封hookは同じコンテンツを開くたびに実行する", async () => {
  const store = new MemoryStore();
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  let openedCount = 0;
  const openedHook = {
    event: "content_opened",
    target: "welcome_note",
    handler: "test_count_content_opened",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(openedHook);
  scenarioHookHandlers.test_count_content_opened = () => { openedCount += 1; };
  try {
    for (let index = 0; index < 2; index += 1) {
      const opened = await app.request("http://localhost/api/content/opened", {
        method: "POST",
        headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
        body: JSON.stringify({ appId: "notes", contentId: workerScenario.publicIds.content.welcome_note })
      });
      assert.equal(opened.status, 200);
    }
    assert.equal(openedCount, 2);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(openedHook), 1);
    delete scenarioHookHandlers.test_count_content_opened;
  }
});

test("開封hookが新しく出した同一対象の通知を同じrequestで消さない", async () => {
  const store = new MemoryStore();
  workerScenario.stateVariables.test_open_notification = false;
  const notification = {
    id: "test_open_notification",
    appId: "notes",
    targetContentId: "welcome_note",
    title: "新しい通知",
    body: "hook後に表示",
    cond: "test_open_notification"
  };
  const hook = {
    event: "content_opened",
    target: "welcome_note",
    handler: "test_open_notification",
    cond: "!test_open_notification",
    llm: false
  };
  workerScenario.notifications.push(notification);
  workerScenario.publicIds.notification.test_open_notification = "notification_test_open";
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_open_notification = (context) => context.state.set("test_open_notification", true);
  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const response = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ appId: "notes", contentId: workerScenario.publicIds.content.welcome_note })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.playerState.visibleDeviceState.notifications.some((item) => item.id === "notification_test_open"));
    assert.equal(store.player.state.clearedNotificationIds.includes(notification.id), false);
  } finally {
    workerScenario.notifications.splice(workerScenario.notifications.indexOf(notification), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete workerScenario.publicIds.notification.test_open_notification;
    delete workerScenario.stateVariables.test_open_notification;
    delete scenarioHookHandlers.test_open_notification;
  }
});

test("メッセージ内リンクhookへ照合済みの遷移先を渡す", async () => {
  const store = new MemoryStore();
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  const content = workerScenario.contents.find((item) => item.id === "welcome_note");
  assert.ok(talk);
  assert.ok(content);
  store.player.state = (await reconcileScenarioState(store.player.state, store.player.id)).state;
  store.player.state.revealedMessageLinks.push({
    id: "verified-message:link:1",
    talkId: talk.id,
    appId: content.appId,
    contentId: content.id,
    actionId: "verified_action"
  });
  let capturedEvent = null;
  const linkHook = {
    event: "scenario_event",
    target: "message_link_opened",
    handler: "test_capture_message_link",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(linkHook);
  scenarioHookHandlers.test_capture_message_link = (_context, event) => { capturedEvent = structuredClone(event); };
  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const response = await app.request("http://localhost/api/message-link/open", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({
        talkId: talk.publicId,
        messageRef: "verified-message",
        segmentIndex: 0
      })
    });
    assert.equal(response.status, 200);
    assert.equal(capturedEvent?.fields.actionId, "verified_action");
    assert.equal(capturedEvent?.fields.talkId, talk.id);
    assert.equal(capturedEvent?.fields.appId, content.appId);
    assert.equal(capturedEvent?.fields.contentId, content.id);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(linkHook), 1);
    delete scenarioHookHandlers.test_capture_message_link;
  }
});

test("到達済み能力がなければ修復・添付解錠・会話リンクを直接呼べない", async () => {
  const store = new MemoryStore();
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  await app.request("http://localhost/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serialCode: "1234" })
  });
  const oldNoteId = workerScenario.publicIds.content.old_note;
  const sealedNoteId = workerScenario.publicIds.content.sealed_note;
  const guideId = workerScenario.publicIds.talk.guide;
  const authorization = "Bearer memory-token";

  const directOpen = await app.request("http://localhost/api/content/opened", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ appId: "notes", contentId: oldNoteId })
  });
  assert.equal(directOpen.status, 409);

  const directUnlock = await app.request("http://localhost/api/content/unlock", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ contentId: sealedNoteId, password: "0420" })
  });
  assert.equal(directUnlock.status, 409);

  const directLink = await app.request("http://localhost/api/message-link/open", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ talkId: guideId, messageRef: "guessed-message", segmentIndex: 0 })
  });
  assert.equal(directLink.status, 409);

  const transcript = await app.request(`http://localhost/api/transcript/${guideId}?after=0`, {
    headers: { authorization }
  });
  assert.equal(transcript.status, 200);
  assert.ok((await transcript.json()).delta.messages.length > 0);

  const searched = await app.request("http://localhost/api/search-agent/search", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ query: "古いメモ", requestId: "server-search-1" })
  });
  assert.equal(searched.status, 200);
  const reachedOpen = await app.request("http://localhost/api/content/opened", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ appId: "notes", contentId: oldNoteId })
  });
  assert.equal(reachedOpen.status, 200);
});

test("鍵付き添付は到達後にNFKC正規化したパスワードhashで解錠する", async () => {
  const store = new MemoryStore();
  store.player.state.stateValues.image_color_reported = true;
  store.player.state.revealedAttachmentContentIds.push("sealed_note");
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const response = await app.request("http://localhost/api/content/unlock", {
    method: "POST",
    headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
    body: JSON.stringify({ contentId: workerScenario.publicIds.content.sealed_note, password: "０４２０" })
  });
  assert.equal(response.status, 200);
  assert.ok(store.player.state.unlockedContentIds.includes("sealed_note"));
});

test("完了イベントの状態更新後に期限到来済み予約イベントを評価する", async () => {
  const store = new MemoryStore();
  const completionHook = {
    event: "scenario_event",
    target: "audio_playback_completed",
    handler: "test_mark_completion",
    cond: "!test_completion",
    llm: false
  };
  const scheduledHook = {
    event: "scenario_event",
    target: "test_after_completion",
    handler: "test_apply_scheduled",
    cond: "test_completion && !test_scheduled",
    llm: false
  };
  workerScenario.stateVariables.test_completion = false;
  workerScenario.stateVariables.test_scheduled = false;
  store.player.state.stateValues.test_completion = false;
  store.player.state.stateValues.test_scheduled = false;
  workerScenario.hooks.push(completionHook, scheduledHook);
  scenarioHookHandlers.test_mark_completion = (context) => context.state.set("test_completion", true);
  scenarioHookHandlers.test_apply_scheduled = (context) => context.state.set("test_scheduled", true);
  store.schedules.push({
    id: "event-1",
    scheduleId: "schedule-1",
    eventId: "test_after_completion",
    fields: {},
    dueAt: "2000-01-01T00:00:00.000Z",
    playerId: store.player.id,
    status: "queued"
  });

  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const response = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "audio_playback_completed", fields: { contentId: "sample_radio" } })
    });
    assert.equal(response.status, 200);
    assert.equal(store.player.state.stateValues.test_completion, true);
    assert.equal(store.player.state.stateValues.test_scheduled, true);
    assert.equal(store.schedules[0].status, "completed");
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(completionHook), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(scheduledHook), 1);
    delete workerScenario.stateVariables.test_completion;
    delete workerScenario.stateVariables.test_scheduled;
    delete scenarioHookHandlers.test_mark_completion;
    delete scenarioHookHandlers.test_apply_scheduled;
  }
});

test("期限到来した着信は後続予約と通常操作を止め、通話完了後に再開する", async () => {
  const store = new MemoryStore();
  workerScenario.stateVariables.test_after_incoming = false;
  const afterIncomingHook = {
    event: "scenario_event",
    target: "test_after_incoming",
    handler: "test_after_incoming",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(afterIncomingHook);
  scenarioHookHandlers.test_after_incoming = (context) => context.state.set("test_after_incoming", true);
  for (const [id, eventId] of [["incoming-event", "show_demo_call"], ["after-event", "test_after_incoming"]]) {
    store.schedules.push({
      id,
      scheduleId: id,
      eventId,
      fields: {},
      dueAt: "2000-01-01T00:00:00.000Z",
      playerId: store.player.id,
      status: "queued"
    });
  }

  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const interrupted = await app.request("http://localhost/api/search-agent/search", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ query: "古いメモ", requestId: "interrupted-search" })
    });
    assert.equal(interrupted.status, 409);
    const interruptedBody = await interrupted.json();
    assert.equal(interruptedBody.error, "incoming_call_active");
    assert.equal(interruptedBody.playerState.visibleDeviceState.incomingCall.id, workerScenario.publicIds.incomingCall.demo_call);
    assert.equal(store.player.state.incomingCallId, "demo_call");
    assert.equal(store.schedules[0].status, "completed");
    assert.equal(store.schedules[1].status, "queued");
    assert.equal(store.player.state.stateValues.test_after_incoming, undefined);

    const completed = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "incoming_call_completed", fields: { callId: workerScenario.publicIds.incomingCall.demo_call } })
    });
    assert.equal(completed.status, 200);
    assert.equal(store.player.state.incomingCallId, null);
    assert.equal(store.player.state.stateValues.test_after_incoming, true);
    assert.equal(store.schedules[1].status, "completed");
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(afterIncomingHook), 1);
    delete scenarioHookHandlers.test_after_incoming;
    delete workerScenario.stateVariables.test_after_incoming;
  }
});

test("完了イベントの保存競合では予約を先に消費せず、再送時に因果順を保つ", async () => {
  const store = new MemoryStore();
  const initialized = await reconcileScenarioState(store.player.state, store.player.id);
  store.player.state = initialized.state;
  for (const transcript of initialized.transcriptAppends) {
    store.transcripts.set(`${store.player.id}\0${transcript.streamId}`, structuredClone(transcript));
  }
  const completionHook = {
    event: "scenario_event",
    target: "audio_playback_completed",
    handler: "test_mark_completion_conflict",
    cond: "!test_completion_conflict",
    llm: false
  };
  const scheduledHook = {
    event: "scenario_event",
    target: "test_after_completion_conflict",
    handler: "test_apply_scheduled_conflict",
    cond: "test_completion_conflict && !test_scheduled_conflict",
    llm: false
  };
  workerScenario.stateVariables.test_completion_conflict = false;
  workerScenario.stateVariables.test_scheduled_conflict = false;
  workerScenario.hooks.push(completionHook, scheduledHook);
  scenarioHookHandlers.test_mark_completion_conflict = (context) => context.state.set("test_completion_conflict", true);
  scenarioHookHandlers.test_apply_scheduled_conflict = (context) => context.state.set("test_scheduled_conflict", true);
  store.schedules.push({
    id: "event-conflict",
    scheduleId: "schedule-conflict",
    eventId: "test_after_completion_conflict",
    fields: {},
    dueAt: "2000-01-01T00:00:00.000Z",
    playerId: store.player.id,
    status: "queued"
  });
  store.saveConflictsRemaining = 1;

  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const request = () => app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "audio_playback_completed", fields: { contentId: "sample_radio" } })
    });
    const conflicted = await request();
    assert.equal(conflicted.status, 409);
    assert.equal(store.schedules[0].status, "queued");

    const retried = await request();
    assert.equal(retried.status, 200);
    assert.equal(store.player.state.stateValues.test_completion_conflict, true);
    assert.equal(store.player.state.stateValues.test_scheduled_conflict, true);
    assert.equal(store.schedules[0].status, "completed");
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(completionHook), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(scheduledHook), 1);
    delete workerScenario.stateVariables.test_completion_conflict;
    delete workerScenario.stateVariables.test_scheduled_conflict;
    delete scenarioHookHandlers.test_mark_completion_conflict;
    delete scenarioHookHandlers.test_apply_scheduled_conflict;
  }
});

test("クライアントからの作品固有イベントは明示許可されたtargetだけを受理する", async () => {
  const store = new MemoryStore();
  store.player.state.stateValues.sealed_note_unlocked = true;
  workerScenario.stateVariables.test_client_secondary = false;
  store.player.state.stateValues.test_client_secondary = false;
  const secondaryHook = {
    event: "scenario_event",
    target: "chat_auth_link_requested",
    handler: "test_client_secondary",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(secondaryHook);
  scenarioHookHandlers.test_client_secondary = (context) => context.state.set("test_client_secondary", true);

  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const denied = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "show_demo_call" })
    });
    assert.equal(denied.status, 403);
    assert.equal(store.player.state.incomingCallId, null);

    const allowed = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "chat_auth_link_requested" })
    });
    assert.equal(allowed.status, 200);
    assert.equal(store.player.state.stateValues.chat_auth_link_sent, true);
    assert.equal(store.player.state.stateValues.test_client_secondary, true);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(secondaryHook), 1);
    delete workerScenario.stateVariables.test_client_secondary;
    delete scenarioHookHandlers.test_client_secondary;
  }
});

test("フォーム送信は現在利用可能なコンテンツに定義されたIDだけを受理する", async () => {
  const store = new MemoryStore();
  const content = workerScenario.contents.find((item) => item.id === "sample_radio");
  assert.ok(content);
  const originalForm = content.record.form;
  const originalFormDisabledCond = content.record.formDisabledCond;
  const originalPublicFormId = workerScenario.publicIds.form.demo_form;
  let capturedEvent = null;
  const formHook = {
    event: "scenario_event",
    target: "demo_form",
    handler: "test_capture_form_context",
    cond: "",
    llm: false
  };
  content.record.form = { kind: "html", id: "demo_form", label: "テスト", url: "/test" };
  content.record.formDisabledCond = "radio_playback_completed";
  workerScenario.publicIds.form.demo_form = "form_demo_public";
  workerScenario.hooks.push(formHook);
  scenarioHookHandlers.test_capture_form_context = (_context, event) => { capturedEvent = structuredClone(event); };
  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const invalid = await app.request("http://localhost/api/form/submit", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ formId: "unknown_form", fields: {} })
    });
    assert.equal(invalid.status, 409);

    const valid = await app.request("http://localhost/api/form/submit", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ formId: workerScenario.publicIds.form.demo_form, fields: { message: "確認" } })
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).gameOver?.kind, "form");
    assert.equal(capturedEvent?.fields.message, "確認");
    assert.equal(capturedEvent?.fields.formId, "demo_form");
    assert.equal(capturedEvent?.fields.appId, content.appId);
    assert.equal(capturedEvent?.fields.contentId, content.id);

    store.player.state.stateValues.radio_playback_completed = true;
    const disabled = await app.request("http://localhost/api/form/submit", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ formId: workerScenario.publicIds.form.demo_form, fields: {} })
    });
    assert.equal(disabled.status, 409);
  } finally {
    if (originalForm === undefined) delete content.record.form;
    else content.record.form = originalForm;
    if (originalFormDisabledCond === undefined) delete content.record.formDisabledCond;
    else content.record.formDisabledCond = originalFormDisabledCond;
    if (originalPublicFormId) workerScenario.publicIds.form.demo_form = originalPublicFormId;
    else delete workerScenario.publicIds.form.demo_form;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(formHook), 1);
    delete scenarioHookHandlers.test_capture_form_context;
  }
});

test("音声cueは表示中のラジオ定義と照合して非公開IDをhookへ渡す", async () => {
  const store = new MemoryStore();
  const content = workerScenario.contents.find((item) => item.id === "sample_radio");
  assert.ok(content);
  const originalCues = content.record.audioCues;
  let capturedEvent = null;
  content.record.audioCues = [{ id: "private_marker", atMs: 1_000 }];
  const cueHook = {
    event: "scenario_event",
    target: "audio_cue_reached",
    handler: "test_capture_audio_cue",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(cueHook);
  scenarioHookHandlers.test_capture_audio_cue = (_context, event) => { capturedEvent = structuredClone(event); };
  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const valid = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({
        eventId: "audio_cue_reached",
        contentId: content.publicId,
        cueIndex: 1
      })
    });
    assert.equal(valid.status, 200);
    assert.equal(capturedEvent.fields.contentId, "sample_radio");
    assert.equal(capturedEvent.fields.cueId, "private_marker");
    assert.equal(capturedEvent.fields.cueTarget, "sample_radio:private_marker");
    assert.equal(capturedEvent.fields.cueIndex, "1");

    const invalid = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({
        eventId: "audio_cue_reached",
        contentId: content.publicId,
        cueIndex: 2
      })
    });
    assert.equal(invalid.status, 400);
  } finally {
    if (originalCues === undefined) delete content.record.audioCues;
    else content.record.audioCues = originalCues;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(cueHook), 1);
    delete scenarioHookHandlers.test_capture_audio_cue;
  }
});

test("入力ログ確認APIは監修認証・絞り込み・安全なCSVを提供する", async () => {
  const store = new MemoryStore();
  store.playerInputReviewRows = [{
    id: "input-1",
    eventType: "search",
    playerId: "player-1",
    occurredAt: "2026-08-17T00:00:00.000Z",
    appId: "search-agent",
    talkId: null,
    fromId: null,
    userInput: "=HYPERLINK(\"bad\")",
    status: "completed",
    matched: false,
    ruleId: null,
    nextFromId: null,
    responseSnapshot: { resultCount: 0 }
  }];
  const app = createApp({
    store,
    config: { appEnv: "production", adminReviewSecret: "review-secret", playerInputLogging: true, llm: {} }
  });
  const unauthorized = await app.request("https://example.test/api/admin/player-input-review/events");
  assert.equal(unauthorized.status, 401);
  const headers = { "x-admin-review-secret": "review-secret" };
  const response = await app.request("https://example.test/api/admin/player-input-review/events?eventType=search&playerId=player-1&talkId=guide&q=灯り&limit=200", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(store.playerInputReviewFilters, {
    eventType: "search",
    playerId: "player-1",
    talkId: "guide",
    query: "灯り",
    limit: 200
  });
  assert.equal((await response.json()).items[0].userInput, '=HYPERLINK("bad")');

  const csv = await app.request("https://example.test/api/admin/player-input-review.csv?eventType=search", { headers });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/u);
  assert.match(await csv.text(), /'=HYPERLINK/u);
});

test("入力ログ確認画面の組み込みスクリプトは構文エラーなく読み込める", async () => {
  const store = new MemoryStore();
  const app = createApp({
    store,
    config: { appEnv: "development", playerInputLogging: false, llm: {} }
  });
  const response = await app.request("http://localhost/api/admin/player-input-review");
  assert.equal(response.status, 200);
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /行を選択すると詳細を表示します。/u);
});

test("監修集計APIは認証・revision・入力所属を検証してStoreへ保存する", async () => {
  const store = new MemoryStore();
  const talk = workerScenario.talks[0];
  const rule = talk.rules.find((item) => item.from !== "*");
  assert.ok(talk && rule);
  store.reviewEvents = [{ id: "event-1", ruleId: rule.id, userInput: "確認入力", normalizedInput: "確認入力" }];
  const app = createApp({
    store,
    config: { appEnv: "production", adminReviewSecret: "review-secret", playerInputLogging: false, llm: {} }
  });
  const params = new URLSearchParams({ talkId: talk.id, fromId: rule.from });

  const unauthorized = await app.request(`http://localhost/api/admin/talk-branch-review/analysis-inputs?${params}`);
  assert.equal(unauthorized.status, 401);

  const headers = { authorization: "Bearer review-secret" };
  const inputs = await app.request(`http://localhost/api/admin/talk-branch-review/analysis-inputs?${params}`, { headers });
  assert.equal(inputs.status, 200);
  const inputBody = await inputs.json();
  assert.equal(inputBody.scenarioRevision, workerScenario.revision);
  assert.deepEqual(inputBody.events, store.reviewEvents);

  const replacement = {
    talkId: talk.id,
    fromId: rule.from,
    actualRuleId: rule.id,
    scenarioRevision: workerScenario.revision,
    analysisVersion: "test-v1",
    clusters: [{
      id: "cluster-1",
      fit: "blue",
      representativeInput: "確認入力",
      sourceEventIds: ["event-1"],
      reason: "適合"
    }]
  };
  const saved = await app.request("http://localhost/api/admin/talk-branch-review/clusters", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(replacement)
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(store.replacedClusters?.slice(0, 4), [talk.id, rule.from, rule.id, workerScenario.revision]);
  assert.equal(store.replacedClusters?.[4][0].summaryJson, JSON.stringify({ reason: "適合" }));

  const stale = await app.request("http://localhost/api/admin/talk-branch-review/clusters", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ ...replacement, scenarioRevision: "old-revision" })
  });
  assert.equal(stale.status, 409);

  const unknownSource = await app.request("http://localhost/api/admin/talk-branch-review/clusters", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      ...replacement,
      clusters: [{ ...replacement.clusters[0], sourceEventIds: ["unknown"] }]
    })
  });
  assert.equal(unknownSource.status, 400);
});

test("監修指示更新APIはtalk・from・idをStoreへ渡す", async () => {
  const store = new MemoryStore();
  const app = createApp({
    store,
    config: { appEnv: "production", adminReviewSecret: "review-secret", playerInputLogging: false, llm: {} }
  });
  const response = await app.request("http://localhost/api/admin/talk-branch-review/judgments/judgment-1", {
    method: "POST",
    headers: { authorization: "Bearer review-secret", "content-type": "application/json" },
    body: JSON.stringify({
      talkId: "talk-1",
      fromId: "from-1",
      comment: "更新",
      newBranchNote: "",
      reviewerLabel: "reviewer"
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(store.updatedJudgment?.slice(0, 3), ["talk-1", "from-1", "judgment-1"]);
});

test("監修試行は正規表現判定を明示し、判定根拠をsnapshotへ保存する", async () => {
  const store = new MemoryStore();
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  const rule = talk?.rules.find((item) => item.from !== "*" && item.criteria.startsWith("/"));
  assert.ok(talk && rule);
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const detailResponse = await app.request(
    `http://localhost/api/admin/talk-branch-review/from?talkId=${talk.id}&fromId=${encodeURIComponent(rule.from)}`
  );
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).detail;
  assert.match(detail.branches.find((item) => item.ruleId === rule.id).criteria, /^機械的な一致判定：\//u);

  const simulated = await app.request("http://localhost/api/admin/talk-branch-review/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ talkId: talk.id, fromId: rule.from, targetRuleId: rule.id, message: "黄色です" })
  });
  assert.equal(simulated.status, 200);
  const simulatedBody = await simulated.json();
  assert.equal(simulatedBody.result.targetCondSatisfied, true);
  assert.equal(store.savedReviewTrial.responseSnapshot.selectionSource, "regex");
  assert.deepEqual(store.savedReviewTrial.responseSnapshot.match, {});

  const originalCond = rule.cond;
  workerScenario.stateVariables.test_review_flag = true;
  workerScenario.stateVariables.test_review_count = 0;
  workerScenario.stateVariables.test_review_phase = "start";
  workerScenario.stateVariableDefinitions.test_review_flag = { type: "boolean" };
  workerScenario.stateVariableDefinitions.test_review_count = { type: "integer" };
  workerScenario.stateVariableDefinitions.test_review_phase = { type: "enum", values: ["start", "ready"] };
  rule.cond = '!test_review_flag && test_review_count >= 3 && test_review_phase == "ready"';
  try {
    const presetResponse = await app.request("http://localhost/api/admin/talk-branch-review/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ talkId: talk.id, fromId: rule.from, targetRuleId: rule.id, message: "黄色です" })
    });
    assert.equal(presetResponse.status, 200);
    const preset = (await presetResponse.json()).result;
    assert.equal(preset.targetCondSatisfied, true);
    assert.deepEqual(preset.condPreset, [
      "test_review_flag = false",
      "test_review_count = 3",
      'test_review_phase = "ready"'
    ]);
  } finally {
    rule.cond = originalCond;
    delete workerScenario.stateVariables.test_review_flag;
    delete workerScenario.stateVariables.test_review_count;
    delete workerScenario.stateVariables.test_review_phase;
    delete workerScenario.stateVariableDefinitions.test_review_flag;
    delete workerScenario.stateVariableDefinitions.test_review_count;
    delete workerScenario.stateVariableDefinitions.test_review_phase;
  }
});

test("保存済みクラスタがあっても後から届いた未集計入力を隠さない", async () => {
  const store = new MemoryStore();
  const talk = workerScenario.talks[0];
  const rule = talk.rules.find((item) => item.from !== "*");
  assert.ok(talk && rule);
  store.reviewEvents = [
    { id: "event-1", ruleId: rule.id, userInput: "集計済み", normalizedInput: "集計済み" },
    { id: "event-2", ruleId: rule.id, userInput: "あとから届いた", normalizedInput: "あとから届いた" }
  ];
  store.reviewClusterRows = [{
    id: "cluster-1",
    actualRuleId: rule.id,
    fit: "blue",
    representativeInput: "集計済み",
    inputCount: 1,
    sourceEventIds: ["event-1"],
    inputsJson: "[]"
  }];
  const app = createApp({
    store,
    config: { appEnv: "development", playerInputLogging: false, llm: {} }
  });
  const params = new URLSearchParams({ talkId: talk.id, fromId: rule.from });
  const response = await app.request(`http://localhost/api/admin/talk-branch-review/from?${params}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const branch = body.detail.branches.find((item) => item.ruleId === rule.id);
  assert.deepEqual(branch.clusters.map((cluster) => [cluster.fit, cluster.inputs[0]?.input]), [
    ["blue", "集計済み"],
    ["yellow", "あとから届いた"]
  ]);
});

test("保存期間外のクラスタ入力へ代表入力を事実として代入しない", async () => {
  const store = new MemoryStore();
  const talk = workerScenario.talks[0];
  const rule = talk.rules.find((item) => item.from !== "*");
  assert.ok(talk && rule);
  store.reviewClusterRows = [{
    id: "cluster-old",
    actualRuleId: rule.id,
    fit: "blue",
    representativeInput: "代表入力",
    inputCount: 2,
    sourceEventIds: ["expired-1", "expired-2"],
    inputsJson: "[]"
  }];
  const app = createApp({
    store,
    config: { appEnv: "development", playerInputLogging: false, llm: {} }
  });
  const params = new URLSearchParams({ talkId: talk.id, fromId: rule.from });
  const response = await app.request(`http://localhost/api/admin/talk-branch-review/from?${params}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const cluster = body.detail.branches.find((item) => item.ruleId === rule.id).clusters[0];
  assert.deepEqual(cluster.inputs.map((item) => item.input), ["（本文を確認できません）", "（本文を確認できません）"]);
});

test("監修レポートは指示に必要なtalk・fromの入力だけを取得する", async () => {
  const store = new MemoryStore();
  const base = {
    scope: "input",
    sourceEventIds: ["event-1"],
    clusterId: null,
    actualRuleId: null,
    expectedRuleId: null,
    judgment: "comment",
    comment: "",
    newBranchNote: "",
    reviewerLabel: "",
    scenarioRevision: workerScenario.revision,
    status: "open",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
  store.reviewJudgmentRows = [
    { ...base, id: "j-1", talkId: "talk-a", fromId: "from-a" },
    { ...base, id: "j-2", talkId: "talk-a", fromId: "from-a" },
    { ...base, id: "j-3", talkId: "talk-b", fromId: "from-b" }
  ];
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const response = await app.request("http://localhost/api/admin/talk-branch-review/report?format=json");
  assert.equal(response.status, 200);
  assert.deepEqual(store.reviewInputRequests, [["talk-a", "from-a"], ["talk-b", "from-b"]]);
  assert.deepEqual(store.reviewTrialRequests, [["talk-a", "from-a"], ["talk-b", "from-b"]]);
});
