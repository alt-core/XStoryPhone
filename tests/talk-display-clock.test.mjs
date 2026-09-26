import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { captureTalkDisplayTime, TALK_DISPLAY_TIME_KEY, talkEventFormatEnv } from "../src/worker/talkDisplayClock.ts";
import { talkDisplayTimeLabel } from "../src/shared/talkDisplayTime.ts";
import { createScenarioRuntime } from "../src/worker/scenarioRuntime.ts";
import { createScenarioHooksRuntime } from "../src/worker/services/scenarioHooksRuntime.ts";
import { workerScenario } from "../src/generated/workerScenario.generated.ts";
import { talkMessageDisplayTime, talkMessageTimeLabel } from "../src/client/apps/talkMessageTime.ts";

const env = { os_date: "2027-12-31", os_time_label: "23:59:59" };

test("作中時計は自動で進めず、応答や次のリクエストも作者が指定した日時を捕捉する", () => {
  const input = { ...env };
  const first = captureTalkDisplayTime("scenario", input);
  assert.deepEqual(first, { date: "2027-12-31", time: "23:59:59" });
  for (let i = 0; i < 65; i++) assert.deepEqual(captureTalkDisplayTime("scenario", input), first);
  assert.equal(talkDisplayTimeLabel(first), "12/31 23:59");
  input.os_date = "2028-01-01";
  assert.equal(talkDisplayTimeLabel(captureTalkDisplayTime("scenario", input)), "1/1 23:59");
  assert.equal(first.date, "2027-12-31", "時計変更が過去の発言へ波及しない");
  assert.equal(captureTalkDisplayTime("real", {}), undefined);
});

test("作中日時は端末の時差へ変換せず、自由な時刻ラベルも保持する", () => {
  assert.equal(talkDisplayTimeLabel({ date: "2028-02-29", time: "23:59:59" }), "2/29 23:59");
  assert.equal(talkDisplayTimeLabel({ date: "2027-05-01", time: "夕方" }), "5/1 夕方");
  const moduleUrl = new URL("../src/shared/talkDisplayTime.ts", import.meta.url).href;
  for (const TZ of ["Asia/Tokyo", "America/Los_Angeles"]) {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `import { talkDisplayTimeLabel } from ${JSON.stringify(moduleUrl)}; console.log(talkDisplayTimeLabel({date:"2027-03-14",time:"23:59:59"}));`], {
      env: { ...process.env, TZ }, encoding: "utf8"
    });
    assert.equal(result.trim(), "3/14 23:59");
  }
  assert.equal(talkDisplayTimeLabel({ date: "不正", time: "20:00" }), undefined);
});

test("表示時計だけをcompact eventへ保存し、template・実時刻・即時展開と復元を保つ", () => {
  const scenario = structuredClone(workerScenario);
  scenario.project.talkClock = "scenario";
  const block = scenario.talkBlocks.find(item => item.id === "guide::message_reply");
  block.messages = [
    { ...block.messages[0], body: "{{os_time_label}}の返信1" },
    { ...block.messages[0], body: "返信2" }
  ];
  const runtime = createScenarioRuntime(scenario);
  const talk = scenario.talks.find(item => item.id === "guide");
  const baseSentAt = "2026-09-23T01:00:00.000Z";
  const reply = runtime.messagesForTalkBlocks({
    talk, blockIds: [block.id, block.id], previousCounts: {}, useRepeat: false,
    formatEnv: { ...env, private_future: "保存しない本文" }, baseSentAt, idPrefix: "display-clock"
  });
  assert.equal(reply.events[0].body, null);
  assert.deepEqual(JSON.parse(reply.events[0].format_env_json), {
    os_time_label: "23:59:59", [TALK_DISPLAY_TIME_KEY]: { date: env.os_date, time: env.os_time_label }
  });
  assert.deepEqual(JSON.parse(reply.events[1].format_env_json)[TALK_DISPLAY_TIME_KEY], { date: env.os_date, time: env.os_time_label });
  assert.equal(reply.events[0].delivered_at, baseSentAt);
  assert.equal(reply.events[1].delivered_at, "2026-09-23T01:00:01.000Z", "作中の表示時計にかかわらずeventの記録時刻は1秒刻みで進める");
  assert.ok(reply.messages.every(item => item.displayTime === "12/31 23:59"));
  const restored = reply.events.flatMap(event => runtime.talkEvents.resolveSingleTalkEvent(event, block.id));
  assert.deepEqual(restored.map(item => [item.id, item.sentAt, item.displayTime, item.body]), reply.messages.map(item => [item.id, item.sentAt, item.displayTime, item.body]));
  const owner = {
    id: "owner", kind: "sms", talk_id: talk.id, event_type: "player_message", body: "送信本文", block_id: null,
    format_env_json: talkEventFormatEnv(undefined, { date: env.os_date, time: env.os_time_label }), delivered_at: baseSentAt
  };
  const resolved = runtime.talkEvents.resolveSingleTalkEvent(owner)[0];
  assert.equal(resolved.displayTime, "12/31 23:59");
  assert.equal(resolved.sentAt, baseSentAt);
  assert.equal(talkMessageDisplayTime(resolved), "12/31 23:59");
  assert.equal(talkMessageDisplayTime({ sentAt: baseSentAt }), talkMessageTimeLabel(baseSentAt));
  const extracted = runtime.messagesForTalkBlocks({
    talk, blockIds: [block.id], previousCounts: {}, formatEnv: { ...env, os_time_label: "抽出された別の文字列" },
    displayStateValues: env, baseSentAt, idPrefix: "extraction-clock"
  });
  assert.equal(extracted.messages[0].body, "抽出された別の文字列の返信1", "templateの名前解決は変えない");
  assert.equal(extracted.messages[0].displayTime, "12/31 23:59", "抽出値を作中時計の状態変数と混同しない");
  block.messages = Array.from({ length: 65 }, () => block.messages[0]);
  const longReply = runtime.messagesForTalkBlocks({
    talk, blockIds: [block.id], previousCounts: {}, formatEnv: env, baseSentAt, idPrefix: "long-reply"
  });
  assert.equal(longReply.messages.length, 65);
  assert.ok(longReply.messages.every(item => item.displayTime === "12/31 23:59"), "長い返信でも作者の時計を進めない");
  scenario.project.talkClock = "real";
  assert.equal(runtime.talkEvents.resolveSingleTalkEvent(owner)[0].displayTime, "12/31 23:59", "取得時の設定や時計で過去発言を書き換えない");
});

