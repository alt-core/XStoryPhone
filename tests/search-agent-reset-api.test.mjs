import assert from "node:assert/strict";
import test from "node:test";
import { workerScenario } from "../src/generated/workerScenario.generated.ts";
import { createScenarioRuntime } from "../src/worker/scenarioRuntime.ts";
import { createScenarioHooksRuntime } from "../src/worker/services/scenarioHooksRuntime.ts";
import { createGeneratedAudioRuntime } from "../src/worker/services/generatedAudioRuntime.ts";
import { createPlayerOperations } from "../src/server/playerApp.ts";
import { decodeBrowserProgress } from "../src/server/browserProgress.ts";
import { mergeTranscriptAppend } from "../src/server/store.ts";

const streamId = "talk:search_agent";
const secret = "search-agent-reset-api-test";
const bodies = {
  initial: "前の段階の初期案内",
  before: "区切る前の追加案内",
  middle: "途中の鍵の追加案内",
  after: "新しい段階の案内"
};

class MemoryStore {
  player = { id: "reset-player", state: null, stateVersion: 0 };
  transcripts = new Map();
  savedAppends = [];

  async createPasscodeSession() { return { playerId: this.player.id, sessionToken: "reset-token", created: this.player.state === null }; }
  async playerForSession(token) { return token === "reset-token" ? structuredClone(this.player) : null; }
  async savePlayer(player, state, appends = []) {
    assert.equal(player.stateVersion, this.player.stateVersion);
    this.savedAppends.push(structuredClone(appends));
    this.player = { id: player.id, state: structuredClone(state), stateVersion: player.stateVersion + 1 };
    for (const append of appends) {
      const previous = this.transcripts.get(append.streamId) ?? { streamId: append.streamId, transcriptKey: append.transcriptKey, messages: [] };
      this.transcripts.set(append.streamId, structuredClone(mergeTranscriptAppend(previous, append)));
    }
    return true;
  }
  async loadTranscript(_playerId, requestedStreamId, transcriptKey) {
    const transcript = this.transcripts.get(requestedStreamId);
    return structuredClone(transcript?.transcriptKey === transcriptKey
      ? transcript : { streamId: requestedStreamId, transcriptKey, messages: [] });
  }
  async dueScheduledEvents() { return []; }
  async nextScheduledWakeAt() { return null; }
  async recordInputEvent() {}
}

function fixture(mode, hookRows, handlers, quickRepliesByBlock = {}) {
  // 生成済み台本を複製し、他のテストや利用者の台本を変更しない。
  const scenario = structuredClone(workerScenario);
  scenario.playerMode = mode;
  scenario.project.accessCode = "none";
  scenario.project.lockScreen = { method: "none" };
  scenario.initialSchedules = [];
  scenario.generatedAudio = [];
  scenario.features.llm = false;
  scenario.hooks = hookRows.map((row, order) => ({ target: "", cond: "", needsAi: false, part: "base", order, ...row }));
  const search = scenario.talks.find(talk => talk.kind === "search_agent");
  search.initialFrom = "search_agent::initial";
  search.startSteps = [{ kind: "block", blockId: search.initialFrom }];
  search.inputVisible = true;
  search.inputEnabled = true;
  search.rules = [{
    id: "reset-default", type: "default", part: "base", loadParts: [], order: 0,
    from: search.initialFrom, isDefault: true, cond: "", criteria: "", match: "",
    outputSteps: [{ kind: "search", queryTemplate: "{{player_input}}" }, { kind: "block", blockId: "search_agent::before" }],
    nextBlocks: ["search_agent::before"], nextFromId: "", set: [], mode: "stay"
  }];
  scenario.talkBlocks = scenario.talkBlocks.filter(block => block.talkId !== search.id);
  for (const [blockKey, body] of Object.entries(bodies)) {
    scenario.talkBlocks.push({
      id: `search_agent::${blockKey}`, talkId: search.id, blockKey, part: "base", order: 0,
      messages: [{ id: `reset_${blockKey}`, sender: "search_agent", body, attachmentId: "", sentAt: "",
        ...(quickRepliesByBlock[blockKey] ? { quickReplies: quickRepliesByBlock[blockKey] } : {}) }]
    });
  }
  const store = new MemoryStore();
  let token;
  let operations;
  const runtime = createScenarioRuntime(scenario);
  const buildOperations = () => createPlayerOperations(runtime,
    createScenarioHooksRuntime(runtime, handlers, { search_agent: Object.keys(bodies) }), createGeneratedAudioRuntime(runtime));
  operations = buildOperations();
  const dependencies = { store, config: { appEnv: "development", browserStateSecret: secret, llm: {}, playerInputLogging: false } };
  async function call(route, body = {}, extras = {}) {
    const result = await operations.execute(route, {
      hostname: "localhost", authorization: `Bearer ${token ?? ""}`,
      body: { ...body, ...(mode === "browser" && token ? { progressToken: token } : {}) }, ...extras
    }, dependencies);
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    token = result.payload.playerState?.progressToken ?? result.payload.sessionToken ?? token;
    return result.payload;
  }
  return {
    runtime, store, call, search,
    reload() { operations = buildOperations(); },
    async stored() {
      return mode === "browser" ? (await decodeBrowserProgress(secret, scenario.project.id, token)).state : store.player.state;
    }
  };
}

