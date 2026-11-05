import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { workerScenario } from "../src/generated/workerScenario.generated.ts";
import { decodeBrowserProgress, encodeBrowserProgress } from "../src/server/browserProgress.ts";
import { SEARCH_AGENT_STREAM_ID, SEARCH_AGENT_TALK_ID } from "../src/shared/searchAgent.ts";
import { createScenarioRuntime } from "../src/worker/scenarioRuntime.ts";
import { createScenarioHooksRuntime } from "../src/worker/services/scenarioHooksRuntime.ts";

const playerId = "search-reset-player";
const eventId = "test_search_reset_history";
let storageModuleSerial = 0;

function fixture(handler) {
  const scenario = structuredClone(workerScenario);
  scenario.playerMode = "browser";
  scenario.hooks = [{ event: eventId, target: "", cond: "", handler: eventId, needsAi: false }];
  const runtime = createScenarioRuntime(scenario);
  const hooks = createScenarioHooksRuntime(runtime, { [eventId]: handler }, scenario.hookTalkBlocks);
  const blocks = scenario.talkBlocks.filter((block) => block.talkId === SEARCH_AGENT_TALK_ID
    && !block.repeatOf && !block.unavailable && block.messages.length);
  assert.ok(blocks.length >= 2);
  return {
    runtime,
    blocks,
    async initial() {
      return runtime.reconcileScenarioState(runtime.createInitialPlayerState(), playerId);
    },
    run(state) {
      return hooks.runScenarioHooks(state, { eventId }, { playerId });
    }
  };
}

function searchAppends(result) {
  return result.transcriptAppends.filter((append) => append.streamId === SEARCH_AGENT_STREAM_ID);
}

test("resetHistory後のaddBlockとsearchは新しい履歴のseq 1から始まり、前の追記を捨てる", async () => {
  const current = fixture((context) => {
    context.talk.addBlock(SEARCH_AGENT_TALK_ID, current.blocks[0].blockKey, { mode: "stay" });
    context.talk.search(SEARCH_AGENT_TALK_ID, "リセット前の検索");
    context.talk.resetHistory(SEARCH_AGENT_TALK_ID);
    context.talk.addBlock(SEARCH_AGENT_TALK_ID, current.blocks[1].blockKey, { mode: "stay" });
    context.talk.search(SEARCH_AGENT_TALK_ID, "リセット後の検索");
  });
  const initial = (await current.initial()).state;
  const before = structuredClone(initial.talks[SEARCH_AGENT_TALK_ID]);
  const result = await current.run(initial);
  const after = result.state.talks[SEARCH_AGENT_TALK_ID];
  const appends = searchAppends(result);

  assert.notEqual(after.transcriptKey, before.transcriptKey);
  assert.equal(appends.length, 1);
  assert.equal(appends[0].transcriptKey, after.transcriptKey);
  assert.deepEqual(appends[0].messages.map((message) => message.seq),
    Array.from({ length: current.blocks[1].messages.length + 1 }, (_, index) => index + 1));
  assert.ok(appends[0].messages.slice(0, -1).every((message) => message.base_block_id === current.blocks[1].id));
  assert.equal(appends[0].messages.at(-1).query, "リセット後の検索");
  assert.equal(after.lastMessageSeq, appends[0].messages.length);
  assert.equal(after.from, before.from);
  assert.notEqual(after.turnKey, before.turnKey);
  assert.deepEqual(initial.talks[SEARCH_AGENT_TALK_ID], before, "入力stateは変更しない");
});