test("hookのaddBlockはその行までの作中時計を捕捉し、再取得時の時計で置き換えない", async () => {
  const scenario = structuredClone(workerScenario);
  scenario.project.talkClock = "scenario";
  scenario.hooks = [{ event: "clock_test", target: "", cond: "", handler: "clock_test", llm: false }];
  const runtime = createScenarioRuntime(scenario);
  const hooks = createScenarioHooksRuntime(runtime, {
    clock_test(context) {
      context.talk.addBlock("guide", "message_reply", { mode: "stay" });
      context.state.set("os_date", "2027-02-01");
      context.state.set("os_time_label", "8:05");
      context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
    }
  }, scenario.hookTalkBlocks);
  const initial = (await runtime.reconcileScenarioState(runtime.createInitialPlayerState(), "clock-hooks")).state;
  initial.stateValues.os_date = env.os_date;
  initial.stateValues.os_time_label = env.os_time_label;
  const result = await hooks.runScenarioHooks(initial, { eventId: "clock_test" }, { playerId: "clock-hooks" });
  const append = result.transcriptAppends.find(item => item.streamId === "talk:guide");
  assert.equal(append.resolvedMessages[0].displayTime, "12/31 23:59");
  assert.equal(append.resolvedMessages.at(-1).displayTime, "2/1 08:05");
  const state = structuredClone(result.state);
  state.stateValues.os_date = "2029-01-01";
  const restored = runtime.visibleTalkMessagesForState(scenario.talks.find(item => item.id === "guide"), state, append.messages);
  assert.equal(restored.find(item => item.id === append.resolvedMessages[0].id).displayTime, "12/31 23:59");
});

test("チャットは作中時刻を復元し、時刻欄のない検索ナビには表示日時を追加しない", () => {
  const scenario = structuredClone(workerScenario);
  scenario.project.talkClock = "scenario";
  const runtime = createScenarioRuntime(scenario);
  const chat = scenario.talks.find(item => item.kind === "chat");
  const chatBlock = scenario.talkBlocks.find(item => item.talkId === chat.id && item.messages.length && !item.repeatOf);
  const response = runtime.messagesForTalkBlocks({
    talk: chat, blockIds: [chatBlock.id], previousCounts: {}, formatEnv: { ...scenario.stateVariables, ...env },
    baseSentAt: "2026-09-23T01:00:00.000Z", idPrefix: "chat-clock"
  });
  assert.equal(response.messages[0].displayTime, "12/31 23:59");
  assert.equal(runtime.talkEvents.resolveTalkEvents(response.events)[0].displayTime, "12/31 23:59");
  const owner = runtime.talkEvents.searchAgentPlayerMessageEvent({
    id: "search-owner", seq: 1, body: "検索", deliveredAt: "2026-09-23T01:00:00.000Z"
  });
  const searchBlock = scenario.talkBlocks.find(item => item.talkId === "search_agent" && item.messages.length && !item.repeatOf);
  const reply = runtime.searchAgentTimelineForOutputs({
    outputs: [{ kind: "block", blockId: searchBlock.id }, { kind: "search", query: "検索", results: [] }],
    previousCounts: {}, formatEnv: { ...scenario.stateVariables, ...env },
    startSeq: 1, inputVisible: true, inputVisibleAfterSeq: 0, inputEnabled: true, inputEnabledAfterSeq: 0,
    baseSentAt: "2026-09-23T01:00:01.000Z", idPrefix: "search-clock"
  });
  const publicMessages = runtime.publicSearchAgentTimelineItems([owner, ...reply.events], "search-public");
  assert.ok(publicMessages.every(item => !("displayTime" in item)));
  assert.equal(owner.format_env_json, undefined);
  assert.equal(publicMessages.at(-1).kind, "search_results");
});