function searchControl(state) { return state.talks.find(talk => talk.kind === "search_agent"); }
function searchDeltas(state) { return state.transcriptDeltas.filter(delta => delta.kind === "search_agent"); }

async function assertFinalHistory(f, state, expectedBodies, expectedKinds = expectedBodies.map(() => "message")) {
  const control = searchControl(state);
  const deltas = searchDeltas(state);
  assert.ok(deltas.every(delta => delta.transcriptKey === control.transcriptKey), "応答は最終状態の鍵だけを返す");
  assert.deepEqual(deltas.flatMap(delta => delta.messages).map(message => message.kind), expectedKinds);
  assert.deepEqual(deltas.flatMap(delta => delta.messages).filter(message => message.kind === "message").map(message => message.body), expectedBodies);
  assert.deepEqual(deltas.flatMap(delta => delta.messages).map(message => message.seq), expectedKinds.map((_, index) => index + 1));
  assert.equal(control.lastMessageSeq, expectedKinds.length);
  const stored = await f.stored();
  assert.equal(stored.talks.search_agent.transcriptKey, control.transcriptKey);
  assert.equal(stored.talks.search_agent.lastMessageSeq, expectedKinds.length);
  if (f.runtime.workerScenario.playerMode === "server") {
    assert.ok(f.store.savedAppends.at(-1).filter(append => append.streamId === streamId)
      .every(append => append.transcriptKey === control.transcriptKey), "保存も最終状態の鍵だけを対象にする");
  }

  // 操作入口を作り直して読み込み、以前の台本出力が復活しないことを確認する。
  f.reload();
  const reloaded = (await f.call("POST /api/player-state")).playerState;
  assert.equal(searchControl(reloaded).transcriptKey, control.transcriptKey);
  assert.equal(searchControl(reloaded).lastMessageSeq, expectedKinds.length);
  assert.deepEqual(searchDeltas(reloaded), []);
  if (f.runtime.workerScenario.playerMode === "server") {
    const transcript = await f.call("GET /api/transcript/:stream", {}, { params: { stream: f.search.publicId } });
    assert.equal(transcript.delta.transcriptKey, control.transcriptKey);
    assert.deepEqual(transcript.delta.messages.map(message => message.kind), expectedKinds);
    assert.deepEqual(transcript.delta.messages.filter(message => message.kind === "message").map(message => message.body), expectedBodies);
  }
}

