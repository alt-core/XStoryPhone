import assert from "node:assert/strict";
import test from "node:test";
import { createInitialPlayerState, reconcileScenarioState, scenarioMessageBlockId, workerScenario } from "../src/worker/scenario.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";
import { scenarioHookHandlers } from "../src/generated/scenarioHooks.generated.ts";

test("hookの同じsnapshot再評価は時刻が違っても同じevent IDを生成する", async (t) => {
  const at = Date.parse("2026-09-05T01:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: at });
  const playerId = "hook-id-snapshot";
  const state = (await reconcileScenarioState(createInitialPlayerState(), playerId)).state;
  const hook = { event: "test_stable_hook_id", target: "", handler: "test_stable_hook_id", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers[hook.handler] = (context) => context.talk.addBlock("guide", "message_reply", { mode: "stay" });
  try {
    const first = await runScenarioHooks(state, { eventId: hook.event }, { playerId });
    t.mock.timers.setTime(at + 600);
    const rechecked = await runScenarioHooks(state, { eventId: hook.event }, { playerId });
    const continued = await runScenarioHooks(first.state, { eventId: hook.event }, { playerId });
    const baseId = await scenarioMessageBlockId(playerId, "sms", "guide", "guide::message_reply");
    assert.equal(first.transcriptAppends[0].messages[0].id, `${baseId}:1`);
    assert.equal(rechecked.transcriptAppends[0].messages[0].id, `${baseId}:1`);
    assert.equal(continued.transcriptAppends[0].messages[0].id, `${baseId}:2`);
    assert.notEqual(first.transcriptAppends[0].messages[0].delivered_at, rechecked.transcriptAppends[0].messages[0].delivered_at);
    assert.equal(state.talks.guide.blockDisplayCounts["guide::message_reply"], undefined, "元snapshotの回数は変更しない");
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers[hook.handler];
  }
});

test("空blockの同commit追加もmessage seqに頼らず異なるevent IDを生成する", async () => {
  const playerId = "hook-id-empty";
  const state = (await reconcileScenarioState(createInitialPlayerState(), playerId)).state;
  const block = workerScenario.talkBlocks.find((item) => item.id === "guide::message_test_ack");
  const savedMessages = block.messages;
  const hook = { event: "test_empty_hook_id", target: "", handler: "test_empty_hook_id", cond: "", llm: false };
  block.messages = [];
  workerScenario.hooks.push(hook);
  scenarioHookHandlers[hook.handler] = (context) => {
    context.talk.addBlock("guide", "message_test_ack", { mode: "stay" });
    context.talk.addBlock("guide", "message_test_ack", { mode: "stay" });
  };
  try {
    const result = await runScenarioHooks(state, { eventId: hook.event }, { playerId });
    const events = result.transcriptAppends[0].messages;
    const baseId = await scenarioMessageBlockId(playerId, "sms", "guide", block.id);
    assert.deepEqual(events.map((event) => event.id), [`${baseId}:1`, `${baseId}:2`]);
    assert.equal(result.state.talks.guide.lastMessageSeq, state.talks.guide.lastMessageSeq);
    assert.equal(result.state.talks.guide.blockDisplayCounts[block.id], 2);
  } finally {
    block.messages = savedMessages;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers[hook.handler];
  }
});
