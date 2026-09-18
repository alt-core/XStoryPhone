import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import { accessCodeCheckDigits } from "../src/server/accessCode.ts";
import { encodeBrowserProgress } from "../src/server/browserProgress.ts";
import { mergeTranscriptAppend } from "../src/server/store.ts";
import { scenarioHookHandlers } from "../src/generated/scenarioHooks.generated.ts";
import { createInitialPlayerState, nextTalkTurnKey, reconcileScenarioState, workerScenario } from "../src/worker/scenario.ts";

const configuredPlayerMode = workerScenario.playerMode;
test.before(() => { workerScenario.playerMode = "server"; });
test.after(() => { workerScenario.playerMode = configuredPlayerMode; });

class MemoryStore {
  player = { id: "player-1", state: createInitialPlayerState(), stateVersion: 0 };
  transcripts = new Map();
  schedules = [];
  audioJobs = new Map();
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
  recordedInputEvents = [];
  initialScheduleSeeds = [];

  async createPasscodeSession(accessCode, _initialState, initialSchedules = []) {
    this.createCalls += 1;
    this.lastAccessCode = accessCode;
    this.initialScheduleSeeds = structuredClone(initialSchedules);
    this.schedules.push(...initialSchedules.map((schedule) => ({
      id: schedule.id,
      scheduleId: schedule.id,
      eventId: schedule.eventId,
      fields: structuredClone(schedule.fields),
      dueAt: schedule.dueAt,
      playerId: this.player.id,
      status: "queued"
    })));
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
  async savePlayer(player, nextState, transcripts = [], effects = {}) {
    if (this.saveConflictsRemaining > 0) {
      this.saveConflictsRemaining -= 1;
      return false;
    }
    if (player.stateVersion !== this.player.stateVersion) return false;
    this.player = {
      id: player.id,
      state: structuredClone(nextState),
      stateVersion: player.stateVersion + 1
    };
    for (const transcript of transcripts) {
      const key = `${player.id}\0${transcript.streamId}`;
      const current = this.transcripts.get(key) ?? {
        streamId: transcript.streamId,
        transcriptKey: transcript.transcriptKey,
        messages: []
      };
      this.transcripts.set(key, structuredClone(mergeTranscriptAppend(current, transcript)));
    }
    for (const effect of effects.schedules ?? []) {
      const current = this.schedules.find((item) => item.scheduleId === effect.id);
      if (effect.type === "cancel") {
        if (current && (current.status === "queued" || current.status === "running")) current.status = "canceled";
      } else if (current?.status !== "completed") {
        const next = { id: effect.id, scheduleId: effect.id, eventId: effect.eventId, fields: effect.fields, dueAt: effect.dueAt, playerId: player.id, status: "queued" };
        if (current) Object.assign(current, next);
        else this.schedules.push(next);
      }
    }
    for (const job of effects.generatedAudioJobs ?? []) this.audioJobs.set(job.audioId, structuredClone(job));
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
  async recordInputEvent(event, enabled) {
    if (enabled) this.recordedInputEvents.push(structuredClone(event));
  }
  async playerInputEvents(filters) {
    this.playerInputReviewFilters = filters;
    return this.playerInputReviewRows;
  }
  async generatedAudioJob(_playerId, audioId) { return structuredClone(this.audioJobs.get(audioId) ?? null); }
  async saveGeneratedAudioJob(_playerId, job) { this.audioJobs.set(job.audioId, structuredClone(job)); }
  async generatedAudioJobs() { return [...this.audioJobs.values()].map((job) => structuredClone(job)); }
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

async function searchAgentRequest(app, init) {
  const request = JSON.parse(init.body ?? "{}");
  const stateResponse = await app.request("http://localhost/api/player-state", {
    method: "POST",
    headers: init.headers,
    body: JSON.stringify({ ...(typeof request.progressToken === "string" ? { progressToken: request.progressToken } : {}) })
  });
  assert.equal(stateResponse.status, 200);
  const stateBody = await stateResponse.json();
  const talk = stateBody.playerState.talks.find((item) => item.kind === "search_agent");
  assert.ok(talk);
  return app.request("http://localhost/api/talk/send", {
    method: "POST",
    headers: init.headers,
    body: JSON.stringify({
      ...(stateBody.playerState.progressToken ? { progressToken: stateBody.playerState.progressToken } : {}),
      talkId: talk.talkId,
      turnKey: talk.turnKey,
      message: request.query
    })
  });
}

function searchResultsFrom(body) {
  return body.playerState.transcriptDeltas
    .filter((delta) => delta.kind === "search_agent")
    .flatMap((delta) => delta.messages)
    .filter((item) => item.kind === "search_results")
    .flatMap((item) => item.results);
}

test("browserのJSONだけHTTP cacheを禁止し、監修・音声・serverの方針は変えない", async () => {
  const previousMode = workerScenario.playerMode;
  try {
    for (const mode of ["server", "browser"]) {
      workerScenario.playerMode = mode;
      const app = createApp({ store: new MemoryStore(), config: { appEnv: "development", llm: {} } });
      app.get("/api/cache-probe", (c) => c.json({ ok: true }));
      app.get("/api/admin/cache-probe", (c) => c.json({ ok: true }));
      app.get("/api/media-probe", () => new Response("audio", {
        headers: { "content-type": "audio/wav", "cache-control": "public, max-age=3600" }
      }));
      assert.equal((await app.request("http://localhost/api/cache-probe")).headers.get("cache-control"), mode === "browser" ? "no-store" : null);
      assert.equal((await app.request("http://localhost/api/admin/cache-probe")).headers.get("cache-control"), null);
      assert.equal((await app.request("http://localhost/api/media-probe")).headers.get("cache-control"), "public, max-age=3600");
    }
  } finally {
    workerScenario.playerMode = previousMode;
  }
});

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

  const searchTalk = startBody.playerState.talks.find((item) => item.kind === "search_agent");
  assert.ok(searchTalk);
  const searched = await app.request("http://localhost/api/talk/send", {
    method: "POST",
    headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
    body: JSON.stringify({ talkId: searchTalk.talkId, turnKey: searchTalk.turnKey, message: "古いメモ" })
  });
  assert.equal(searched.status, 200);
  const transcript = await app.request(`http://localhost/api/transcript/${searchTalk.talkId}?after=0`, {
    headers: { authorization: "Bearer memory-token" }
  });
  assert.equal(transcript.status, 200);
  const transcriptBody = await transcript.json();
  assert.equal(transcriptBody.delta.kind, "search_agent");
  assert.deepEqual(transcriptBody.delta.messages.map((item) => item.seq), [1, 2, 3, 4]);
  assert.deepEqual(transcriptBody.delta.messages.slice(-3).map((item) => item.kind), ["message", "search_results", "message"]);
  assert.deepEqual(transcriptBody.delta.messages.at(-1).quickReplies, ["ヒント", "機能テスト", "ヘルプ"]);
});

test("search agentの内部リンクは表示済み能力を照合して既存APIで開く", async () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "search_agent::common_help");
  const message = block?.messages[0];
  assert.ok(message);
  const previous = { body: message.body, segments: message.segments };
  message.body = "操作ガイド";
  message.segments = [{
    kind: "link",
    text: "操作ガイド",
    appId: "notes",
    contentId: "welcome_note",
    linkId: "search-link_reply"
  }];
  try {
    const store = new MemoryStore();
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const started = await app.request("http://localhost/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serialCode: "1234" })
    });
    assert.equal(started.status, 200);
    const startBody = await started.json();
    const searchTalk = startBody.playerState.talks.find((item) => item.kind === "search_agent");
    assert.ok(searchTalk);

    const sent = await app.request("http://localhost/api/talk/send", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ talkId: searchTalk.talkId, turnKey: searchTalk.turnKey, message: "ヘルプ" })
    });
    assert.equal(sent.status, 200);
    const sentBody = await sent.json();
    const linkMessage = sentBody.playerState.transcriptDeltas
      .find((item) => item.kind === "search_agent")?.messages
      .find((item) => item.kind === "message" && item.segments?.some((segment) => segment.linkId === "search-link_reply"));
    assert.ok(linkMessage);
    const publicLink = linkMessage.segments[0];
    assert.equal(publicLink.contentId, workerScenario.publicIds.content.welcome_note);
    assert.equal(store.player.state.revealedMessageLinks.some((item) => item.id === "search-link_reply"), true);

    const opened = await app.request("http://localhost/api/message-link/open", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({
        talkId: searchTalk.talkId,
        messageRef: linkMessage.id,
        segmentIndex: 0,
        linkId: publicLink.linkId
      })
    });
    assert.equal(opened.status, 200);
    assert.deepEqual((await opened.json()).target, {
      appId: "notes",
      contentId: workerScenario.publicIds.content.welcome_note
    });

    const tampered = await app.request("http://localhost/api/message-link/open", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ talkId: searchTalk.talkId, messageRef: linkMessage.id, segmentIndex: 0, linkId: "search-link_tampered" })
    });
    assert.equal(tampered.status, 409);
  } finally {
    message.body = previous.body;
    message.segments = previous.segments;
  }
});