for (const mode of ["server", "browser"]) {
  for (const addMode of ["stay", "advance"]) {
    test(`${mode}/${addMode}: 履歴リセット前の選択肢と通常入力は新しい履歴を変更せず、新しい送信は受け付ける`, async () => {
      const newReply = { label: "新選択肢", text: "" };
      const oldReply = addMode === "advance" ? newReply : { label: "旧選択肢", text: "" };
      const f = fixture(mode, [
        ...(addMode === "advance" ? [{ event: "session_started", handler: "reset" }] : []),
        { event: "content_opened", target: "welcome_note", handler: "reset" }
      ], {
        reset(context) {
          context.talk.resetHistory("search_agent");
          if (addMode === "stay") context.talk.addBlock("search_agent", "after", { mode: "stay" });
          else context.talk.addBlock("search_agent", "after");
        }
      }, { initial: [oldReply], after: [newReply] });
      if (addMode === "advance") {
        f.search.rules.push({ ...f.search.rules[0], id: "reset-after-default", from: "search_agent::after" });
      }
      const started = (await f.call("POST /api/session/start", { serialCode: "1234" })).playerState;
      const oldControl = searchControl(started);
      const oldFrom = (await f.stored()).talks.search_agent.from;
      assert.equal(oldControl.lastMessageSeq, 1);
      assert.deepEqual(searchDeltas(started).flatMap(delta => delta.messages).at(-1).quickReplies, [oldReply]);

      const content = f.runtime.workerScenario.contents.find(item => item.id === "welcome_note");
      const reset = (await f.call("POST /api/content/opened", { appId: "notes", contentId: content.publicId })).playerState;
      const newControl = searchControl(reset);
      assert.equal(newControl.lastMessageSeq, 1, "新しい選択肢もseq 1を使う反例を固定する");
      assert.notEqual(newControl.transcriptKey, oldControl.transcriptKey);
      assert.notEqual(newControl.turnKey, oldControl.turnKey);
      assert.deepEqual(searchDeltas(reset).flatMap(delta => delta.messages).at(-1).quickReplies, [newReply]);
      const storedAfterReset = structuredClone(await f.stored());
      assert.equal(storedAfterReset.talks.search_agent.from, oldFrom, "同じ会話位置でも旧送信のキーを再利用しない");
      const transcriptsAfterReset = structuredClone(f.store.transcripts);
      const savesAfterReset = f.store.savedAppends.length;

      for (const fields of [
        { message: oldReply.label, display: oldReply.text, quickReplySeq: oldControl.lastMessageSeq },
        { message: "リセット前に送った通常入力" }
      ]) {
        const stale = await f.call("POST /api/talk/send", { talkId: f.search.publicId, turnKey: oldControl.turnKey, ...fields });
        assert.equal(stale.stale, true);
        assert.deepEqual(searchControl(stale.playerState), newControl);
        assert.deepEqual(searchDeltas(stale.playerState), []);
        assert.deepEqual(await f.stored(), storedAfterReset, "旧送信は候補の消費も会話の進行も起こさない");
        assert.deepEqual(f.store.transcripts, transcriptsAfterReset);
        assert.equal(f.store.savedAppends.length, savesAfterReset);
      }

      const selected = await f.call("POST /api/talk/send", {
        talkId: f.search.publicId, turnKey: newControl.turnKey,
        message: newReply.label, display: newReply.text, quickReplySeq: newControl.lastMessageSeq
      });
      assert.equal(selected.stale, undefined);
      assert.equal((await f.stored()).talks.search_agent.quickRepliesClosedSeq, newControl.lastMessageSeq);
      assert.equal(searchDeltas(selected.playerState).flatMap(delta => delta.messages).some(message => message.sender === "owner"), false);

      const ordinary = await f.call("POST /api/talk/send", {
        talkId: f.search.publicId, turnKey: searchControl(selected.playerState).turnKey, message: "新しい通常入力"
      });
      assert.equal(ordinary.stale, undefined);
      assert.equal(searchDeltas(ordinary.playerState).flatMap(delta => delta.messages)[0].body, "新しい通常入力");
    });
  }

  for (const appendAfterReset of [false, true]) {
    test(`${mode}: 開始hookのreset${appendAfterReset ? "後の発話・検索" : "だけ"}は初期履歴を引き継がない`, async () => {
      const f = fixture(mode, [{ event: "session_started", handler: "reset" }], {
        reset(context) {
          context.talk.resetHistory("search_agent");
          if (appendAfterReset) {
            context.talk.addBlock("search_agent", "after", { mode: "stay" });
            context.talk.search("search_agent", "古いメモ");
          }
        }
      });
      const state = (await f.call("POST /api/session/start", { serialCode: "1234" })).playerState;
      await assertFinalHistory(f, state, appendAfterReset ? [bodies.after] : [], appendAfterReset ? ["message", "search_results"] : []);
      assert.equal(searchControl(state).inputVisible, true);
      assert.equal(searchControl(state).inputEnabled, true);
    });
  }

  test(`${mode}: 修復hookと開封hookをまたぐresetは途中の鍵の追記も破棄する`, async () => {
    const order = [];
    const f = fixture(mode, [
      { event: "content_repaired", target: "old_note", handler: "repair" },
      { event: "content_opened", target: "old_note", handler: "open" }
    ], {
      repair(context) {
        order.push("repair");
        context.talk.addBlock("search_agent", "before", { mode: "stay" });
        context.talk.resetHistory("search_agent");
        context.talk.addBlock("search_agent", "middle", { mode: "stay" });
      },
      open(context) {
        order.push("open");
        context.talk.resetHistory("search_agent");
        context.talk.addBlock("search_agent", "after", { mode: "stay" });
      }
    });
    const started = (await f.call("POST /api/session/start", { serialCode: "1234" })).playerState;
    const initialKey = searchControl(started).transcriptKey;
    await f.call("POST /api/talk/send", { talkId: f.search.publicId, turnKey: searchControl(started).turnKey, message: "古いメモ" });
    const content = f.runtime.workerScenario.contents.find(item => item.id === "old_note");
    const state = (await f.call("POST /api/content/opened", { appId: "notes", contentId: content.publicId })).playerState;
    assert.deepEqual(order, ["repair", "open"]);
    assert.notEqual(searchControl(state).transcriptKey, initialKey);
    await assertFinalHistory(f, state, [bodies.after]);
    if (mode === "server") {
      const oldTranscript = await f.store.loadTranscript(f.store.player.id, streamId, initialKey);
      assert.deepEqual(oldTranscript.messages, [], "同じstreamの保存を新しい鍵で置換し、旧鍵からは読まない");
    }
  });

  test(`${mode}: 会話完了hookのresetは同じturnの入力・検索結果を応答と保存から外す`, async () => {
    const f = fixture(mode, [{ event: "talk_turn_completed", target: "search_agent", handler: "reset" }], {
      reset(context) {
        context.talk.resetHistory("search_agent");
        context.talk.addBlock("search_agent", "after", { mode: "stay" });
      }
    });
    const started = (await f.call("POST /api/session/start", { serialCode: "1234" })).playerState;
    const state = (await f.call("POST /api/talk/send", {
      talkId: f.search.publicId, turnKey: searchControl(started).turnKey, message: "古いメモ"
    })).playerState;
    assert.notEqual(searchControl(state).transcriptKey, searchControl(started).transcriptKey);
    await assertFinalHistory(f, state, [bodies.after]);
  });
}