test("resetHistoryだけを呼ぶと会話の位置と入力設定を保ち、入力の適用境界を0へ戻す", async () => {
  for (const inputVisible of [false, true]) {
    for (const inputEnabled of [false, true]) {
      const current = fixture((context) => context.talk.resetHistory(SEARCH_AGENT_TALK_ID));
      const initial = (await current.initial()).state;
      Object.assign(initial.talks[SEARCH_AGENT_TALK_ID], {
        from: current.blocks[1].id,
        turnKey: "reset前の進行位置",
        lastMessageSeq: 13,
        inputVisible,
        inputVisibleAfterSeq: 11,
        inputEnabled,
        inputEnabledAfterSeq: 12,
        quickRepliesClosedSeq: 13
      });
      const before = initial.talks[SEARCH_AGENT_TALK_ID];
      const result = await current.run(initial);
      const after = result.state.talks[SEARCH_AGENT_TALK_ID];

      assert.notEqual(after.transcriptKey, before.transcriptKey);
      assert.equal(after.lastMessageSeq, 0);
      assert.equal(after.from, before.from);
      assert.notEqual(after.turnKey, before.turnKey);
      assert.equal(after.inputVisible, inputVisible);
      assert.equal(after.inputEnabled, inputEnabled);
      assert.equal(after.inputVisibleAfterSeq, 0);
      assert.equal(after.inputEnabledAfterSeq, 0);
      assert.equal(after.quickRepliesClosedSeq, undefined);
      assert.deepEqual(searchAppends(result), []);
      for (const [talkId, talk] of Object.entries(initial.talks)) {
        if (talkId !== SEARCH_AGENT_TALK_ID) assert.deepEqual(result.state.talks[talkId], talk);
      }
    }
  }
});

test("未初期化の検索AIをresetHistoryすると初期発話も残らない", async () => {
  const current = fixture((context) => context.talk.resetHistory(SEARCH_AGENT_TALK_ID));
  const initial = current.runtime.createInitialPlayerState();
  assert.equal(initial.talks[SEARCH_AGENT_TALK_ID], undefined);
  const result = await current.run(initial);
  const after = result.state.talks[SEARCH_AGENT_TALK_ID];

  assert.ok(after.transcriptKey);
  assert.equal(after.lastMessageSeq, 0);
  assert.deepEqual(searchAppends(result), []);
});

test("同じhook内で複数回resetHistoryすると最後のreset以降だけを保存する", async () => {
  const current = fixture((context) => {
    context.talk.search(SEARCH_AGENT_TALK_ID, "最初の検索");
    context.talk.resetHistory(SEARCH_AGENT_TALK_ID);
    context.talk.addBlock(SEARCH_AGENT_TALK_ID, current.blocks[0].blockKey, { mode: "stay" });
    context.talk.resetHistory(SEARCH_AGENT_TALK_ID);
    context.talk.search(SEARCH_AGENT_TALK_ID, "最後の検索");
  });
  const initial = (await current.initial()).state;
  const first = await current.run(initial);
  const second = await current.run(first.state);

  assert.notEqual(first.state.talks[SEARCH_AGENT_TALK_ID].transcriptKey,
    second.state.talks[SEARCH_AGENT_TALK_ID].transcriptKey);
  assert.notEqual(first.state.talks[SEARCH_AGENT_TALK_ID].turnKey, initial.talks[SEARCH_AGENT_TALK_ID].turnKey);
  assert.notEqual(second.state.talks[SEARCH_AGENT_TALK_ID].turnKey, first.state.talks[SEARCH_AGENT_TALK_ID].turnKey);
  for (const result of [first, second]) {
    const appends = searchAppends(result);
    assert.equal(appends.length, 1);
    assert.equal(appends[0].messages.length, 1);
    assert.equal(appends[0].messages[0].seq, 1);
    assert.equal(appends[0].messages[0].query, "最後の検索");
  }
  assert.notEqual(searchAppends(first)[0].messages[0].id, searchAppends(second)[0].messages[0].id);
});

test("resetHistoryはメッセージ・チャットと未定義の会話を受け付けない", async () => {
  const targets = [
    workerScenario.talks.find((talk) => talk.kind === "sms")?.id,
    workerScenario.talks.find((talk) => talk.kind === "chat")?.id,
    "unknown_talk"
  ];
  assert.ok(targets.every(Boolean));
  for (const talkId of targets) {
    const current = fixture((context) => context.talk.resetHistory(talkId));
    await assert.rejects(() => current.run(current.runtime.createInitialPlayerState()), /resetHistory/u);
  }
});