test("serverの初期scheduleは新規player作成と同じStore操作へ渡す", async () => {
  const schedule = {
    id: "test_initial_schedule",
    eventId: "show_demo_call",
    delayMs: 60_000,
    fields: { source: "initial" }
  };
  workerScenario.initialSchedules.push(schedule);
  try {
    const store = new MemoryStore();
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const before = Date.now();
    const response = await app.request("http://localhost/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serialCode: "1234" })
    });
    assert.equal(response.status, 200);
    assert.equal(store.initialScheduleSeeds.length, 1);
    assert.equal(store.schedules.length, 1);
    assert.deepEqual(store.initialScheduleSeeds[0].fields, { source: "initial" });
    assert.ok(Date.parse(store.initialScheduleSeeds[0].dueAt) >= before + schedule.delayMs);
  } finally {
    workerScenario.initialSchedules.splice(workerScenario.initialSchedules.indexOf(schedule), 1);
  }
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

  const searched = await searchAgentRequest(app, {
    method: "POST",
    headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
    body: JSON.stringify({ query: "消えた連絡記録" })
  });
  assert.equal(searched.status, 200);
  const searchBody = await searched.json();
  const searchResults = searchResultsFrom(searchBody);
  assert.equal(searchResults[0]?.targetKind, "talk_history");
  assert.equal(searchResults[0]?.targetTalkId, guide.publicId);

  const opened = await app.request("http://localhost/api/content/opened", {
    method: "POST",
    headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
    body: JSON.stringify({ appId: "messages", contentId: historyContent.publicId })
  });
  assert.equal(opened.status, 200);
  const openedBody = await opened.json();
  const openedGuide = openedBody.playerState.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId);
  assert.deepEqual(openedGuide?.messages.map((message) => message.seq), [1, 2, 4]);
  assert.ok(openedGuide?.messages.filter((message) => message.seq < 3)
    .every((message) => message.historyRepairId === historyContent.publicId));
  assert.deepEqual(
    openedBody.playerState.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId)?.brokenHistoryRanges,
    [{ beforeSeq: 4 }]
  );
  assert.equal(openedBody.playerState.talks.find((talk) => talk.talkId === guide.publicId)?.historyRevision, 1);
  assert.deepEqual(
    store.transcripts.get(`${store.player.id}\0talk:guide`)?.messages ?? [],
    []
  );
});

test("検索でrepairableなtalk全体を修復し、同じルームを開く", async () => {
  const talk = workerScenario.talks.find((item) => item.id === "sms_receiver");
  assert.ok(talk);
  const original = {
    initialState: talk.initialState,
    repairLabel: talk.repairLabel,
    search: talk.search
  };
  Object.assign(talk, {
    initialState: "repairable",
    repairLabel: "受▚▐▀箱",
    search: ["修復対象ルーム"]
  });
  try {
    const store = new MemoryStore();
    const initialized = await reconcileScenarioState(store.player.state, store.player.id);
    store.player.state = initialized.state;
    for (const transcript of initialized.transcriptAppends) {
      store.transcripts.set(`${store.player.id}\0${transcript.streamId}`, structuredClone(transcript));
    }
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });

    const directOpen = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ appId: "messages", contentId: talk.publicId })
    });
    assert.equal(directOpen.status, 409);

    const searched = await searchAgentRequest(app, {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ query: "修復対象ルーム" })
    });
    assert.equal(searched.status, 200);
    const searchBody = await searched.json();
    const talkResult = searchResultsFrom(searchBody).find((result) => result.contentId === talk.publicId);
    assert.equal(talkResult?.contentId, talk.publicId);
    assert.equal(talkResult?.repairable, true);

    const opened = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ appId: "messages", contentId: talk.publicId })
    });
    assert.equal(opened.status, 200);
    const openedBody = await opened.json();
    assert.equal(store.player.state.repairedContentIds.includes(talk.id), true);
    assert.equal(openedBody.playerState.contentStates.some((item) => item.contentId === talk.publicId && item.state === "repaired"), true);
    assert.equal(openedBody.playerState.talks.some((item) => item.talkId === talk.publicId), true);
    const thread = openedBody.playerState.visibleDeviceState.messages.find((item) => item.id === talk.publicId);
    assert.equal(thread?.contactName, talk.label);
    assert.ok(thread?.messages.length);
  } finally {
    Object.assign(talk, original);
  }
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

  const poisonedStore = new MemoryStore();
  poisonedStore.dueScheduledEvents = async () => {
    throw new Error("恒久的に失敗する予定イベント");
  };
  const poisonedApp = createApp({ store: poisonedStore, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const recovered = await poisonedApp.request("https://example.com/api/reset-for-testing", {
    method: "POST",
    headers: { authorization: "Bearer memory-token" }
  });
  assert.equal(recovered.status, 200, "dev/stgのリセットは壊れた予定イベントを実行せず初期化する");
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
    context.schedule.after("show_demo_call", 0, {}, "demo_call_once");
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
    assert.equal(started.headers.get("cache-control"), "no-store");
    const startBody = await started.json();
    let firstToken = startBody.playerState.progressToken;
    assert.equal(typeof firstToken, "string");
    assert.equal(startBody.sessionToken, firstToken);
    assert.ok(startBody.playerState.visibleDeviceState.messages.some((thread) => thread.messages.length > 0));

    workerScenario.revision = `${originalRevision}-updated`;
    const refreshedAfterUpdate = await app.request("http://localhost/api/player-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: firstToken })
    });
    assert.equal(refreshedAfterUpdate.status, 200);
    assert.equal(refreshedAfterUpdate.headers.get("cache-control"), "no-store");
    const refreshedAfterUpdateBody = await refreshedAfterUpdate.json();
    assert.equal(refreshedAfterUpdateBody.playerState.progressToken, firstToken);
    firstToken = refreshedAfterUpdateBody.playerState.progressToken;

    const searched = await searchAgentRequest(app, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: firstToken, query: "古いメモ" })
    });
    assert.equal(searched.status, 200);
    const searchBody = await searched.json();
    const secondToken = searchBody.playerState.progressToken;
    assert.notEqual(secondToken, firstToken);
    assert.equal(searchBody.playerState.transcriptDeltas.at(-1)?.kind, "search_agent");

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

test("期限到来eventと通常操作が同じrequestで進んでも両方の履歴差分を返す", async () => {
  const originalMode = workerScenario.playerMode;
  const originalScheduleHandler = scenarioHookHandlers.schedule_demo_call;
  const originalShowHandler = scenarioHookHandlers.show_demo_call;
  workerScenario.clientCallableEvents.push("schedule_demo_call");
  scenarioHookHandlers.schedule_demo_call = (context) => {
    context.schedule.after("show_demo_call", 0, {}, "test_due_talk_delta");
  };
  scenarioHookHandlers.show_demo_call = (context) => {
    context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
  };

  try {
    for (const mode of ["server", "browser"]) {
      workerScenario.playerMode = mode;
      const store = new MemoryStore();
      const app = createApp({
        store,
        config: {
          appEnv: "development",
          browserStateSecret: "due-transcript-delta-test-secret",
          playerInputLogging: false,
          llm: {}
        }
      });
      let credential = "memory-token";
      if (mode === "browser") {
        const started = await app.request("http://localhost/api/session/start", { method: "POST" });
        assert.equal(started.status, 200);
        credential = (await started.json()).playerState.progressToken;
      } else {
        const initialized = await reconcileScenarioState(store.player.state, store.player.id);
        store.player.state = initialized.state;
        for (const transcript of initialized.transcriptAppends) {
          store.transcripts.set(`${store.player.id}\0${transcript.streamId}`, structuredClone(transcript));
        }
      }
      const headers = mode === "server"
        ? { authorization: `Bearer ${credential}`, "content-type": "application/json" }
        : { "content-type": "application/json" };
      const scheduled = await app.request("http://localhost/api/scenario/event", {
        method: "POST",
        headers,
        body: JSON.stringify({ progressToken: credential, eventId: "schedule_demo_call" })
      });
      assert.equal(scheduled.status, 200);
      const scheduledBody = await scheduled.json();
      credential = scheduledBody.playerState.progressToken ?? credential;
      const searchTalk = scheduledBody.playerState.talks.find((item) => item.kind === "search_agent");
      assert.ok(searchTalk);

      const searched = await app.request("http://localhost/api/talk/send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          progressToken: credential,
          talkId: searchTalk.talkId,
          turnKey: searchTalk.turnKey,
          message: "古いメモ"
        })
      });
      assert.equal(searched.status, 200);
      const deltas = (await searched.json()).playerState.transcriptDeltas;
      assert.deepEqual(
        deltas.map((delta) => delta.kind).sort(),
        ["search_agent", "sms"],
        `${mode}で予定eventと通常操作の履歴差分を両方返す`
      );
    }
  } finally {
    workerScenario.playerMode = originalMode;
    workerScenario.clientCallableEvents.pop();
    scenarioHookHandlers.schedule_demo_call = originalScheduleHandler;
    scenarioHookHandlers.show_demo_call = originalShowHandler;
  }
});

