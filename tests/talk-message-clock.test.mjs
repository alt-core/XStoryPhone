import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredState } from "../src/server/store.ts";
import { createInitialPlayerState, publicPlayerState, reconcileScenarioState, workerScenario } from "../src/worker/scenario.ts";
import { scenarioHookHandlers } from "../src/generated/scenarioHooks.generated.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";
import { latestTalkDeliveredAt, nextTalkMessageSentAt } from "../src/worker/talkMessageClock.ts";

test("talkの次時刻は既存水位を越え、実時計の逆行でも戻らない", () => {
  const at = "2026-09-05T01:00:00.000Z";
  assert.equal(nextTalkMessageSentAt("", at), at);
  assert.equal(nextTalkMessageSentAt(at, at), "2026-09-05T01:00:00.001Z");
  assert.equal(nextTalkMessageSentAt(at, "2026-09-04T01:00:00.000Z"), "2026-09-05T01:00:00.001Z");
  assert.equal(nextTalkMessageSentAt(at, "2026-09-05T02:00:00.000Z"), "2026-09-05T02:00:00.000Z");
});

test("talkの水位は空blockのeventと展開messageの双方を含む", () => {
  const event = { delivered_at: "2026-09-05T01:00:00.000Z" };
  assert.equal(latestTalkDeliveredAt("", [event], []), event.delivered_at);
  assert.equal(latestTalkDeliveredAt("", [event], [{ sentAt: "2026-09-05T01:00:02.000Z" }]), "2026-09-05T01:00:02.000Z");
  assert.equal(latestTalkDeliveredAt("2026-09-05T01:00:03.000Z", [event], []), "2026-09-05T01:00:03.000Z");
});

test("StoredTalkStateの水位はnormalizeで保持し、旧値と不正値だけ未設定にする", async () => {
  const state = (await reconcileScenarioState(createInitialPlayerState(), "clock-normalize")).state;
  state.talks.guide.lastDeliveredAt = "2026-09-05T10:00:00+09:00";
  assert.equal(normalizeStoredState(state).talks.guide.lastDeliveredAt, "2026-09-05T01:00:00.000Z");
  delete state.talks.guide.lastDeliveredAt;
  assert.equal(normalizeStoredState(state).talks.guide.lastDeliveredAt, "");
  state.talks.guide.lastDeliveredAt = "不正な時刻";
  assert.equal(normalizeStoredState(state).talks.guide.lastDeliveredAt, "");
});

test("空blockとrepeat blockのhookも別requestへ展開末尾の水位を渡す", async (t) => {
  const at = Date.parse("2026-09-05T01:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: at });
  const state = (await reconcileScenarioState(createInitialPlayerState(), "clock-hooks")).state;
  const emptyBlock = workerScenario.talkBlocks.find((block) => block.id === "guide::message_test_ack");
  const repeatBlock = workerScenario.talkBlocks.find((block) => block.id === workerScenario.repeatTalkBlocks["guide::message_reply"][0]);
  const originalEmptyMessages = emptyBlock.messages;
  const originalRepeatMessages = repeatBlock.messages;
  emptyBlock.messages = [];
  repeatBlock.messages = [originalRepeatMessages[0], { ...originalRepeatMessages[0], body: "repeatの二件目" }];
  state.talks.guide.blockDisplayCounts["guide::message_reply"] = 1;
  const hooks = [
    { event: "test_clock_empty", target: "", handler: "test_clock_empty", cond: "", llm: false },
    { event: "test_clock_repeat", target: "", handler: "test_clock_repeat", cond: "", llm: false },
    { event: "test_clock_after_repeat", target: "", handler: "test_clock_after_repeat", cond: "", llm: false }
  ];
  workerScenario.hooks.push(...hooks);
  scenarioHookHandlers.test_clock_empty = (context) => context.talk.addBlock("guide", "message_test_ack", { mode: "stay" });
  scenarioHookHandlers.test_clock_repeat = (context) => context.talk.addBlock("guide", "message_reply", { mode: "stay" });
  scenarioHookHandlers.test_clock_after_repeat = (context) => context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
  try {
    const empty = await runScenarioHooks(state, { eventId: "test_clock_empty" }, { playerId: "clock-hooks" });
    assert.equal(empty.state.talks.guide.lastMessageSeq, state.talks.guide.lastMessageSeq);
    assert.equal(empty.state.talks.guide.lastDeliveredAt, new Date(at).toISOString());
    const repeat = await runScenarioHooks(empty.state, { eventId: "test_clock_repeat" }, { playerId: "clock-hooks" });
    assert.equal(repeat.transcriptAppends[0].resolvedMessages[0].sentAt, new Date(at + 1).toISOString());
    assert.equal(repeat.state.talks.guide.lastDeliveredAt, new Date(at + 1_001).toISOString());
    const next = await runScenarioHooks(repeat.state, { eventId: "test_clock_after_repeat" }, { playerId: "clock-hooks" });
    assert.equal(next.transcriptAppends[0].messages[0].delivered_at, new Date(at + 1_002).toISOString());
  } finally {
    emptyBlock.messages = originalEmptyMessages;
    repeatBlock.messages = originalRepeatMessages;
    for (const hook of hooks) {
      workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
      delete scenarioHookHandlers[hook.handler];
    }
  }
});

test("両保存モードの公開stateは着信中だけwakeを止め、完了後に戻す", async () => {
  const originalMode = workerScenario.playerMode;
  const wakeAt = "2026-09-05T01:00:00.000Z";
  try {
    for (const mode of ["server", "browser"]) {
      workerScenario.playerMode = mode;
      const state = createInitialPlayerState();
      state.incomingCallId = "demo_call";
      assert.equal((await publicPlayerState(state, 1, [], wakeAt)).nextScenarioWakeAt, null);
      state.completedIncomingCallIds.push("demo_call");
      assert.equal((await publicPlayerState(state, 2, [], wakeAt)).nextScenarioWakeAt, wakeAt);
    }
  } finally {
    workerScenario.playerMode = originalMode;
  }
});