test("resetHistoryを呼ばないhookは検索AIの履歴と入力状態を変更しない", async () => {
  const current = fixture(() => {});
  const initial = (await current.initial()).state;
  const result = await current.run(initial);
  assert.deepEqual(result.state, initial);
  assert.deepEqual(result.transcriptAppends, []);
});

for (const appendAfterReset of [false, true]) {
  test(`resetHistory後${appendAfterReset ? "の新しい発話だけが" : "の空の会話が"}保存と再読込で維持される`, async () => {
    const previousIndexedDb = globalThis.indexedDB;
    globalThis.indexedDB = new IDBFactory();
    try {
      const current = fixture((context) => {
        context.talk.resetHistory(SEARCH_AGENT_TALK_ID);
        if (appendAfterReset) context.talk.search(SEARCH_AGENT_TALK_ID, "新しい段階の検索");
      });
      const initialized = await current.initial();
      const projectId = `search-reset-${appendAfterReset}`;
      const response = async (state, version, appends) => ({
        ...await current.runtime.publicPlayerState(state, version, [], null, appends),
        progressToken: await encodeBrowserProgress("reset-test-secret", projectId, { id: playerId, state, stateVersion: version })
      });
      const firstResponse = await response(initialized.state, 1, initialized.transcriptAppends);
      const options = { enabled: true, projectId, clientRevision: firstResponse.clientRevision, storage: { mode: "persistent", prefix: "" } };
      const freshStorage = () => import(`../src/client/system/browserPlayerStorage.ts?search-reset-history=${++storageModuleSerial}`);
      const firstStorage = await freshStorage();
      await firstStorage.initializeBrowserPlayerStorage(options);
      await firstStorage.commitBrowserPlayerResponse(null, firstResponse, { replaceStreams: true });
      const previousMessages = firstStorage.loadCachedBrowserPlayerState().searchAgentMessages;
      assert.ok(previousMessages.length > 0);

      const result = await current.run(initialized.state);
      const nextResponse = await response(result.state, 2, result.transcriptAppends);
      await firstStorage.commitBrowserPlayerResponse(firstResponse.progressToken, nextResponse);
      const reloadedStorage = await freshStorage();
      await reloadedStorage.initializeBrowserPlayerStorage(options);
      const restored = reloadedStorage.loadCachedBrowserPlayerState();
      const searchTalk = restored.talks.find((talk) => talk.kind === "search_agent");

      assert.equal(searchTalk.transcriptKey, result.state.talks[SEARCH_AGENT_TALK_ID].transcriptKey);
      assert.equal(restored.searchAgentMessages.length, appendAfterReset ? 1 : 0);
      assert.ok(restored.searchAgentMessages.every((message) => !previousMessages.some((previous) => previous.id === message.id)));
      if (appendAfterReset) {
        assert.equal(restored.searchAgentMessages[0].seq, 1);
        assert.equal(restored.searchAgentMessages[0].kind, "search_results");
      }
      const token = await reloadedStorage.prepareBrowserPlayerRequest();
      const saved = await decodeBrowserProgress("reset-test-secret", projectId, token);
      assert.ok(saved);
      const reconciled = await current.runtime.reconcileScenarioState(saved.state, saved.id);
      assert.equal(reconciled.state.talks[SEARCH_AGENT_TALK_ID].transcriptKey, searchTalk.transcriptKey);
      assert.equal(reconciled.state.talks[SEARCH_AGENT_TALK_ID].lastMessageSeq, appendAfterReset ? 1 : 0);
      assert.deepEqual(reconciled.transcriptAppends, []);
    } finally {
      globalThis.indexedDB = previousIndexedDb;
    }
  });
}