test("browserのsearch agent入力はtalk turnとしてblock・結果card・stateを一度に保存する", async () => {
  const originalMode = workerScenario.playerMode;
  workerScenario.playerMode = "browser";
  try {
    const store = new MemoryStore();
    const app = createApp({
      store,
      config: {
        appEnv: "development",
        browserStateSecret: "search-agent-talk-test-secret",
        playerInputLogging: true,
        llm: {}
      }
    });
    const started = await app.request("http://localhost/api/session/start", { method: "POST" });
    assert.equal(started.status, 200);
    const startBody = await started.json();
    const talk = startBody.playerState.talks.find((item) => item.kind === "search_agent");
    assert.ok(talk);
    assert.deepEqual(
      startBody.playerState.transcriptDeltas.find((item) => item.kind === "search_agent")?.messages.map((item) => item.kind),
      ["message"]
    );
    assert.deepEqual(
      startBody.playerState.transcriptDeltas.find((item) => item.kind === "search_agent")?.messages[0]?.quickReplies,
      ["古いメモ", "ヒント", "機能テスト", "ヘルプ"]
    );

    const sent = await app.request("http://localhost/api/talk/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressToken: startBody.playerState.progressToken,
        talkId: talk.talkId,
        turnKey: talk.turnKey,
        message: "古いメモ"
      })
    });
    assert.equal(sent.status, 200);
    const sentBody = await sent.json();
    const delta = sentBody.playerState.transcriptDeltas.find((item) => item.kind === "search_agent");
    assert.deepEqual(delta.messages.map((item) => item.kind), ["message", "search_results", "message"]);
    assert.equal(delta.messages.find((item) => item.kind === "search_results")?.results.length > 0, true);
    assert.deepEqual(delta.messages.map((item) => item.seq), [2, 3, 4]);
    assert.deepEqual(delta.messages.at(-1).quickReplies, ["ヒント", "機能テスト", "ヘルプ"]);
    assert.equal(sentBody.playerState.talks.find((item) => item.kind === "search_agent")?.inputVisible, true);
    assert.equal(store.recordedInputEvents.length, 1);
    assert.equal(store.recordedInputEvents[0].talkId, "search_agent");
    assert.equal("appId" in store.recordedInputEvents[0], false);
    assert.equal("eventType" in store.recordedInputEvents[0], false);

    const commandLikeInput = `photo:${workerScenario.publicIds.content.rainy_window}`;
    const nextTalk = sentBody.playerState.talks.find((item) => item.kind === "search_agent");
    const commandLikeResponse = await app.request("http://localhost/api/talk/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressToken: sentBody.playerState.progressToken,
        talkId: nextTalk.talkId,
        turnKey: nextTalk.turnKey,
        message: commandLikeInput
      })
    });
    assert.equal(commandLikeResponse.status, 200);
    const commandLikeBody = await commandLikeResponse.json();
    const commandLikeDelta = commandLikeBody.playerState.transcriptDeltas.find((item) => item.kind === "search_agent");
    assert.equal(commandLikeDelta.messages.find((item) => item.sender === "owner")?.body, commandLikeInput);

    const oldEndpoint = await app.request("http://localhost/api/search-agent/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: sentBody.playerState.progressToken, query: "古いメモ" })
    });
    assert.equal(oldEndpoint.status, 404);
  } finally {
    workerScenario.playerMode = originalMode;
  }
});

test("browserのテスト用リセットは更新前の履歴deltaを新しいstreamへ混ぜない", async () => {
  const originalMode = workerScenario.playerMode;
  const secret = "reset-stream-replacement-test-secret";
  workerScenario.playerMode = "browser";
  try {
    const app = createApp({
      store: new MemoryStore(),
      config: {
        appEnv: "development",
        browserStateSecret: secret,
        playerInputLogging: false,
        llm: {}
      }
    });
    const progressToken = await encodeBrowserProgress(secret, workerScenario.project.id, {
      id: "pre-search-agent-player",
      state: createInitialPlayerState(),
      stateVersion: 3
    });
    const migrated = await app.request("http://localhost/api/player-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken })
    });
    assert.equal(migrated.status, 200);
    const migratedBody = await migrated.json();
    const migratedSearchDeltas = migratedBody.playerState.transcriptDeltas.filter((delta) => delta.kind === "search_agent");
    assert.equal(migratedSearchDeltas.length, 1, "更新前tokenのreconcileが旧stream差分を生成する前提を確認する");

    const response = await app.request("http://localhost/api/reset-for-testing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const searchDeltas = body.playerState.transcriptDeltas.filter((delta) => delta.kind === "search_agent");
    assert.equal(searchDeltas.length, 1);
    assert.equal(new Set(searchDeltas.map((delta) => delta.transcriptKey)).size, 1);
    assert.notEqual(searchDeltas[0].transcriptKey, migratedSearchDeltas[0].transcriptKey);
  } finally {
    workerScenario.playerMode = originalMode;
  }
});

test("browserモードでは発話を追加した同じ更新でtalkを非表示にしない", async () => {
  const originalMode = workerScenario.playerMode;
  const guide = workerScenario.talks.find((talk) => talk.id === "guide");
  const originalCond = guide.cond;
  const hook = {
    event: "test_hide_talk_after_append",
    target: "",
    handler: "test_hide_talk_after_append",
    cond: "",
    llm: false
  };
  workerScenario.playerMode = "browser";
  workerScenario.stateVariables.test_hide_talk_after_append = false;
  workerScenario.clientCallableEvents.push("test_hide_talk_after_append");
  workerScenario.hooks.push(hook);
  guide.cond = "!test_hide_talk_after_append";
  scenarioHookHandlers.test_hide_talk_after_append = (context) => {
    context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
    context.state.set("test_hide_talk_after_append", true);
  };

  try {
    const app = createApp({
      store: new MemoryStore(),
      config: {
        appEnv: "development",
        browserStateSecret: "hide-talk-after-append-test-secret",
        playerInputLogging: false,
        llm: {}
      }
    });
    const started = await app.request("http://localhost/api/session/start", { method: "POST" });
    assert.equal(started.status, 200);
    const progressToken = (await started.json()).playerState.progressToken;
    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    try {
      response = await app.request("http://localhost/api/scenario/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progressToken, eventId: "test_hide_talk_after_append" })
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "server_error");
  } finally {
    workerScenario.playerMode = originalMode;
    guide.cond = originalCond;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    workerScenario.clientCallableEvents.pop();
    delete workerScenario.stateVariables.test_hide_talk_after_append;
    delete scenarioHookHandlers.test_hide_talk_after_append;
  }
});

test("browserモードでは同じrequestの予定eventが追加した発話も非表示にしない", async () => {
  const originalMode = workerScenario.playerMode;
  const guide = workerScenario.talks.find((talk) => talk.id === "guide");
  const originalCond = guide.cond;
  const originalScheduleHandler = scenarioHookHandlers.schedule_demo_call;
  const originalShowHandler = scenarioHookHandlers.show_demo_call;
  const hideHook = {
    event: "test_hide_talk_after_due_append",
    target: "",
    handler: "test_hide_talk_after_due_append",
    cond: "",
    llm: false
  };
  workerScenario.playerMode = "browser";
  workerScenario.stateVariables.test_hide_talk_after_due_append = false;
  workerScenario.clientCallableEvents.push("schedule_demo_call", "test_hide_talk_after_due_append");
  workerScenario.hooks.push(hideHook);
  guide.cond = "!test_hide_talk_after_due_append";
  scenarioHookHandlers.schedule_demo_call = (context) => {
    context.schedule.after("show_demo_call", 0, {}, "test_due_talk_before_hide");
  };
  scenarioHookHandlers.show_demo_call = (context) => {
    context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
  };
  scenarioHookHandlers.test_hide_talk_after_due_append = (context) => {
    context.state.set("test_hide_talk_after_due_append", true);
  };

  try {
    const app = createApp({
      store: new MemoryStore(),
      config: {
        appEnv: "development",
        browserStateSecret: "hide-talk-after-due-append-test-secret",
        playerInputLogging: false,
        llm: {}
      }
    });
    const started = await app.request("http://localhost/api/session/start", { method: "POST" });
    const startToken = (await started.json()).playerState.progressToken;
    const scheduled = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progressToken: startToken, eventId: "schedule_demo_call" })
    });
    assert.equal(scheduled.status, 200);
    const scheduledToken = (await scheduled.json()).playerState.progressToken;
    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    try {
      response = await app.request("http://localhost/api/scenario/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progressToken: scheduledToken, eventId: "test_hide_talk_after_due_append" })
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "server_error");
  } finally {
    workerScenario.playerMode = originalMode;
    guide.cond = originalCond;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hideHook), 1);
    workerScenario.clientCallableEvents.splice(-2, 2);
    delete workerScenario.stateVariables.test_hide_talk_after_due_append;
    scenarioHookHandlers.schedule_demo_call = originalScheduleHandler;
    scenarioHookHandlers.show_demo_call = originalShowHandler;
    delete scenarioHookHandlers.test_hide_talk_after_due_append;
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
    const searched = await searchAgentRequest(app, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressToken: startBody.playerState.progressToken,
        query: "消えた連絡記録"
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
      openedBody.playerState.visibleDeviceState.messages
        .find((thread) => thread.id === workerScenario.publicIds.talk.guide)?.messages.map((message) => message.seq),
      [1, 2, 4]
    );
    assert.equal(openedBody.playerState.talks.find((talk) => talk.kind === "sms")?.historyRevision, 1);
  } finally {
    workerScenario.playerMode = originalMode;
  }
});

