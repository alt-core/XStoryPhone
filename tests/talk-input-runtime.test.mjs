import assert from "node:assert/strict";
import test from "node:test";
import { SEARCH_AGENT_STREAM_ID, SEARCH_AGENT_TALK_ID } from "../src/shared/searchAgent.ts";
import { scenarioHookHandlers } from "../src/generated/scenarioHooks.generated.ts";
import {
  createInitialPlayerState,
  materializedTalkMessagesForEvents,
  messagesForTalkBlocks,
  messagesForTalkOutputSteps,
  reconcileScenarioState,
  searchAgentTimelineForOutputs,
  talkCanPost,
  workerScenario
} from "../src/worker/scenario.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";

function guideTalk() {
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  assert.ok(talk && talk.kind === "sms");
  return talk;
}

test("通常talkの/inputはcompact block eventを変えず表示境界と受理状態だけを更新する", () => {
  const talk = guideTalk();
  const rendered = messagesForTalkOutputSteps({
    talk,
    steps: [
      { kind: "input", action: "hide" },
      { kind: "block", blockId: "guide::message_reply" },
      { kind: "input", action: "show" },
      { kind: "input", action: "disable" }
    ],
    previousCounts: {},
    formatEnv: {},
    baseSentAt: "2026-08-30T10:00:00.000Z",
    idPrefix: "test_block",
    startSeq: 7,
    inputVisible: true,
    inputVisibleAfterSeq: 0,
    inputEnabled: true,
    inputEnabledAfterSeq: 0
  });
  assert.deepEqual(rendered.events.map((event) => event.event_type), ["message_block"]);
  assert.equal(rendered.events[0]?.block_id, "guide::message_reply");
  assert.equal(rendered.inputVisible, true);
  assert.equal(rendered.inputVisibleAfterSeq, rendered.lastMessageSeq);
  assert.equal(rendered.inputEnabled, false);
  assert.equal(rendered.inputEnabledAfterSeq, 0);
});

test("showとenableは既に有効なら遅延境界を動かさない", () => {
  const talk = guideTalk();
  const rendered = messagesForTalkOutputSteps({
    talk,
    steps: [
      { kind: "block", blockId: "guide::message_reply" },
      { kind: "input", action: "show" },
      { kind: "input", action: "enable" }
    ],
    previousCounts: {},
    formatEnv: {},
    baseSentAt: "2026-08-30T10:00:00.000Z",
    idPrefix: "test_idempotent_input",
    startSeq: 7,
    inputVisible: true,
    inputVisibleAfterSeq: 3,
    inputEnabled: true,
    inputEnabledAfterSeq: 4
  });
  assert.equal(rendered.inputVisibleAfterSeq, 3);
  assert.equal(rendered.inputEnabledAfterSeq, 4);
});

test("search agentの/inputはtranscript seqを消費しない", () => {
  const rendered = searchAgentTimelineForOutputs({
    outputs: [
      { kind: "input", action: "hide" },
      { kind: "block", blockId: "search_agent::intro" },
      { kind: "input", action: "show" },
      { kind: "input", action: "disable" }
    ],
    previousCounts: {},
    formatEnv: {},
    startSeq: 0,
    inputVisible: true,
    inputVisibleAfterSeq: 0,
    inputEnabled: true,
    inputEnabledAfterSeq: 0,
    baseSentAt: "2026-08-30T10:00:00.000Z",
    idPrefix: "test_search"
  });
  assert.ok(rendered.events.length > 0);
  assert.equal(rendered.events.every((event) => event.event_type === "message_block"), true);
  assert.deepEqual(rendered.events.map((event) => event.seq), rendered.events.map((_event, index) => index + 1));
  assert.equal(rendered.lastSeq, rendered.events.length);
  assert.equal(rendered.inputVisible, true);
  assert.equal(rendered.inputVisibleAfterSeq, rendered.lastSeq);
  assert.equal(rendered.inputEnabled, false);
});

test("Quick Replyはblock IDと利用したtemplate値だけから復元する", () => {
  const talk = guideTalk();
  const block = workerScenario.talkBlocks.find((item) => item.id === "guide::message_reply");
  const message = block?.messages.at(-1);
  assert.ok(block && message);
  const previous = message.quickReplies;
  message.quickReplies = [" {{test_reply}} ", "{{test_reply}}", "   ", "あとで"];
  try {
    const rendered = messagesForTalkBlocks({
      talk,
      blockIds: [block.id],
      previousCounts: {},
      formatEnv: { test_reply: "はい" },
      baseSentAt: "2026-08-30T10:00:00.000Z",
      idPrefix: "test_quick_reply"
    });
    assert.deepEqual(rendered.messages.at(-1)?.quickReplies, ["はい", "あとで"]);
    assert.equal("quickReplies" in rendered.events[0], false);
    assert.deepEqual(JSON.parse(rendered.events[0]?.format_env_json ?? "{}"), { test_reply: "はい" });
    assert.deepEqual(
      materializedTalkMessagesForEvents(talk, rendered.events).at(-1)?.quickReplies,
      ["はい", "あとで"],
      "compact eventから履歴を再読込してもQuick Replyを復元する"
    );
  } finally {
    message.quickReplies = previous;
  }
});

test("hookの入力操作はeffect順を守りfromとturnKeyを変更しない", async () => {
  const initialized = await reconcileScenarioState(createInitialPlayerState(), "talk-input-hook-player");
  const before = initialized.state.talks.guide;
  const hook = { event: "test_talk_input_hook", target: "", handler: "test_talk_input_hook", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_talk_input_hook = (context) => {
    context.talk.hideInput("guide");
    context.talk.addBlock("guide", "message_reply", { mode: "stay" });
    context.talk.showInput("guide");
    context.talk.disableInput("guide");
  };
  try {
    const result = await runScenarioHooks(initialized.state, { eventId: hook.event }, { playerId: "talk-input-hook-player" });
    const after = result.state.talks.guide;
    assert.equal(after.from, before.from);
    assert.equal(after.turnKey, before.turnKey);
    assert.equal(after.inputVisible, true);
    assert.equal(after.inputVisibleAfterSeq, after.lastMessageSeq);
    assert.equal(after.inputEnabled, false);
    assert.equal(talkCanPost(guideTalk(), result.state), false);
    assert.equal(result.transcriptAppends.some((append) => append.streamId === SEARCH_AGENT_STREAM_ID), false);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_talk_input_hook;
  }
});

test("hookのenableは最新message境界で再開し、検索talkにも同じ契約を使う", async () => {
  const initialized = await reconcileScenarioState(createInitialPlayerState(), "talk-input-enable-player");
  initialized.state.talks[SEARCH_AGENT_TALK_ID].inputEnabled = false;
  const hook = { event: "test_talk_input_enable", target: "", handler: "test_talk_input_enable", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_talk_input_enable = (context) => context.talk.enableInput(SEARCH_AGENT_TALK_ID);
  try {
    const result = await runScenarioHooks(initialized.state, { eventId: hook.event }, { playerId: "talk-input-enable-player" });
    const talk = result.state.talks[SEARCH_AGENT_TALK_ID];
    assert.equal(talk.inputEnabled, true);
    assert.equal(talk.inputEnabledAfterSeq, talk.lastMessageSeq);
    assert.equal(result.transcriptAppends.length, 0);
    assert.equal(talkCanPost(workerScenario.talks.find((item) => item.id === SEARCH_AGENT_TALK_ID), result.state), true);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_talk_input_enable;
  }
});
