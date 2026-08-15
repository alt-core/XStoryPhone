import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import { scenarioHookHandlers } from "../src/project/hooks.ts";
import { createInitialPlayerState, reconcileScenarioState, workerScenario } from "../src/worker/scenario.ts";

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

  async createPasscodeSession() {
    this.createCalls += 1;
    return { playerId: this.player.id, sessionToken: "memory-token", created: true };
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
    headers: { authorization: "Bearer memory-token" }
  });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).playerState.stateVersion, store.player.stateVersion);
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
    assert.equal((await response.json()).ok, true);
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
      headers: { "x-xstoryphone-progress": firstToken }
    });
    assert.equal(refreshedAfterUpdate.status, 200);
    firstToken = (await refreshedAfterUpdate.json()).playerState.progressToken;

    const searched = await app.request("http://localhost/api/search-agent/search", {
      method: "POST",
      headers: { "x-xstoryphone-progress": firstToken, "content-type": "application/json" },
      body: JSON.stringify({ query: "古いメモ", requestId: "browser-search-1" })
    });
    assert.equal(searched.status, 200);
    const searchBody = await searched.json();
    const secondToken = searchBody.playerState.progressToken;
    assert.notEqual(secondToken, firstToken);
    assert.equal(searchBody.playerState.transcriptDeltas.at(-1)?.kind, "search");

    const oldNote = workerScenario.contents.find((content) => content.id === "old_note");
    const opened = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { "x-xstoryphone-progress": secondToken, "content-type": "application/json" },
      body: JSON.stringify({ appId: "notes", contentId: oldNote.publicId })
    });
    assert.equal(opened.status, 200);
    const openedBody = await opened.json();

    const scheduled = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: {
        "x-xstoryphone-progress": openedBody.playerState.progressToken,
        "content-type": "application/json"
      },
      body: JSON.stringify({ eventId: "schedule_demo_call" })
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
        headers: { "x-xstoryphone-progress": scheduledBody.playerState.progressToken }
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(failedDue.status, 503);
    scenarioHookHandlers.show_demo_call = originalShowHandler;
    const due = await app.request("http://localhost/api/player-state", {
      headers: { "x-xstoryphone-progress": scheduledBody.playerState.progressToken }
    });
    assert.equal(due.status, 200);
    assert.equal((await due.json()).playerState.visibleDeviceState.incomingCall.id, "demo_call");

    const rejected = await app.request("http://localhost/api/player-state", {
      headers: { "x-xstoryphone-progress": `${secondToken}x` }
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

test("browserモードの進行データ上限超過は専用エラーで切り分けられる", async () => {
  const originalMode = workerScenario.playerMode;
  const oversizedSchedule = {
    id: "test_oversized_progress",
    eventId: "schedule_demo_call",
    delayMs: 60_000,
    fields: { padding: "x".repeat(7_000) }
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
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
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
  assert.equal((await sent.json()).stale, undefined);
  const transcriptAfterSend = structuredClone(store.transcripts.get(`${store.player.id}\0talk:guide`));
  assert.ok(transcriptAfterSend.messages.some((message) => message.sender === "owner" && message.body === "見つけた"));

  const replayed = await request();
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).stale, true);
  assert.deepEqual(store.transcripts.get(`${store.player.id}\0talk:guide`), transcriptAfterSend);
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

test("完了イベントの保存競合では予約を先に消費せず、再送時に因果順を保つ", async () => {
  const store = new MemoryStore();
  const initialized = reconcileScenarioState(store.player.state);
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
  store.player.state.stateValues.clue_reported = true;
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
  content.record.form = { kind: "html", id: "demo_form", label: "テスト", url: "/test" };
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
      body: JSON.stringify({ formId: "demo_form", fields: {} })
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).gameOver?.kind, "form");
  } finally {
    if (originalForm === undefined) delete content.record.form;
    else content.record.form = originalForm;
  }
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
    body: JSON.stringify({ talkId: talk.id, fromId: rule.from, targetRuleId: rule.id, message: "見つけた" })
  });
  assert.equal(simulated.status, 200);
  assert.equal(store.savedReviewTrial.responseSnapshot.selectionSource, "regex");
  assert.deepEqual(store.savedReviewTrial.responseSnapshot.match, {});
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