test("browserモードでもrepairableなtalk全体を同じ進行tokenで修復する", async () => {
  const talk = workerScenario.talks.find((item) => item.id === "sms_receiver");
  assert.ok(talk);
  const originalMode = workerScenario.playerMode;
  const original = { initialState: talk.initialState, repairLabel: talk.repairLabel, search: talk.search };
  workerScenario.playerMode = "browser";
  Object.assign(talk, { initialState: "repairable", repairLabel: "受▚▐▀箱", search: ["ブラウザ修復ルーム"] });
  try {
    const app = createApp({
      store: new MemoryStore(),
      config: {
        appEnv: "production",
        browserStateSecret: "browser-talk-repair-secret",
        playerInputLogging: false,
        llm: {}
      }
    });
    const started = await app.request("http://localhost/api/session/start", { method: "POST" });
    const startBody = await started.json();
    const searched = await searchAgentRequest(app, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressToken: startBody.playerState.progressToken,
        query: "ブラウザ修復ルーム"
      })
    });
    const searchBody = await searched.json();
    const opened = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        progressToken: searchBody.playerState.progressToken,
        appId: "messages",
        contentId: talk.publicId
      })
    });
    assert.equal(opened.status, 200);
    const openedBody = await opened.json();
    assert.equal(typeof openedBody.playerState.progressToken, "string");
    assert.equal(openedBody.playerState.contentStates.some((item) => item.contentId === talk.publicId && item.state === "repaired"), true);
    assert.equal(openedBody.playerState.talks.some((item) => item.talkId === talk.publicId), true);
    assert.ok(openedBody.playerState.visibleDeviceState.messages.find((item) => item.id === talk.publicId)?.messages.length);
  } finally {
    workerScenario.playerMode = originalMode;
    Object.assign(talk, original);
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
    assert.equal(response.headers.get("cache-control"), "no-store");
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
    event: "talk_turn_completed",
    target: "guide",
    handler: "test_capture_talk_transition",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(talkHook);
  scenarioHookHandlers.test_capture_talk_transition = (_context, event) => { capturedTalkEvent = structuredClone(event); };
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: true, llm: {} } });
  try {
    const started = await app.request("http://localhost/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serialCode: "1234" })
    });
    const startBody = await started.json();
    const talk = startBody.playerState.talks.find((item) => item.talkId === workerScenario.publicIds.talk.guide);
    assert.ok(talk);
    const initialGuideThread = startBody.playerState.visibleDeviceState.messages.find((thread) => thread.id === talk.talkId);
    assert.equal(initialGuideThread?.unread, undefined, "デモ連絡先は初期未読を作らない");
    const request = () => app.request("http://localhost/api/talk/send", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ talkId: talk.talkId, message: "確認します", turnKey: talk.turnKey })
    });

    const sent = await request();
    assert.equal(sent.status, 200);
    const sentBody = await sent.json();
    assert.equal(sentBody.stale, undefined);
    assert.equal(capturedTalkEvent.talkId, "guide");
    assert.equal(capturedTalkEvent.playerInput, "確認します");
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
    assert.ok(transcriptAfterSend.messages.some((event) => event.event_type === "player_message" && event.body === "確認します"));
    assert.ok(transcriptAfterSend.messages.some((event) => event.event_type === "message_block" && event.body === null && event.block_id));
    assert.deepEqual(store.recordedInputEvents[0]?.responseSnapshot.outputSteps, capturedTalkEvent
      ? workerScenario.talks.find((item) => item.id === "guide")?.rules.find((rule) => rule.id === capturedTalkEvent.ruleId)?.outputSteps
      : undefined);

    const replayed = await request();
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json()).stale, true);
    assert.deepEqual(store.transcripts.get(`${store.player.id}\0talk:guide`), transcriptAfterSend);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(talkHook), 1);
    delete scenarioHookHandlers.test_capture_talk_transition;
  }
});

test("talk flowのgame_overは一時会話をpresentation sequenceで返す", async () => {
  const store = new MemoryStore();
  store.player.state = (await reconcileScenarioState(store.player.state, store.player.id)).state;
  const guide = workerScenario.talks.find((talk) => talk.id === "guide");
  assert.ok(guide);
  const baseRule = guide.rules.find((rule) => rule.from === guide.initialFrom && rule.isDefault);
  assert.ok(baseRule);
  const gameOverRule = {
    ...baseRule,
    id: "test-game-over-rule",
    intent: "ゲームオーバー確認",
    criteria: "/^終了$/u",
    example: "終了",
    isDefault: false,
    mode: "game_over",
    outputSteps: [{ kind: "block", blockId: "guide::message_reply" }],
    nextBlocks: ["guide::message_reply"],
    nextFromId: "guide::message_reply"
  };
  guide.rules.unshift(gameOverRule);
  store.player.state.talks.guide.from = guide.initialFrom;
  store.player.state.talks.guide.turnKey = "game-over-turn";
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: true, llm: {} } });

  try {
    const response = await app.request("http://localhost/api/talk/send", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({
        talkId: workerScenario.publicIds.talk.guide,
        message: "終了",
        turnKey: "game-over-turn"
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.presentation?.sequence?.type, "game_over");
    assert.equal(body.presentation?.sequence?.talk.talkId, workerScenario.publicIds.talk.guide);
    assert.ok(body.presentation?.sequence?.talk.messages.some((message) => message.body.includes("メッセージの送受信")));
    assert.equal(store.transcripts.has(`${store.player.id}\0talk:guide`), false);
    assert.deepEqual(store.recordedInputEvents[0]?.responseSnapshot.outputSteps, gameOverRule.outputSteps);
  } finally {
    guide.rules.splice(guide.rules.indexOf(gameOverRule), 1);
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
    const searched = await searchAgentRequest(app, {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ query: "古いメモ" })
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

test("修復hookと開封hookが同じ外部副作用IDを操作した場合は保存前に拒否する", async () => {
  const originalMode = workerScenario.playerMode;
  const repairedHook = {
    event: "content_repaired",
    target: "old_note",
    handler: "test_duplicate_repaired_effect",
    cond: "",
    llm: false
  };
  const openedHook = {
    event: "content_opened",
    target: "old_note",
    handler: "test_duplicate_opened_effect",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(repairedHook, openedHook);
  try {
    for (const playerMode of ["server", "browser"]) {
      for (const effectKind of ["schedule", "generated_audio"]) {
        workerScenario.playerMode = playerMode;
        if (effectKind === "schedule") {
          scenarioHookHandlers.test_duplicate_repaired_effect = (context) => {
            context.schedule.after("show_demo_call", 100, {}, "same_content_effect");
          };
          scenarioHookHandlers.test_duplicate_opened_effect = (context) => {
            context.schedule.cancel("same_content_effect");
          };
        } else {
          scenarioHookHandlers.test_duplicate_repaired_effect = (context) => {
            context.genAudio.prepare("demo_voice", { inputText: "修復時の音声" });
          };
          scenarioHookHandlers.test_duplicate_opened_effect = (context) => {
            context.genAudio.prepare("demo_voice", { inputText: "開封時の音声" });
          };
        }

        const store = new MemoryStore();
        let generatedAudioJobReads = 0;
        const generatedAudioJob = store.generatedAudioJob.bind(store);
        store.generatedAudioJob = async (...args) => {
          generatedAudioJobReads += 1;
          return generatedAudioJob(...args);
        };
        const app = createApp({
          store,
          config: {
            appEnv: "development",
            browserStateSecret: "duplicate-hook-effect-test-secret",
            playerInputLogging: false,
            llm: {}
          }
        });
        let progressToken;
        const headers = playerMode === "server"
          ? { authorization: "Bearer memory-token", "content-type": "application/json" }
          : { "content-type": "application/json" };
        if (playerMode === "browser") {
          const started = await app.request("http://localhost/api/session/start", { method: "POST" });
          assert.equal(started.status, 200);
          progressToken = (await started.json()).playerState.progressToken;
        }
        const searched = await searchAgentRequest(app, {
          method: "POST",
          headers,
          body: JSON.stringify({ progressToken, query: "古いメモ" })
        });
        assert.equal(searched.status, 200);
        const searchBody = await searched.json();
        progressToken = searchBody.playerState.progressToken;

        const originalConsoleError = console.error;
        console.error = () => {};
        let opened;
        try {
          opened = await app.request("http://localhost/api/content/opened", {
            method: "POST",
            headers,
            body: JSON.stringify({
              progressToken,
              appId: "notes",
              contentId: workerScenario.publicIds.content.old_note
            })
          });
        } finally {
          console.error = originalConsoleError;
        }
        assert.equal(opened.status, 500, `${playerMode}/${effectKind}は同じauthoring errorとして拒否する`);
        assert.equal(generatedAudioJobReads, 0, "生成音声intentのDB readより先に拒否する");
        assert.equal(store.schedules.length, 0);
        assert.equal(store.audioJobs.size, 0);
        assert.equal(store.player.state.repairedContentIds.includes("old_note"), false);
      }
    }
  } finally {
    workerScenario.playerMode = originalMode;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(repairedHook), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(openedHook), 1);
    delete scenarioHookHandlers.test_duplicate_repaired_effect;
    delete scenarioHookHandlers.test_duplicate_opened_effect;
  }
});

test("修復hookがeffect sequenceを開始した後は同じrequestの開封hookを実行しない", async () => {
  const store = new MemoryStore();
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  let opened = false;
  const repairedHook = {
    event: "content_repaired",
    target: "old_note",
    handler: "test_repair_sequence",
    cond: "",
    llm: false
  };
  const openedHook = {
    event: "content_opened",
    target: "old_note",
    handler: "test_open_after_sequence",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(repairedHook, openedHook);
  scenarioHookHandlers.test_repair_sequence = (context) => context.effectSequence.gameOver();
  scenarioHookHandlers.test_open_after_sequence = () => { opened = true; };
  try {
    const searched = await searchAgentRequest(app, {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ query: "古いメモ" })
    });
    assert.equal(searched.status, 200);

    const response = await app.request("http://localhost/api/content/opened", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ appId: "notes", contentId: workerScenario.publicIds.content.old_note })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.presentation?.sequence?.type, "game_over");
    assert.equal(body.presentation?.sequence?.reasonMessage, undefined);
    assert.equal(opened, false);
    assert.ok(store.player.state.repairedContentIds.includes("old_note"));
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(repairedHook), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(openedHook), 1);
    delete scenarioHookHandlers.test_repair_sequence;
    delete scenarioHookHandlers.test_open_after_sequence;
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

test("通常talkの開封hookは公開IDを内部talk IDへ戻して毎回実行する", async () => {
  const store = new MemoryStore();
  store.player.state = (await reconcileScenarioState(store.player.state, store.player.id)).state;
  const openedContentIds = [];
  const openedHook = {
    event: "content_opened",
    target: "guide",
    handler: "test_count_talk_content_opened",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(openedHook);
  scenarioHookHandlers.test_count_talk_content_opened = (_context, event) => {
    openedContentIds.push(event.contentId);
  };
  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    for (let index = 0; index < 2; index += 1) {
      const opened = await app.request("http://localhost/api/content/opened", {
        method: "POST",
        headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
        body: JSON.stringify({ appId: "messages", contentId: workerScenario.publicIds.talk.guide })
      });
      assert.equal(opened.status, 200);
    }
    assert.deepEqual(openedContentIds, ["guide", "guide"]);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(openedHook), 1);
    delete scenarioHookHandlers.test_count_talk_content_opened;
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
    event: "message_link_opened",
    target: "verified_action",
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
    assert.equal(capturedEvent?.actionId, "verified_action");
    assert.equal(capturedEvent?.talkId, talk.id);
    assert.equal(capturedEvent?.fields.appId, content.appId);
    assert.equal(capturedEvent?.contentId, content.id);
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

  const searched = await searchAgentRequest(app, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ query: "古いメモ" })
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

test("予定イベントの公開拒否は完了扱いにせず再実行可能な状態へ戻す", async () => {
  const store = new MemoryStore();
  const hook = {
    event: "scheduled_event",
    target: "test_scheduled_rejection",
    handler: "test_scheduled_rejection",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_scheduled_rejection = (context) => context.form.deny("rejected");
  store.schedules.push({
    id: "scheduled-rejection",
    scheduleId: "scheduled-rejection",
    eventId: "test_scheduled_rejection",
    fields: {},
    dueAt: "2000-01-01T00:00:00.000Z",
    playerId: store.player.id,
    status: "queued"
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const response = await app.request("http://localhost/api/player-state", {
      method: "POST",
      headers: { authorization: "Bearer memory-token" }
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "scheduled_event_unavailable");
    assert.equal(store.schedules[0].status, "queued");
  } finally {
    console.error = originalConsoleError;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_scheduled_rejection;
  }
});

test("完了イベントの状態更新後に期限到来済み予約イベントを評価する", async () => {
  const store = new MemoryStore();
  const completionHook = {
    event: "audio_playback_completed",
    target: "sample_radio",
    handler: "test_mark_completion",
    cond: "!test_completion",
    llm: false
  };
  const scheduledHook = {
    event: "scheduled_event",
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
    event: "scheduled_event",
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
  const futureWakeAt = "2099-01-01T00:00:00.000Z";
  await store.queueScheduledEvent(store.player.id, "future-event", "test_after_incoming", {}, futureWakeAt);

  try {
    const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
    const interrupted = await searchAgentRequest(app, {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ query: "古いメモ" })
    });
    assert.equal(interrupted.status, 409);
    const interruptedBody = await interrupted.json();
    assert.equal(interruptedBody.error, "incoming_call_active");
    assert.equal(interruptedBody.playerState.visibleDeviceState.incomingCall.id, workerScenario.publicIds.incomingCall.demo_call);
    assert.equal(interruptedBody.playerState.nextScenarioWakeAt, null);
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
    assert.equal((await completed.json()).playerState.nextScenarioWakeAt, futureWakeAt);
    assert.equal(store.player.state.incomingCallId, null);
    assert.equal(store.player.state.stateValues.test_after_incoming, true);
    assert.equal(store.schedules[1].status, "completed");
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(afterIncomingHook), 1);
    delete scenarioHookHandlers.test_after_incoming;
    delete workerScenario.stateVariables.test_after_incoming;
  }
});

test("作品イベントの不受理は両モードで元の理由と予約適用済み状態を返す", async (t) => {
  const originalMode = workerScenario.playerMode;
  const originalPublicStateVariables = workerScenario.publicStateVariables;
  const hooks = [
    { event: "test_stage_schedule", target: "", handler: "test_stage_schedule", cond: "", llm: false },
    { event: "scheduled_event", target: "test_stage_due", handler: "test_stage_due", cond: "", llm: false },
    { event: "test_stage_action", target: "", handler: "test_stage_action", cond: "", llm: false }
  ];
  const eventIds = ["test_stage_schedule", "test_stage_action"];
  const stateIds = ["test_stage_due_applied", "test_stage_action_applied"];
  workerScenario.hooks.push(...hooks);
  workerScenario.clientCallableEvents.push(...eventIds);
  workerScenario.publicStateVariables = [...originalPublicStateVariables, ...stateIds];
  workerScenario.publicIds.scenarioEvent.test_stage_due = "public_test_stage_due";
  for (const id of stateIds) workerScenario.stateVariables[id] = false;
  scenarioHookHandlers.test_stage_schedule = (context) => {
    context.schedule.after("test_stage_due", 0, {}, "test_stage_due_instance");
  };

  try {
    const cases = [
      { error: "incoming_call_active", incoming: true },
      ...["wrong_password", "conflict", "invalid_response", "unauthorized", "browser_progress_too_large"]
        .map((error) => ({ error, incoming: false })),
      { error: "generated_audio_rejected", incoming: false, generatedAudio: true }
    ];
    for (const mode of ["server", "browser"]) {
      for (const rejection of cases) {
        await t.test(`${mode}: ${rejection.error}`, async () => {
          workerScenario.playerMode = mode;
          let actionHookCalls = 0;
          let dueHookCalls = 0;
          scenarioHookHandlers.test_stage_due = (context) => {
            dueHookCalls += 1;
            context.state.set("test_stage_due_applied", true);
            if (rejection.incoming) context.incoming.start("demo_call");
          };
          scenarioHookHandlers.test_stage_action = (context) => {
            actionHookCalls += 1;
            context.state.set("test_stage_action_applied", true);
            if (rejection.generatedAudio) context.genAudio.reject(rejection.error);
            context.form.deny(rejection.error);
          };
          const store = new MemoryStore();
          const app = createApp({
            store,
            config: {
              appEnv: "development",
              browserStateSecret: "stage-rejection-test-secret",
              playerInputLogging: false,
              llm: {}
            }
          });
          const headers = {
            "content-type": "application/json",
            ...(mode === "server" ? { authorization: "Bearer memory-token" } : {})
          };
          const started = await app.request("http://localhost/api/session/start", {
            method: "POST", headers, body: JSON.stringify({ serialCode: "1234" })
          });
          assert.equal(started.status, 200);
          let progressToken = (await started.json()).playerState.progressToken;
          const scheduled = await app.request("http://localhost/api/scenario/event", {
            method: "POST", headers,
            body: JSON.stringify({ progressToken, eventId: "test_stage_schedule" })
          });
          assert.equal(scheduled.status, 200);
          const scheduledState = (await scheduled.json()).playerState;
          progressToken = scheduledState.progressToken;
          assert.equal(scheduledState.projectState.test_stage_due_applied, false);

          const rejected = await app.request("http://localhost/api/scenario/event", {
            method: "POST", headers,
            body: JSON.stringify({ progressToken, eventId: "test_stage_action" })
          });
          assert.equal(rejected.status, rejection.incoming ? 409 : 422);
          const body = await rejected.json();
          assert.equal(body.ok, false);
          assert.equal(body.error, rejection.error);
          assert.equal(actionHookCalls, rejection.incoming ? 0 : 1, "着信による不受理では作品hookを実行しない");
          assert.equal(dueHookCalls, 1);
          assert.ok(body.playerState.stateVersion > scheduledState.stateVersion);
          assert.equal(body.playerState.projectState.test_stage_due_applied, true, "拒否前に適用した予約の進行を残す");
          assert.equal(body.playerState.projectState.test_stage_action_applied, false, "拒否したhookの変更を採用しない");
          assert.equal(body.playerState.visibleDeviceState.incomingCall?.id ?? null,
            rejection.incoming ? workerScenario.publicIds.incomingCall.demo_call : null);

          const restored = await app.request("http://localhost/api/player-state", {
            method: "POST", headers,
            body: JSON.stringify({ progressToken: body.playerState.progressToken })
          });
          assert.equal(restored.status, 200, "不受理応答の状態で次の状態取得を継続できる");
          assert.deepEqual((await restored.json()).playerState.projectState, body.playerState.projectState);
          assert.equal(dueHookCalls, 1, "保存済み予約を再実行しない");
          assert.equal(actionHookCalls, rejection.incoming ? 0 : 1);
        });
      }
    }
  } finally {
    workerScenario.playerMode = originalMode;
    workerScenario.publicStateVariables = originalPublicStateVariables;
    delete workerScenario.publicIds.scenarioEvent.test_stage_due;
    for (const hook of hooks) {
      workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
      delete scenarioHookHandlers[hook.handler];
    }
    for (const eventId of eventIds) workerScenario.clientCallableEvents.splice(workerScenario.clientCallableEvents.indexOf(eventId), 1);
    for (const id of stateIds) delete workerScenario.stateVariables[id];
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
    event: "audio_playback_completed",
    target: "sample_radio",
    handler: "test_mark_completion_conflict",
    cond: "!test_completion_conflict",
    llm: false
  };
  const scheduledHook = {
    event: "scheduled_event",
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

test("完了イベントがeffect sequenceを開始した時は同じrequestで予約イベントを進めない", async () => {
  const store = new MemoryStore();
  const initialized = await reconcileScenarioState(store.player.state, store.player.id);
  store.player.state = initialized.state;
  const completionHook = {
    event: "audio_playback_completed",
    target: "sample_radio",
    handler: "test_completion_sequence",
    cond: "",
    llm: false
  };
  const scheduledHook = {
    event: "scheduled_event",
    target: "test_after_completion_sequence",
    handler: "test_after_completion_sequence",
    cond: "",
    llm: false
  };
  workerScenario.stateVariables.test_after_completion_sequence = false;
  workerScenario.hooks.push(completionHook, scheduledHook);
  scenarioHookHandlers.test_completion_sequence = (context) => context.effectSequence.gameOver();
  scenarioHookHandlers.test_after_completion_sequence = (context) => context.state.set("test_after_completion_sequence", true);
  store.schedules.push({
    id: "event-after-sequence",
    scheduleId: "schedule-after-sequence",
    eventId: "test_after_completion_sequence",
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
    assert.equal((await response.json()).presentation?.sequence?.type, "game_over");
    assert.equal(store.schedules[0].status, "queued");
    assert.equal(store.player.state.stateValues.test_after_completion_sequence, undefined);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(completionHook), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(scheduledHook), 1);
    delete workerScenario.stateVariables.test_after_completion_sequence;
    delete scenarioHookHandlers.test_completion_sequence;
    delete scenarioHookHandlers.test_after_completion_sequence;
  }
});

test("クライアントからの作品固有イベントは明示許可されたtargetだけを受理する", async () => {
  const store = new MemoryStore();
  store.player.state.stateValues.sealed_note_unlocked = true;
  workerScenario.stateVariables.test_client_secondary = false;
  store.player.state.stateValues.test_client_secondary = false;
  const secondaryHook = {
    event: "chat_auth_link_requested",
    target: "",
    handler: "test_client_secondary",
    cond: "",
    llm: false
  };
  workerScenario.hooks.push(secondaryHook);
  scenarioHookHandlers.test_client_secondary = (context) => {
    context.state.set("test_client_secondary", true);
    context.effect.flash({
      fadeInMs: 50,
      holdMs: 0,
      fadeOutMs: 100,
      intensity: 0.6,
      color: "#AABBCC"
    });
  };
  workerScenario.clientCallableEvents.push("demo_all_clear");

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
    const allowedBody = await allowed.json();
    assert.equal(store.player.state.stateValues.chat_auth_link_sent, true);
    assert.equal(store.player.state.stateValues.test_client_secondary, true);
    assert.deepEqual(allowedBody.presentation?.effects, [{
      type: "flash",
      fadeInMs: 50,
      holdMs: 0,
      fadeOutMs: 100,
      intensity: 0.6,
      color: "#aabbcc"
    }]);

    const allClear = await app.request("http://localhost/api/scenario/event", {
      method: "POST",
      headers: { authorization: "Bearer memory-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "demo_all_clear" })
    });
    assert.equal(allClear.status, 200);
    const allClearBody = await allClear.json();
    assert.equal(allClearBody.presentation?.sequence?.type, "all_clear");
    assert.equal(allClearBody.presentation?.sequence?.target.contentId, workerScenario.publicIds.content.sample_radio);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(secondaryHook), 1);
    workerScenario.clientCallableEvents.pop();
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
    event: "form_submitted",
    target: "demo_form",
    handler: "test_capture_form_context",
    cond: "",
    llm: false
  };
  content.record.form = { kind: "html", id: "demo_form", label: "テスト", url: "/test" };
  content.record.formDisabledCond = "radio_playback_completed";
  workerScenario.publicIds.form.demo_form = "form_demo_public";
  workerScenario.hooks.push(formHook);
  scenarioHookHandlers.test_capture_form_context = (context, event) => {
    capturedEvent = structuredClone(event);
    context.state.set("radio_playback_completed", true);
    context.effect.noise(120);
    context.effect.flash({ fadeInMs: 20, holdMs: 10, fadeOutMs: 50, intensity: 0.8, color: "white" });
    context.effect.blackout({ fadeInMs: 30, holdMs: 0, fadeOutMs: 30, intensity: -1 });
    context.effectSequence.gameOver("form_test");
  };
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
    const validBody = await valid.json();
    assert.deepEqual(validBody.presentation?.effects, [
      { type: "noise", durationMs: 120 },
      {
        type: "flash",
        fadeInMs: 20,
        holdMs: 10,
        fadeOutMs: 50,
        intensity: 0.8,
        color: "#fffaf2"
      },
      {
        type: "blackout",
        fadeInMs: 30,
        holdMs: 0,
        fadeOutMs: 30,
        intensity: 0
      }
    ]);
    assert.equal(validBody.presentation?.sequence?.type, "game_over");
    assert.equal(validBody.presentation?.sequence?.reasonMessage, "form_test");
    assert.equal(store.player.state.stateValues.radio_playback_completed, true);
    assert.equal(capturedEvent?.fields.message, "確認");
    assert.equal(capturedEvent?.formId, "demo_form");
    assert.equal(capturedEvent?.fields.appId, content.appId);
    assert.equal(capturedEvent?.contentId, content.id);

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
    event: "audio_cue_reached",
    target: "sample_radio:private_marker",
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
    assert.equal(capturedEvent.contentId, "sample_radio");
    assert.equal(capturedEvent.cueId, "private_marker");
    assert.equal(capturedEvent.cueTarget, "sample_radio:private_marker");
    assert.equal(capturedEvent.cueIndex, 1);

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
    playerId: "player-1",
    occurredAt: "2026-08-17T00:00:00.000Z",
    appId: null,
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
  const response = await app.request("https://example.test/api/admin/player-input-review/events?playerId=player-1&talkId=guide&q=灯り&limit=200", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(store.playerInputReviewFilters, {
    playerId: "player-1",
    talkId: "guide",
    query: "灯り",
    limit: 200
  });
  const responseBody = await response.json();
  assert.equal(responseBody.items[0].userInput, '=HYPERLINK("bad")');
  assert.equal(responseBody.items[0].appId, null);

  const csv = await app.request("https://example.test/api/admin/player-input-review.csv", { headers });
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
  assert.doesNotMatch(html, /id="eventType"/u);
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

test("旧rule IDの監修入力は保存snapshotから現在ruleへ一意に割り当てる", async () => {
  const store = new MemoryStore();
  const talk = workerScenario.talks[0];
  const rule = talk.rules.find((item) => item.from !== "*" && item.outputSteps.length > 0);
  assert.ok(talk && rule);
  store.reviewEvents = [{
    id: "legacy-event",
    ruleId: "removed-rule",
    userInput: "旧リビジョンの入力",
    normalizedInput: "旧リビジョンの入力",
    responseSnapshot: {
      outputSteps: structuredClone(rule.outputSteps),
      nextBlocks: [...rule.nextBlocks]
    }
  }, {
    id: "unresolved-event",
    ruleId: "unknown-rule",
    userInput: "割当不能な入力",
    normalizedInput: "割当不能な入力",
    responseSnapshot: {}
  }];
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const params = new URLSearchParams({ talkId: talk.id, fromId: rule.from });

  const detailResponse = await app.request(`http://localhost/api/admin/talk-branch-review/from?${params}`);
  assert.equal(detailResponse.status, 200);
  const branch = (await detailResponse.json()).detail.branches.find((item) => item.ruleId === rule.id);
  assert.equal(branch.inputCount, 1);
  assert.deepEqual(branch.clusters.flatMap((cluster) => cluster.sourceEventIds), ["legacy-event"]);

  const replacement = {
    talkId: talk.id,
    fromId: rule.from,
    actualRuleId: rule.id,
    scenarioRevision: workerScenario.revision,
    analysisVersion: "test-v1",
    clusters: [{
      id: "legacy-cluster",
      fit: "blue",
      representativeInput: "旧リビジョンの入力",
      sourceEventIds: ["legacy-event"],
      reason: "現在ruleへ一意に対応"
    }]
  };
  const saved = await app.request("http://localhost/api/admin/talk-branch-review/clusters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(replacement)
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(store.replacedClusters?.[4][0].sourceEventIds, ["legacy-event"]);

  const unresolved = await app.request("http://localhost/api/admin/talk-branch-review/clusters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...replacement,
      clusters: [{ ...replacement.clusters[0], sourceEventIds: ["unresolved-event"] }]
    })
  });
  assert.equal(unresolved.status, 400);
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
  const talk = workerScenario.talks.find((item) => item.id === "search_agent");
  const rule = talk?.rules.find((item) => item.intent === "灯りの色を報告");
  assert.ok(talk && rule);
  const fromId = talk.initialFrom;
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const detailResponse = await app.request(
    `http://localhost/api/admin/talk-branch-review/from?talkId=${talk.id}&fromId=${encodeURIComponent(fromId)}`
  );
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).detail;
  assert.match(detail.branches.find((item) => item.ruleId === rule.id).criteria, /^機械的な一致判定：\//u);

  const simulated = await app.request("http://localhost/api/admin/talk-branch-review/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ talkId: talk.id, fromId, targetRuleId: rule.id, message: "青です" })
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
      body: JSON.stringify({ talkId: talk.id, fromId, targetRuleId: rule.id, message: "青です" })
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

test("検索AIの監修試行は条件blockと検索件数を副作用なしでpreviewする", async () => {
  const store = new MemoryStore();
  const talk = workerScenario.talks.find((item) => item.kind === "search_agent");
  const rule = talk?.rules.find((item) => item.from === talk.initialFrom && item.isDefault);
  assert.ok(talk && rule);
  const beforeState = structuredClone(store.player.state);
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const response = await app.request("http://localhost/api/admin/talk-branch-review/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      talkId: talk.id,
      fromId: talk.initialFrom,
      targetRuleId: rule.id,
      message: "消えた連絡記録"
    })
  });
  assert.equal(response.status, 200);
  const result = (await response.json()).result;
  assert.deepEqual(result.selectedBlockIds, ["search_agent::found"]);
  assert.ok(result.resultCount > 0);
  assert.deepEqual(store.savedReviewTrial.responseSnapshot.selectedBlockIds, ["search_agent::found"]);
  assert.equal(store.savedReviewTrial.responseSnapshot.resultCount, result.resultCount);
  assert.deepEqual(store.player.state, beforeState, "監修previewはgameplay stateを変更しない");
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

async function startTalkClockFixture() {
  const store = new MemoryStore();
  const app = createApp({ store, config: { appEnv: "development", playerInputLogging: false, llm: {} } });
  const headers = { authorization: "Bearer memory-token", "content-type": "application/json" };
  const started = await app.request("http://localhost/api/session/start", {
    method: "POST", headers, body: JSON.stringify({ serialCode: "1234" })
  });
  assert.equal(started.status, 200);
  const body = await started.json();
  const talkId = workerScenario.publicIds.talk.guide;
  const initialSeq = body.playerState.talks.find((talk) => talk.talkId === talkId).lastMessageSeq;
  const request = async (path, payload) => {
    const response = await app.request(`http://localhost${path}`, {
      method: "POST", headers, body: JSON.stringify(payload)
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const send = (message) => request("/api/talk/send", {
    talkId, turnKey: store.player.state.talks.guide.turnKey, message
  });
  // 即時応答にだけ残るkindとnullのsenderNameを除き、履歴の全表示値を比較する。
  const comparableMessages = (messages) => messages.map(({ kind: _kind, senderName, ...message }) => ({
    ...message, ...(senderName == null ? {} : { senderName })
  }));
  const messages = (response) => comparableMessages(response.playerState.transcriptDeltas.find((delta) => delta.talkId === talkId)?.messages ?? []);
  const fetchAfter = async (after) => {
    const response = await app.request(`http://localhost/api/transcript/${talkId}?after=${after}`, { headers });
    assert.equal(response.status, 200);
    return comparableMessages((await response.json()).delta.messages);
  };
  return { store, app, headers, talkId, initialSeq, request, send, messages, fetchAfter };
}

test("短い間隔と時計逆行のtalk送信でも即時応答・復元・差分のseqが一致する", async (t) => {
  const at = Date.parse("2026-09-05T01:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: at });
  const fixture = await startTalkClockFixture();
  const immediate = [];
  for (const [index, offset] of [0, 600, -400].entries()) {
    t.mock.timers.setTime(at + offset);
    immediate.push(...fixture.messages(await fixture.send(`確認します${index + 1}`)));
  }
  assert.deepEqual(await fixture.fetchAfter(fixture.initialSeq), immediate);
  assert.deepEqual(await fixture.fetchAfter(immediate[1].seq), immediate.slice(2));
  assert.equal(immediate[1].sentAt, "2026-09-05T01:00:01.000Z", "従来の返信1秒間隔を維持する");
  for (let index = 1; index < immediate.length; index += 1) {
    assert.ok(Date.parse(immediate[index].sentAt) > Date.parse(immediate[index - 1].sentAt));
  }
});

test("送信後の同commit hook・別request hook・予定hookはtalk水位を引き継ぐ", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-05T01:00:00.000Z") });
  const fixture = await startTalkClockFixture();
  const hooks = [
    { event: "talk_turn_completed", target: "guide", handler: "test_clock_turn", cond: "", llm: false },
    { event: "test_clock_request", target: "", handler: "test_clock_request", cond: "", llm: false },
    { event: "scheduled_event", target: "test_clock_due", handler: "test_clock_due", cond: "", llm: false }
  ];
  workerScenario.hooks.push(...hooks);
  workerScenario.clientCallableEvents.push("test_clock_request");
  scenarioHookHandlers.test_clock_turn = (context) => {
    context.talk.addBlock("guide", "clue_attachments", { mode: "stay" });
    context.talk.addBlock("guide", "message_test_ack", { mode: "stay" });
  };
  scenarioHookHandlers.test_clock_request = (context) => context.talk.addBlock("guide", "chat_auth_link", { mode: "stay" });
  scenarioHookHandlers.test_clock_due = (context) => context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
  try {
    const immediate = fixture.messages(await fixture.send("確認します"));
    immediate.push(...fixture.messages(await fixture.request("/api/scenario/event", { eventId: "test_clock_request" })));
    await fixture.store.queueScheduledEvent(fixture.store.player.id, "test-clock-job", "test_clock_due", {}, new Date().toISOString());
    immediate.push(...fixture.messages(await fixture.request("/api/player-state", {})));
    assert.deepEqual(await fixture.fetchAfter(fixture.initialSeq), immediate);
    for (let index = 1; index < immediate.length; index += 1) {
      assert.ok(Date.parse(immediate[index].sentAt) > Date.parse(immediate[index - 1].sentAt));
    }
    assert.equal(fixture.store.player.state.talks.guide.lastDeliveredAt, immediate.at(-1).sentAt);
  } finally {
    for (const hook of hooks) {
      workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
      delete scenarioHookHandlers[hook.handler];
    }
    workerScenario.clientCallableEvents.splice(workerScenario.clientCallableEvents.indexOf("test_clock_request"), 1);
  }
});

test("シナリオ更新後の現行talkは保存済み水位を再開session hookへ引き継ぐ", async (t) => {
  const at = Date.parse("2026-09-05T01:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: at });
  const fixture = await startTalkClockFixture();
  const beforeUpdate = fixture.messages(await fixture.send("確認します"));
  const savedDeliveredAt = fixture.store.player.state.talks.guide.lastDeliveredAt;
  assert.equal(savedDeliveredAt, beforeUpdate.at(-1).sentAt);
  const originalRevision = workerScenario.revision;
  workerScenario.revision = `${originalRevision}-clock-update`;
  const hook = { event: "session_started", target: "", handler: "test_clock_resume", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_clock_resume = (context) => context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
  let loads = 0;
  const originalLoad = fixture.store.loadTranscript.bind(fixture.store);
  fixture.store.loadTranscript = (...args) => { loads += 1; return originalLoad(...args); };
  try {
    await fixture.request("/api/player-state", {});
    assert.equal(fixture.store.player.state.talks.guide.lastDeliveredAt, savedDeliveredAt);
    assert.equal(loads, 0, "現行stateの取得は履歴読込による時刻補完を要しない");
    const resumed = await fixture.request("/api/session/start", { serialCode: "1234" });
    const added = fixture.messages(resumed);
    assert.equal(added[0].sentAt, new Date(Date.parse(savedDeliveredAt) + 1).toISOString());
    assert.equal(fixture.store.player.state.talks.guide.lastDeliveredAt, added.at(-1).sentAt);
    assert.deepEqual(await fixture.fetchAfter(fixture.initialSeq), [...beforeUpdate, ...added]);
  } finally {
    workerScenario.revision = originalRevision;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_clock_resume;
  }
});

for (const dispatchMode of ["同commit", "別request"]) {
  test(`個別once条件の2hookが共通blockを${dispatchMode}で追加しても即時・復元・差分が一致する`, async () => {
    const fixture = await startTalkClockFixture();
    const hooks = ["a", "b"].map((name) => ({
      event: dispatchMode === "同commit" ? "test_shared_hook_block" : `test_shared_hook_block_${name}`,
      target: "", handler: `test_shared_hook_block_${name}`, cond: `!test_shared_hook_block_${name}_done`, llm: false
    }));
    const eventIds = [...new Set(hooks.map((hook) => hook.event))];
    for (const hook of hooks) {
      workerScenario.stateVariables[`${hook.handler}_done`] = false;
      workerScenario.hooks.push(hook);
      scenarioHookHandlers[hook.handler] = (context) => {
        context.state.set(`${hook.handler}_done`, true);
        context.talk.addBlock("guide", "message_reply", { mode: "stay" });
      };
    }
    workerScenario.clientCallableEvents.push(...eventIds);
    try {
      const immediate = [];
      for (const eventId of eventIds) {
        immediate.push(...fixture.messages(await fixture.request("/api/scenario/event", { eventId })));
        assert.deepEqual(fixture.messages(await fixture.request("/api/scenario/event", { eventId })), [], "各once条件の再送は追加しない");
      }
      const stored = fixture.store.player.state.talks.guide;
      const raw = await fixture.store.loadTranscript(fixture.store.player.id, "talk:guide", stored.transcriptKey);
      assert.equal(raw.messages.length, 2);
      assert.equal(new Set(raw.messages.map((event) => event.id)).size, 2);
      assert.deepEqual(immediate.map((message) => message.seq), [fixture.initialSeq + 1, fixture.initialSeq + 2]);
      assert.equal(new Set(immediate.map((message) => message.id)).size, 2);
      assert.deepEqual(immediate.map((message) => message.body), ["メッセージの送受信を確認できました。", "追加のメッセージも受け取りました。"]);
      assert.deepEqual(await fixture.fetchAfter(fixture.initialSeq), immediate);
      assert.deepEqual(await fixture.fetchAfter(immediate[0].seq), immediate.slice(1));
      assert.equal(stored.lastMessageSeq, immediate.at(-1).seq);
      assert.equal(stored.blockDisplayCounts["guide::message_reply"], 2);
    } finally {
      for (const hook of hooks) {
        workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
        delete workerScenario.stateVariables[`${hook.handler}_done`];
        delete scenarioHookHandlers[hook.handler];
      }
      for (const eventId of eventIds) workerScenario.clientCallableEvents.splice(workerScenario.clientCallableEvents.indexOf(eventId), 1);
    }
  });
}

test("同一turnのCAS敗者はhookのevent IDや表示回数を余分に確定しない", async () => {
  const fixture = await startTalkClockFixture();
  const hook = { event: "talk_turn_completed", target: "guide", handler: "test_hook_id_cas", cond: "!test_hook_id_cas_done", llm: false };
  workerScenario.stateVariables.test_hook_id_cas_done = false;
  workerScenario.hooks.push(hook);
  scenarioHookHandlers[hook.handler] = (context) => {
    context.state.set("test_hook_id_cas_done", true);
    context.talk.addBlock("guide", "message_test_ack", { mode: "stay" });
  };
  const originalSave = fixture.store.savePlayer.bind(fixture.store);
  const candidates = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  fixture.store.savePlayer = async (player, nextState, transcripts, effects) => {
    const hookEvent = transcripts?.flatMap((append) => append.messages).find((event) => event.block_id === "guide::message_test_ack");
    if (hookEvent) {
      candidates.push(hookEvent.id);
      if (candidates.length === 2) release();
      await gate;
    }
    return originalSave(player, nextState, transcripts, effects);
  };
  try {
    const turnKey = fixture.store.player.state.talks.guide.turnKey;
    const send = () => fixture.app.request("http://localhost/api/talk/send", {
      method: "POST", headers: fixture.headers,
      body: JSON.stringify({ talkId: fixture.talkId, turnKey, message: "確認します" })
    });
    const responses = await Promise.all([send(), send()]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0], candidates[1], "同じsnapshotから作るhook IDはCASの勝敗に依存しない");
    const accepted = await responses.find((response) => response.status === 200).json();
    const immediate = fixture.messages(accepted);
    const stored = fixture.store.player.state.talks.guide;
    assert.equal(stored.blockDisplayCounts["guide::message_test_ack"], 1);
    assert.equal(stored.lastMessageSeq, immediate.at(-1).seq);
    assert.deepEqual(await fixture.fetchAfter(fixture.initialSeq), immediate);
    const replayed = await send();
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json()).stale, true);
    assert.equal(fixture.store.player.state.talks.guide.blockDisplayCounts["guide::message_test_ack"], 1);
  } finally {
    release();
    fixture.store.savePlayer = originalSave;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete workerScenario.stateVariables.test_hook_id_cas_done;
    delete scenarioHookHandlers[hook.handler];
  }
});
