import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { loadScenarioAuthoring } from "../scripts/lib/scenario-authoring.mjs";
import { readScenarioFixture } from "./helpers/authoring-fixture.mjs";
import { clientRevisionFor, transcriptRevisionFor } from "../scripts/lib/scenario-revisions.mjs";
import { parseRegexCriteria, resolveTalkRule } from "../src/shared/conversation.ts";
import { formatStoryDateCompact, formatStoryDateLabel, parseStoryDate, storyWeekFor } from "../src/shared/storyDate.ts";
import { semanticInputForTalkCommand, talkCommandAvailable } from "../src/worker/services/talkCommand.ts";
import { APP_REGISTRY, isAppId, isProjectAppId } from "../src/shared/appRegistry.ts";
import { SEARCH_AGENT_STREAM_ID, SEARCH_AGENT_TALK_ID } from "../src/shared/searchAgent.ts";
import {
  albumPhotoIdsForMediaAttachment,
  createInitialPlayerState,
  initializeSearchAgentTalkState,
  initializeTalkState,
  appAvailable,
  notificationIdsForTarget,
  observedAlbumMediaContentIds,
  openTargetExists,
  playerStateRevision,
  publicPlayerState,
  publicTalkMessage,
  radioAudioCueForEvent,
  reconcileScenarioState,
  repairTarget,
  resolveTalkAttachment,
  restoredTalkHistoryMessages,
  revealTalkMessages,
  searchScenario,
  talkCanPost,
  workerScenario
} from "../src/worker/scenario.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";
import { scenarioHookHandlers } from "../src/generated/scenarioHooks.generated.ts";

test("デモシナリオは検索アプリを作らず、修復対象を保持する", () => {
  const scenario = loadAndValidateScenario();
  assert.equal(scenario.worker.project.lockScreen.method, "none");
  assert.equal(scenario.projectConstants["device.lock_method"], "none");
  assert.equal(scenario.projectConstants["device.lock_pin_length"], 0);
  assert.equal("pin" in scenario.projectConstants, false);
  assert.equal(scenario.worker.apps.some((app) => app.id === "search"), false);
  assert.equal(scenario.worker.apps.find((app) => app.id === "chat")?.initialState, "repairable");
  assert.equal(scenario.worker.apps.find((app) => app.id === "browser")?.initialState, "normal");
  assert.equal(scenario.worker.apps.find((app) => app.id === "mail")?.initialState, "normal");
  assert.equal(scenario.worker.contents.find((content) => content.id === "old_note")?.initialState, "repairable");
  assert.equal(scenario.worker.contents.find((content) => content.id === "rainy_window")?.initialState, "repairable");
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "content_repaired" && hook.target === "old_note"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "content_repaired" && hook.target === "rainy_window"));
  assert.equal(scenario.deviceState.apps.some((app) => app.initialState === "hidden"), false);
  assert.equal(scenario.deviceState.apps.some((app) => app.id === "chat"), false);
  assert.equal(scenario.worker.apps.find((app) => app.id === "chat")?.cond, "sealed_note_unlocked");
  for (const audio of scenario.worker.generatedAudio.filter((item) => item.provider === "static")) {
    assert.equal(audio.staticUrl, `/api/generated-audio/static/${audio.publicId}.wav`, "固定WAVは拡張子から再生形式を判定できるURLを生成する");
  }
});

test("アプリregistryはシナリオ検証とクライアントの共通ID一覧になる", () => {
  const scenario = loadAndValidateScenario();
  assert.deepEqual(
    scenario.worker.apps.map((app) => app.id).sort(),
    APP_REGISTRY.map((app) => app.id).sort()
  );
});

test("project appはmanifest 1エントリから公開投影・検索・修復を利用できる", async () => {
  assert.equal(isProjectAppId("case_files"), true);
  assert.equal(isAppId("case_files"), true);
  assert.equal(APP_REGISTRY.some((app) => app.id === "case_files"), false);
  const app = {
    id: "case_files", label: "事件資料", icon: "project:case_files", accent: "#777777",
    initialState: "normal", search: [], cond: "", badgeCond: ""
  };
  const normal = {
    id: "case_normal", publicId: "case-public-normal", appId: "case_files", initialState: "normal",
    search: ["事件資料"], cond: "", record: { title: "到達済み", body: "公開本文", private: "投影しない" }
  };
  const repairable = {
    id: "case_repair", publicId: "case-public-repair", appId: "case_files", initialState: "repairable",
    repairLabel: "破損資料", search: ["破損資料"], cond: "", record: { title: "修復後", body: "修復本文" }
  };
  workerScenario.apps.push(app);
  workerScenario.contents.push(normal, repairable);
  workerScenario.publicIds.content.case_normal = normal.publicId;
  workerScenario.publicIds.content.case_repair = repairable.publicId;
  try {
    const state = createInitialPlayerState();
    const before = await publicPlayerState(state, 1);
    const items = before.visibleDeviceState.projectApps.case_files;
    assert.equal(items.find((item) => item.contentId === normal.publicId)?.body, "公開本文");
    assert.equal("private" in items.find((item) => item.contentId === normal.publicId), false);
    const broken = items.find((item) => item.contentId === repairable.publicId);
    assert.equal(broken?.corrupted, true);
    assert.equal("body" in broken, false);
    assert.equal(searchScenario("破損資料", state)[0]?.contentId, repairable.publicId);
    state.repairedContentIds.push(repairable.id);
    const after = await publicPlayerState(state, 2);
    assert.equal(after.visibleDeviceState.projectApps.case_files.find((item) => item.contentId === repairable.publicId)?.body, "修復本文");
  } finally {
    workerScenario.apps.splice(workerScenario.apps.indexOf(app), 1);
    workerScenario.contents.splice(workerScenario.contents.indexOf(normal), 1);
    workerScenario.contents.splice(workerScenario.contents.indexOf(repairable), 1);
    delete workerScenario.publicIds.content.case_normal;
    delete workerScenario.publicIds.content.case_repair;
  }
});

test("badgeCondは状態条件を満たす時だけホーム用バッジを公開する", async () => {
  const notes = workerScenario.apps.find((app) => app.id === "notes");
  assert.ok(notes);
  const original = notes.badgeCond;
  notes.badgeCond = "old_note_opened";
  try {
    const state = createInitialPlayerState();
    assert.equal((await publicPlayerState(state, 1)).visibleDeviceState.apps.find((app) => app.id === "notes")?.badge, undefined);
    state.stateValues.old_note_opened = true;
    assert.equal((await publicPlayerState(state, 2)).visibleDeviceState.apps.find((app) => app.id === "notes")?.badge, true);
  } finally {
    notes.badgeCond = original;
  }
});

test("LLM無効のデモは正規表現またはdefaultだけで会話を完結できる", () => {
  const scenario = loadAndValidateScenario();
  assert.equal(scenario.worker.features.llm, false);
  for (const talk of scenario.worker.talks) {
    for (const rule of talk.rules) {
      assert.ok(rule.isDefault || rule.criteria.startsWith("/"));
    }
  }
});

test("検索AIのヒント入力は旧検索と同じく部分一致する", async () => {
  const talk = workerScenario.talks.find((item) => item.kind === "search_agent");
  assert.ok(talk);
  const result = await resolveTalkRule({
    rules: talk.rules,
    from: talk.initialFrom,
    playerInput: "ヒントをください",
    stateValues: workerScenario.stateVariables
  });
  assert.equal(result.ok && result.rule.intent, "最初のヒント");
  assert.equal(result.ok && result.source, "regex");
});

test("機能テスト用キーワードはどの会話地点からでも正規表現で選択できる", async () => {
  for (const [talkId, input, intent] of [
    ["search_agent", "着信テスト", "機能テスト"],
    ["guide", "別ルームへ送る", "メッセージ機能テスト"],
    ["lobby", "チャット連携", "機能テスト"]
  ]) {
    const talk = workerScenario.talks.find((item) => item.id === talkId);
    assert.ok(talk);
    const result = await resolveTalkRule({
      rules: talk.rules,
      from: talk.initialFrom,
      playerInput: input,
      stateValues: workerScenario.stateVariables
    });
    assert.equal(result.ok && result.rule.intent, intent);
    assert.equal(result.ok && result.source, "regex");
  }

  const guide = workerScenario.talks.find((item) => item.id === "guide");
  assert.ok(guide);
  const unauthenticatedChat = await resolveTalkRule({
    rules: guide.rules,
    from: guide.initialFrom,
    playerInput: "チャットへ送る",
    stateValues: workerScenario.stateVariables
  });
  assert.equal(unauthenticatedChat.ok && unauthenticatedChat.rule.intent, "チャット未認証");
  assert.equal(unauthenticatedChat.ok && unauthenticatedChat.rule.mode, "stay");
  assert.equal(unauthenticatedChat.ok && unauthenticatedChat.rule.nextBlocks[0], "guide::chat_auth_required");
});

test("デモの全Quick Replyは有効ruleへ進み、ヒント後も選択操作で復帰できる", async () => {
  const searchTalk = workerScenario.talks.find((talk) => talk.id === "search_agent");
  const guideTalk = workerScenario.talks.find((talk) => talk.id === "guide");
  const lobbyTalk = workerScenario.talks.find((talk) => talk.id === "lobby");
  assert.ok(searchTalk && guideTalk && lobbyTalk);

  const statePatterns = [
    {},
    { old_note_opened: true },
    { old_note_opened: true, rainy_window_opened: true },
    { old_note_opened: true, rainy_window_opened: true, image_color_reported: true },
    { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true },
    { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true },
    { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true },
    { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true, demo_completed: true }
  ].map((values) => ({ ...workerScenario.stateVariables, ...values }));

  const searchReplies = workerScenario.talkBlocks
    .filter((block) => block.talkId === "search_agent")
    .flatMap((block) => block.messages.flatMap((message) => message.quickReplies ?? []));
  for (const reply of new Set(searchReplies)) {
    const selections = await Promise.all(statePatterns.map((stateValues) => resolveTalkRule({
      rules: searchTalk.rules,
      from: searchTalk.initialFrom,
      playerInput: reply,
      stateValues
    })));
    assert.ok(selections.some((selection) => selection.ok && selection.rule.mode === "stay"), `search_agent Quick Replyが行き止まりです: ${reply}`);
  }
  for (const [reply, stateValues, expectedIntent, expectedSource] of [
    ["ヘルプ", workerScenario.stateVariables, "ヘルプ", "regex"],
    ["ヒント", workerScenario.stateVariables, "最初のヒント", "regex"],
    ["機能テスト", workerScenario.stateVariables, "機能テスト一覧", "regex"],
    ["着信テスト", workerScenario.stateVariables, "機能テスト", "regex"],
    ["古いメモ", workerScenario.stateVariables, "", "default"],
    ["青", { ...workerScenario.stateVariables, old_note_opened: true }, "灯りの色を報告", "regex"],
    ["黄色", { ...workerScenario.stateVariables, old_note_opened: true }, "灯りの色を報告", "regex"]
  ]) {
    const selected = await resolveTalkRule({
      rules: searchTalk.rules,
      from: searchTalk.initialFrom,
      playerInput: reply,
      stateValues
    });
    assert.equal(selected.ok && selected.rule.intent, expectedIntent, `search_agentの選択ruleが不正です: ${reply}`);
    assert.equal(selected.ok && selected.source, expectedSource, `search_agentの選択sourceが不正です: ${reply}`);
  }
  const beforeOldNote = await resolveTalkRule({
    rules: searchTalk.rules,
    from: searchTalk.initialFrom,
    playerInput: "黄色",
    stateValues: workerScenario.stateVariables
  });
  assert.equal(beforeOldNote.ok && beforeOldNote.source, "default");

  const guideReplies = workerScenario.talkBlocks
    .filter((block) => block.talkId === "guide")
    .flatMap((block) => block.messages.flatMap((message) => message.quickReplies ?? []));
  for (const reply of new Set(guideReplies)) {
    const selected = await resolveTalkRule({
      rules: guideTalk.rules,
      from: guideTalk.initialFrom,
      playerInput: reply,
      stateValues: workerScenario.stateVariables
    });
    assert.equal(selected.ok && selected.rule.mode, "stay", `guide Quick Replyが行き止まりです: ${reply}`);
  }
  const guideTestSelection = await resolveTalkRule({
    rules: guideTalk.rules,
    from: guideTalk.initialFrom,
    playerInput: "別ルームへ送る",
    stateValues: workerScenario.stateVariables
  });
  assert.equal(guideTestSelection.ok && guideTestSelection.rule.intent, "メッセージ機能テスト");

  const greeting = workerScenario.talkBlocks.find((block) => block.id === "lobby::start")?.messages.at(-1)?.quickReplies?.[0];
  assert.ok(greeting);
  const greetingSelection = await resolveTalkRule({
    rules: lobbyTalk.rules,
    from: lobbyTalk.initialFrom,
    playerInput: greeting,
    stateValues: { ...workerScenario.stateVariables, sealed_note_unlocked: true, chat_auth_verified: true }
  });
  assert.equal(greetingSelection.ok && greetingSelection.rule.nextFromId, "lobby::lobby_reply");
  for (const reply of ["チャット連携", "メッセージへ送る"]) {
    const selected = await resolveTalkRule({
      rules: lobbyTalk.rules,
      from: "lobby::lobby_reply",
      playerInput: reply,
      stateValues: { ...workerScenario.stateVariables, sealed_note_unlocked: true, chat_auth_verified: true }
    });
    assert.equal(selected.ok && selected.rule.mode, "stay", `lobby Quick Replyが行き止まりです: ${reply}`);
  }

  for (const block of workerScenario.talkBlocks.filter((item) => item.talkId === "search_agent" && item.blockKey.startsWith("hint_"))) {
    const replies = block.messages.at(-1)?.quickReplies ?? [];
    assert.ok(replies.includes("機能テスト"), `${block.id}から機能メニューへ戻れません`);
    assert.ok(replies.includes("ヘルプ"), `${block.id}からヘルプへ戻れません`);
  }
});

test("デモの各案内は実際の進行状態で次の操作と復帰メニューを表示する", async () => {
  const talk = workerScenario.talks.find((item) => item.id === "search_agent");
  assert.ok(talk);
  const cases = [
    ["intro", {}, ["古いメモ", "ヒント", "機能テスト", "ヘルプ"]],
    ["common_help", {}, ["ヒント", "機能テスト"]],
    ["stage_photo", { old_note_opened: true }, ["雨", "ヒント", "機能テスト", "ヘルプ"]],
    ["stage_report", { old_note_opened: true, rainy_window_opened: true }, ["ヒント", "機能テスト", "ヘルプ"]],
    ["color_reported", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true }, ["デモ連絡先", "ヒント", "機能テスト", "ヘルプ"]],
    ["stage_chat", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true }, ["チャット", "ヒント", "機能テスト", "ヘルプ"]],
    ["stage_auth", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true }, ["デモ連絡先", "ヒント", "機能テスト", "ヘルプ"]],
    ["stage_contact", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true }, ["サンプルルーム", "ヒント", "機能テスト", "ヘルプ"]],
    ["stage_done", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true, demo_completed: true }, ["機能テスト", "ヘルプ"]],
    ["call_completed", { demo_call_completed: true }, ["書き起こし", "ヒント", "機能テスト", "ヘルプ"]],
    ["hint_first", {}, ["古いメモ", "機能テスト", "ヘルプ"]],
    ["hint_photo", { old_note_opened: true }, ["雨", "機能テスト", "ヘルプ"]],
    ["hint_report", { old_note_opened: true, rainy_window_opened: true }, ["機能テスト", "ヘルプ"]],
    ["hint_unlock", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true }, ["デモ連絡先", "機能テスト", "ヘルプ"]],
    ["hint_chat", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true }, ["チャット", "機能テスト", "ヘルプ"]],
    ["hint_auth", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true }, ["デモ連絡先", "機能テスト", "ヘルプ"]],
    ["hint_contact", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true }, ["サンプルルーム", "機能テスト", "ヘルプ"]],
    ["hint_done", { old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true, demo_completed: true }, ["機能テスト", "ヘルプ"]],
    ["test_menu", {}, ["デモ連絡先", "着信テスト", "遅延メッセージ", "画像受信テスト", "ノイズ演出", "フラッシュ演出", "暗転演出", "ゲームオーバー演出", "オールクリア演出", "ヒント", "ヘルプ"]],
    ["found", {}, ["ヒント", "機能テスト", "ヘルプ"]],
    ["not_found", {}, ["ヒント", "機能テスト", "ヘルプ"]],
    ["demo_test_ack", {}, ["機能テスト", "ヒント", "ヘルプ"]],
    ["demo_test_already_done", {}, ["機能テスト", "ヒント", "ヘルプ"]]
  ];

  for (const [blockKey, values, expectedReplies] of cases) {
    const block = workerScenario.talkBlocks.find((item) => item.id === `search_agent::${blockKey}`);
    const replies = block?.messages.at(-1)?.quickReplies ?? [];
    assert.deepEqual(replies, expectedReplies, `${blockKey}のQuick Replyが不正です`);
    for (const reply of replies) {
      const selected = await resolveTalkRule({
        rules: talk.rules,
        from: talk.initialFrom,
        playerInput: reply,
        stateValues: { ...workerScenario.stateVariables, ...values }
      });
      assert.equal(selected.ok && selected.rule.mode, "stay", `${blockKey}の「${reply}」が行き止まりです`);
      if (selected.ok && selected.source === "default") {
        const state = createInitialPlayerState();
        Object.assign(state.stateValues, values);
        assert.ok(searchScenario(reply, state).length > 0, `${blockKey}の「${reply}」に検索結果がありません`);
      }
    }
  }

  for (const [values, expectedIntent] of [
    [{}, "最初のヒント"],
    [{ old_note_opened: true }, "写真のヒント"],
    [{ old_note_opened: true, rainy_window_opened: true }, "報告のヒント"],
    [{ old_note_opened: true, rainy_window_opened: true, image_color_reported: true }, "添付解錠のヒント"],
    [{ old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true }, "チャットのヒント"],
    [{ old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true }, "再認証のヒント"],
    [{ old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true }, "チャット投稿のヒント"],
    [{ old_note_opened: true, rainy_window_opened: true, image_color_reported: true, sealed_note_unlocked: true, chat_auth_link_sent: true, chat_auth_verified: true, demo_completed: true }, "完了後のヒント"]
  ]) {
    const selected = await resolveTalkRule({
      rules: talk.rules,
      from: talk.initialFrom,
      playerInput: "ヒント",
      stateValues: { ...workerScenario.stateVariables, ...values }
    });
    assert.equal(selected.ok && selected.rule.intent, expectedIntent);
  }
});

test("デモhookが追加する全blockは存在し、advance後だけ返信可能な位置を要求する", () => {
  const hookSource = Object.values(loadScenarioAuthoring("scenario/demo").hookScripts).join("\n");
  const targets = [...hookSource.matchAll(/context\.talk\.addBlock\("([^"]+)", "([^"]+)"(?:, \{ mode: "(stay|advance)" \})?\)/gu)]
    .map((match) => ({ talkId: match[1], blockKey: match[2], mode: match[3] ?? "advance" }));
  assert.ok(targets.length > 0);
  assert.equal(targets.length, [...hookSource.matchAll(/context\.talk\.addBlock\(/gu)].length, "全addBlock呼出しを監査対象にする");

  for (const { talkId, blockKey, mode } of targets) {
    const talk = workerScenario.talks.find((item) => item.id === talkId);
    const block = workerScenario.talkBlocks.find((item) => item.talkId === talkId && item.blockKey === blockKey);
    assert.ok(talk && block, `${talkId}/${blockKey} が見つかりません`);
    if (mode === "stay") continue;
    assert.ok(
      talk.rules.some((rule) => rule.from === block.id && rule.isDefault),
      `${talkId}/${blockKey} の追加後に返信不能になります`
    );
  }
});

test("hookのaddBlock型はtalkとblockの組合せを取り違えられない", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-hook-types-"));
  try {
    fs.copyFileSync("src/shared/hooks.ts", path.join(temporaryRoot, "hooks.ts"));
    fs.writeFileSync(path.join(temporaryRoot, "type-test.ts"), `
import type { ScenarioHookContext } from "./hooks.ts";
type Context = ScenarioHookContext<
  Record<string, string | number | boolean>,
  string,
  string,
  string,
  "guide" | "other" | "empty",
  { guide: "guide_block"; other: "other_block"; empty: never }
>;
declare const context: Context;
context.talk.addBlock("guide", "guide_block");
context.talk.addBlock("other", "other_block");
context.talk.search("search_agent", "古いメモ");
context.talk.showInput("guide");
context.talk.hideInput("other");
context.talk.enableInput("guide");
context.talk.disableInput("empty");
context.effect.flash({ fadeInMs: 30, holdMs: 40, fadeOutMs: 270, intensity: 0.9, color: "#fffaf2" });
context.effect.blackout({ fadeInMs: 220, holdMs: 180, fadeOutMs: 300, intensity: 1 });
// 旧numeric形式は廃止しています。
// @ts-expect-error
context.effect.flash(300);
// 検索能力は固定search_agent talkだけに限定します。
// @ts-expect-error
context.talk.search("guide", "古いメモ");
// 別talkのblock指定は型エラーになる契約です。
// @ts-expect-error
context.talk.addBlock("guide", "other_block");
// hook-safe blockがないtalkはaddBlockできません。
// @ts-expect-error
context.talk.addBlock("empty", "anything");
// 未定義talkの入力状態は操作できません。
// @ts-expect-error
context.talk.disableInput("unknown");
`);
    const compiler = path.resolve("node_modules/typescript/bin/tsc");
    const result = spawnSync(process.execPath, [
      compiler,
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--moduleResolution", "bundler",
      "--module", "esnext",
      "--target", "es2022",
      "--allowImportingTsExtensions",
      "type-test.ts"
    ], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("デモtalk flowの通常遷移先は返信可能な位置を持つ", () => {
  for (const talk of workerScenario.talks) {
    for (const rule of talk.rules.filter((item) => item.mode !== "stay" && item.mode !== "game_over")) {
      const nextFrom = rule.nextFromId;
      assert.ok(nextFrom, `${talk.id}/${rule.id} の遷移先がありません`);
      assert.ok(
        talk.rules.some((candidate) => candidate.from === nextFrom && candidate.isDefault),
        `${talk.id}/${rule.id} の遷移先 ${nextFrom} で返信不能になります`
      );
    }
  }
});

test("生成ナビアトラスは検索ナビ用の8列9行の配置を持つ", () => {
  const source = fs.readFileSync("public/search-agent/search-agent-spritesheet.svg", "utf8");
  assert.match(source, /viewBox="0 0 1536 1872"/u);
  assert.equal((source.match(/<ellipse /gu) ?? []).length, 10);
});

test("会話ブロックは複数発話・添付・遅延・出典を保持する", () => {
  const scenario = loadAndValidateScenario();
  const talk = scenario.worker.talks.find((item) => item.id === "search_agent");
  const foundRule = talk?.rules.find((rule) => rule.intent === "灯りの色を報告");
  assert.deepEqual(foundRule?.nextBlocks, ["search_agent::color_reported"]);
  assert.equal(foundRule?.cond, "old_note_opened && !image_color_reported");
  assert.deepEqual(foundRule?.set, ["image_color_reported=true", "clue_attachments_pending=true"]);
  const colorCriteria = parseRegexCriteria(foundRule?.criteria ?? "");
  assert.equal(colorCriteria.kind, "ready");
  if (colorCriteria.kind === "ready") {
    assert.equal(colorCriteria.regex.test("青です"), true);
    colorCriteria.regex.lastIndex = 0;
    assert.equal(colorCriteria.regex.test("水色に見えます"), true);
    colorCriteria.regex.lastIndex = 0;
    assert.equal(colorCriteria.regex.test("黄色です"), true);
    colorCriteria.regex.lastIndex = 0;
    assert.equal(colorCriteria.regex.test("見つけた"), false);
  }
  const messages = scenario.worker.talkBlocks.find((block) => block.id === "guide::clue_attachments")?.messages ?? [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.attachmentId, "rainy_window_image");
  assert.equal(messages[0]?.delayMs, 700);
  assert.equal(messages[0]?.source, "human");
  assert.equal(messages[0]?.updatedAt, "2026-08-12");
  assert.equal(messages[1]?.attachmentId, "sealed_note_file");
  assert.equal(messages[1]?.segments?.some((segment) => segment.kind === "link" && segment.contentId === "welcome_note"), true);
  assert.equal(scenario.deviceState.notes.some((note) => note.title === "鍵付きメモ"), false);
  assert.equal(JSON.stringify(scenario.deviceState).includes("unlockCode"), false);
  assert.equal(scenario.worker.contents.find((content) => content.id === "sealed_note")?.record.unlockCode, undefined);
  assert.deepEqual(
    scenario.worker.lockedContentPasswords.find((item) => item.contentId === "sealed_note")?.answers,
    ["0420"]
  );
  assert.equal(scenario.worker.contents.some((content) => content.id === "orange_mark"), false);
  const photoDescription = scenario.worker.photoDescriptions.rainy_window;
  assert.match(photoDescription, /青い灯り/u);
  assert.equal(JSON.stringify(scenario.deviceState).includes(photoDescription), false);
  assert.match(semanticInputForTalkCommand("photo:rainy_window"), /青い灯り/u);
});

test("会話正規表現は最初の終端slashを使う", () => {
  assert.equal(parseRegexCriteria("/a/b/i").kind, "invalid");

  const escapedSlash = parseRegexCriteria(String.raw`/a\/b/i`);
  assert.equal(escapedSlash.kind, "ready");
  if (escapedSlash.kind === "ready") assert.equal(escapedSlash.regex.test("A/B"), true);

  const classSlash = parseRegexCriteria("/[/]/u");
  assert.equal(classSlash.kind, "ready");
  if (classSlash.kind === "ready") assert.equal(classSlash.regex.test("/"), true);
});

test("talk初期履歴は連続する未修復blockを一つの破損領域にまとめ、修復時だけ本文を公開する", async () => {
  const initialized = await reconcileScenarioState(createInitialPlayerState(), "player-history-repair");
  const guide = workerScenario.talks.find((talk) => talk.id === "guide");
  assert.ok(guide);
  assert.equal(initialized.transcriptAppends.some((delta) => delta.streamId === "talk:guide"), false);

  const initialPublic = await publicPlayerState(initialized.state, 1, [], null, initialized.transcriptAppends);
  const publicGuide = initialPublic.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId);
  assert.deepEqual(publicGuide?.messages.map((message) => message.seq), [4]);
  assert.doesNotMatch(JSON.stringify(publicGuide), /修復対象になる過去のメッセージ履歴/u);
  assert.deepEqual(publicGuide?.brokenHistoryRanges, [{ beforeSeq: 4 }]);
  assert.equal(initialPublic.talks.find((talk) => talk.talkId === guide.publicId)?.historyRevision, 0);
  assert.equal(initialPublic.talks.find((talk) => talk.talkId === guide.publicId)?.lastMessageSeq, 4);

  const searchResults = searchScenario("消えた連絡記録", initialized.state);
  assert.equal(searchResults.length, 1);
  const searchResult = searchResults[0];
  assert.equal(searchResult?.targetKind, "talk_history");
  assert.equal(searchResult?.targetTalkId, guide.publicId);
  assert.equal(searchResult?.title, "破損した履歴");

  const repaired = structuredClone(initialized.state);
  repaired.repairedContentIds.push("guide_history_archive_a");
  const restored = restoredTalkHistoryMessages(repaired, "guide_history_archive_a");
  assert.deepEqual(restored?.messages.map((message) => message.seq), [1, 2]);
  assert.equal(restored?.messages.some((message) => message.delayOnFirstDisplay), false);
  const restoredPublicMessages = restored?.messages.map(publicTalkMessage) ?? [];
  assert.ok(restoredPublicMessages.every((message) => message.historyRepairId === workerScenario.publicIds.content.guide_history_archive_a));
  assert.ok(restoredPublicMessages.every((message) => !("scenarioBlockId" in message)));

  const partiallyRepairedPublic = await publicPlayerState(repaired, 2);
  const partiallyRepairedGuide = partiallyRepairedPublic.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId);
  assert.deepEqual(partiallyRepairedGuide?.messages.map((message) => message.seq), [1, 2, 4]);
  assert.deepEqual(partiallyRepairedGuide?.brokenHistoryRanges, [{ beforeSeq: 4 }]);
  assert.equal(partiallyRepairedPublic.talks.find((talk) => talk.talkId === guide.publicId)?.historyRevision, 1);

  repaired.repairedContentIds.push("guide_history_archive_b");
  const fullyRepairedPublic = await publicPlayerState(repaired, 3);
  const fullyRepairedGuide = fullyRepairedPublic.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId);
  assert.equal(fullyRepairedGuide?.brokenHistoryRanges, undefined);
  assert.equal(fullyRepairedPublic.talks.find((talk) => talk.talkId === guide.publicId)?.historyRevision, 2);
});

test("talk単位のrepairableとhiddenを検索から一括修復する", async () => {
  const repairableTalk = workerScenario.talks.find((talk) => talk.id === "sms_receiver");
  const hiddenTalk = workerScenario.talks.find((talk) => talk.id === "dummy_sms_1");
  const unavailableParentTalk = workerScenario.talks.find((talk) => talk.id === "dummy_chat_1");
  assert.ok(repairableTalk);
  assert.ok(hiddenTalk);
  assert.ok(unavailableParentTalk);
  const repairableOriginal = {
    initialState: repairableTalk.initialState,
    repairLabel: repairableTalk.repairLabel,
    search: repairableTalk.search,
    avatarUrl: repairableTalk.avatarUrl
  };
  const hiddenOriginal = {
    initialState: hiddenTalk.initialState,
    repairLabel: hiddenTalk.repairLabel,
    search: hiddenTalk.search
  };
  const unavailableParentOriginal = {
    initialState: unavailableParentTalk.initialState,
    repairLabel: unavailableParentTalk.repairLabel,
    search: unavailableParentTalk.search
  };
  Object.assign(repairableTalk, {
    initialState: "repairable",
    repairLabel: "受▚▐▀箱",
    search: ["修復対象ルーム"],
    avatarUrl: "/demo/avatars/repairable.svg"
  });
  Object.assign(hiddenTalk, {
    initialState: "hidden",
    search: ["隠しルーム"]
  });
  Object.assign(unavailableParentTalk, {
    initialState: "repairable",
    repairLabel: "未▚▐▀室",
    search: ["親アプリ未修復ルーム"]
  });
  try {
    const initial = await reconcileScenarioState(createInitialPlayerState(), "player-talk-repair");
    assert.equal(initial.state.talks[repairableTalk.id], undefined);
    assert.equal(initial.state.talks[hiddenTalk.id], undefined);
    const initialPublic = await publicPlayerState(initial.state, 1);
    const placeholder = initialPublic.visibleDeviceState.messages.find((thread) => thread.id === repairableTalk.publicId);
    assert.equal(placeholder?.contactName, "受▚▐▀箱");
    assert.equal(placeholder?.corrupted, true);
    assert.deepEqual(placeholder?.messages, []);
    assert.equal("avatarUrl" in (placeholder ?? {}), false);
    assert.equal(initialPublic.visibleDeviceState.messages.some((thread) => thread.id === hiddenTalk.publicId), false);
    assert.equal(initialPublic.talks.some((talk) => talk.talkId === repairableTalk.publicId), false);

    repairableTalk.repairLabel = undefined;
    const fallbackPlaceholder = (await publicPlayerState(initial.state, 1)).visibleDeviceState.messages
      .find((thread) => thread.id === repairableTalk.publicId);
    assert.equal(fallbackPlaceholder?.contactName, "SMS");
    assert.equal(JSON.stringify(fallbackPlaceholder).includes(repairableTalk.label), false);
    repairableTalk.repairLabel = "受▚▐▀箱";

    const repairableResult = searchScenario("修復対象ルーム", initial.state)
      .find((result) => result.contentId === repairableTalk.publicId);
    assert.equal(repairableResult?.contentId, repairableTalk.publicId);
    assert.equal(repairableResult?.title, repairableTalk.label);
    assert.equal(repairableResult?.repairable, true);
    const hiddenResult = searchScenario("隠しルーム", initial.state)
      .find((result) => result.contentId === hiddenTalk.publicId);
    assert.equal(hiddenResult?.repairable, true);
    assert.equal(searchScenario("talkにない検索語", initial.state).some((result) => (
      workerScenario.talks.some((talk) => talk.publicId === result.contentId)
    )), false);
    const unavailableParentState = structuredClone(initial.state);
    unavailableParentState.stateValues.sealed_note_unlocked = true;
    const unavailableParentResult = searchScenario("親アプリ未修復ルーム", unavailableParentState)
      .find((result) => result.contentId === unavailableParentTalk.publicId);
    assert.equal(unavailableParentResult?.repairable, true);
    assert.equal(openTargetExists(unavailableParentTalk.publicId, "chat", unavailableParentState), false);
    unavailableParentState.repairedAppIds.push("chat");
    const chatPlaceholder = (await publicPlayerState(unavailableParentState, 1)).visibleDeviceState.chatThreads
      .find((thread) => thread.id === unavailableParentTalk.publicId);
    assert.equal(chatPlaceholder?.roomName, "未▚▐▀室");
    assert.equal(chatPlaceholder?.corrupted, true);
    assert.deepEqual(chatPlaceholder?.messages, []);
    assert.equal(openTargetExists(unavailableParentTalk.publicId, "chat", unavailableParentState), true);
    assert.deepEqual(repairTarget(repairableTalk.publicId, "messages"), {
      kind: "talk",
      internalId: repairableTalk.id,
      appId: "messages"
    });
    assert.equal(openTargetExists(repairableTalk.publicId, "messages", initial.state), true);

    const repairHook = { event: "repair_talk_test", target: "", handler: "repair_talk_test", cond: "", llm: false };
    workerScenario.hooks.push(repairHook);
    scenarioHookHandlers.repair_talk_test = (context) => context.content.setState(repairableTalk.id, "repaired");
    try {
      const hookResult = await runScenarioHooks(initial.state, { eventId: "repair_talk_test" });
      assert.equal(hookResult.state.repairedContentIds.includes(repairableTalk.id), true);
    } finally {
      workerScenario.hooks.pop();
      delete scenarioHookHandlers.repair_talk_test;
    }

    const repairedState = structuredClone(initial.state);
    repairedState.repairedContentIds.push(repairableTalk.id, hiddenTalk.id);
    const repaired = await reconcileScenarioState(repairedState, "player-talk-repair");
    assert.ok(repaired.state.talks[repairableTalk.id]);
    assert.ok(repaired.state.talks[hiddenTalk.id]);
    const repairedPublic = await publicPlayerState(repaired.state, 2);
    const repairedThread = repairedPublic.visibleDeviceState.messages.find((thread) => thread.id === repairableTalk.publicId);
    assert.equal(repairedThread?.contactName, repairableTalk.label);
    assert.ok(repairedThread?.messages.length);
    assert.equal(repairedThread?.avatarUrl, "/demo/avatars/repairable.svg");
    assert.equal(repairedPublic.visibleDeviceState.messages.some((thread) => thread.id === hiddenTalk.publicId), true);
    assert.equal(repairedPublic.talks.some((talk) => talk.talkId === repairableTalk.publicId), true);
    assert.equal(repairedPublic.contentStates.some((item) => (
      item.contentId === repairableTalk.publicId && item.appId === "messages" && item.state === "repaired"
    )), true);
  } finally {
    Object.assign(repairableTalk, repairableOriginal);
    Object.assign(hiddenTalk, hiddenOriginal);
    Object.assign(unavailableParentTalk, unavailableParentOriginal);
  }
});

test("現在のscenarioにないcontent IDは公開状態へ返さない", async () => {
  const content = workerScenario.contents.find((item) => item.id === "old_note");
  assert.ok(content);
  const state = createInitialPlayerState();
  state.repairedContentIds.push(content.id, "removed_private_content_id");
  state.unlockedContentIds.push("removed_private_talk_id");
  const publicState = await publicPlayerState(state, 1);
  assert.equal(publicState.contentStates.some((item) => item.contentId === content.publicId), true);
  assert.equal(publicState.contentStates.some((item) => item.contentId === "removed_private_content_id"), false);
  assert.equal(publicState.contentStates.some((item) => item.contentId === "removed_private_talk_id"), false);
});

test("talk初期履歴の復元位置は初期化時のスナップショットに固定する", async () => {
  const initialized = await reconcileScenarioState(createInitialPlayerState(), "player-history-layout");
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  assert.ok(talk);
  const originalStartBlocks = talk.startBlocks;
  talk.startBlocks = [...talk.startBlocks].reverse();
  try {
    const restored = restoredTalkHistoryMessages(initialized.state, "guide_history_archive_a");
    assert.equal(restored?.ok, true);
    assert.deepEqual(restored?.messages.map((message) => message.seq), [1, 2]);
  } finally {
    talk.startBlocks = originalStartBlocks;
  }

  const block = workerScenario.talkBlocks.find((item) => item.talkId === "guide" && item.blockKey === "history_archive_a");
  assert.ok(block);
  const originalMessages = block.messages;
  block.messages = [...block.messages, { ...block.messages[0], id: "temporary-layout-change" }];
  try {
    assert.deepEqual(restoredTalkHistoryMessages(initialized.state, "guide_history_archive_a"), {
      ok: false,
      error: "history_layout_changed"
    });
  } finally {
    block.messages = originalMessages;
  }
});

test("チャットの初期履歴blockも同じ修復契約を使う", async () => {
  const state = createInitialPlayerState();
  state.stateValues.sealed_note_unlocked = true;
  state.repairedAppIds.push("chat");
  const initialized = await reconcileScenarioState(state, "player-chat-history-repair");
  const lobby = workerScenario.talks.find((talk) => talk.id === "lobby");
  assert.ok(lobby);
  const publicState = await publicPlayerState(initialized.state, 1, [], null, initialized.transcriptAppends);
  const publicLobby = publicState.visibleDeviceState.chatThreads.find((thread) => thread.id === lobby.publicId);
  assert.deepEqual(publicLobby?.brokenHistoryRanges, [{ beforeSeq: 2 }]);
  assert.equal(initialized.transcriptAppends.some((delta) => delta.streamId === "talk:lobby"), false);
  assert.deepEqual(publicLobby?.messages.map((message) => message.seq), [2]);
  const searchResults = searchScenario("消えた談話記録", initialized.state);
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0]?.targetTalkId, lobby.publicId);

  initialized.state.repairedContentIds.push("lobby_history_archive");
  const restored = restoredTalkHistoryMessages(initialized.state, "lobby_history_archive");
  assert.ok(restored);
  assert.deepEqual(restored?.messages.map((message) => message.seq), [1]);
  assert.equal(publicTalkMessage(restored.messages[0]).historyRepairId, workerScenario.publicIds.content.lobby_history_archive);
});

test("会話メディア添付とアルバム項目は同じ公開添付IDで対応する", async () => {
  const imageAttachment = resolveTalkAttachment("rainy_window_image");
  assert.equal(imageAttachment?.kind, "image");
  assert.deepEqual(albumPhotoIdsForMediaAttachment(imageAttachment), ["rainy_window"]);

  const state = createInitialPlayerState();
  state.repairedContentIds.push("rainy_window");
  const publicState = await publicPlayerState(state, 1);
  const photo = publicState.visibleDeviceState.photos.find((item) => item.id === workerScenario.publicIds.content.rainy_window);
  const publicMessage = publicTalkMessage({
    seq: 1,
    id: "message-1",
    talkId: workerScenario.publicIds.talk.guide,
    sender: "other",
    body: "画像",
    attachment: imageAttachment,
    sentAt: "2026-08-12T20:14:00.000Z"
  });
  assert.equal(photo?.attachmentId, workerScenario.publicIds.attachment.rainy_window_image);
  assert.equal(publicMessage.attachment?.attachmentId, photo?.attachmentId);
  assert.notEqual(photo?.attachmentId, "rainy_window_image");

  const videoAttachment = resolveTalkAttachment("demo_video_attachment");
  assert.equal(videoAttachment?.kind, "video");
  assert.deepEqual(albumPhotoIdsForMediaAttachment(videoAttachment), ["demo_video"]);
  const video = publicState.visibleDeviceState.photos.find((item) => item.id === workerScenario.publicIds.content.demo_video);
  assert.equal(video?.attachmentId, workerScenario.publicIds.attachment.demo_video_attachment);
});

test("共通分岐とリピートblockをtalk単位で解決する", () => {
  const scenario = loadAndValidateScenario();
  const searchTalk = scenario.worker.talks.find((item) => item.id === "search_agent");
  assert.ok(searchTalk?.rules.some((rule) => rule.from === "*" && rule.intent === "ヘルプ"));
  const talk = scenario.worker.talks.find((item) => item.id === "guide");
  const promptRule = talk?.rules.find((rule) => rule.from === talk.initialFrom && rule.isDefault);
  const promptBlock = promptRule?.nextBlocks[0] ?? "";
  assert.equal(scenario.worker.repeatTalkBlocks[promptBlock]?.length, 1);
  assert.match(scenario.worker.repeatTalkBlocks[promptBlock]?.[0] ?? "", /@2$/u);
});

test("会話の投稿可否は有効な分岐と入力のenabled状態に従う", async () => {
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  assert.ok(talk);
  const initialized = (await reconcileScenarioState(createInitialPlayerState(), "player-1")).state;
  assert.equal(talkCanPost(talk, initialized), true);

  const terminalState = structuredClone(initialized);
  terminalState.talks[talk.id].from = "__terminal__";
  assert.equal(talkCanPost(talk, terminalState), false);

  const searchTalk = workerScenario.talks.find((item) => item.kind === "search_agent");
  assert.ok(searchTalk);
  assert.equal(talkCanPost(searchTalk, initialized), true);
  const hiddenInputState = structuredClone(initialized);
  hiddenInputState.talks[searchTalk.id].inputVisible = false;
  assert.equal(talkCanPost(searchTalk, hiddenInputState), true);
  hiddenInputState.talks[searchTalk.id].inputEnabled = false;
  assert.equal(talkCanPost(searchTalk, hiddenInputState), false);
});

test("会話で表示した通常添付だけをアルバム追加対象にする", () => {
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  const photo = workerScenario.contents.find((item) => item.id === "rainy_window");
  const locked = workerScenario.contents.find((item) => item.id === "sealed_note");
  assert.ok(talk);
  assert.ok(photo);
  assert.ok(locked);

  const state = revealTalkMessages(createInitialPlayerState(), talk.id, [{
    seq: 1,
    id: "album-sync-test",
    talkId: talk.publicId,
    sender: "other",
    body: "添付です。",
    attachment: {
      kind: "image",
      attachmentId: "rainy_window_image",
      contentId: photo.id,
      imageUrl: "/demo/album/rainy-window.webp"
    },
    sentAt: "2026-08-12T00:00:00.000Z"
  }, {
    seq: 2,
    id: "locked-attachment-test",
    talkId: talk.publicId,
    sender: "other",
    body: "鍵付きです。",
    attachment: {
      kind: "locked",
      contentId: locked.id,
      locked: true
    },
    sentAt: "2026-08-12T00:00:01.000Z"
  }]);

  assert.ok(state.revealedAttachmentContentIds.includes(photo.id));
  assert.ok(state.revealedAttachmentContentIds.includes(locked.id));
  assert.deepEqual(observedAlbumMediaContentIds(talk, state, [photo.publicId, locked.publicId]), [photo.id]);

  state.repairedContentIds.push(photo.id);
  assert.deepEqual(observedAlbumMediaContentIds(talk, state, [photo.publicId]), []);
});

test("着信定義と予約イベント用hookを生成する", () => {
  const scenario = loadAndValidateScenario();
  const call = scenario.worker.incomingCalls.find((item) => item.id === "demo_call");
  assert.equal(call?.name, "着信テスト");
  assert.equal(call?.publicId, scenario.worker.publicIds.incomingCall.demo_call);
  assert.notEqual(call?.publicId, "demo_call");
  assert.equal(scenario.worker.incomingCalls.find((call) => call.id === "demo_call")?.transcript?.[1]?.atMs, 2_000);
  const callHistory = scenario.worker.contents.find((content) => content.id === "demo_call_history");
  assert.deepEqual(callHistory?.record.transcript, call?.transcript);
  assert.equal(callHistory?.record.audioUrl, call?.audioUrl);
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "schedule_demo_call"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scheduled_event" && hook.target === "show_demo_call"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "demo_form"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "demo_all_clear"));
});

test("着信完了後も会話位置を変えずに履歴を利用可能にする", async () => {
  const initial = (await reconcileScenarioState(createInitialPlayerState(), "incoming-call-test")).state;
  const previousFrom = initial.talks.guide.from;
  const previousTurnKey = initial.talks.guide.turnKey;
  const result = await runScenarioHooks(initial, {
    eventId: "incoming_call_completed",
    callId: "demo_call"
  });
  assert.equal(result.state.stateValues.demo_call_completed, true);
  const guideAppend = result.transcriptAppends.find((delta) => delta.streamId === "talk:guide");
  const guideMessage = guideAppend?.resolvedMessages?.find((message) => message.body.includes("着信履歴"));
  assert.equal(guideMessage?.delayMs, 500);
  assert.equal(guideMessage?.delayOnFirstDisplay, true);
  assert.equal(result.state.talks.guide.from, previousFrom);
  assert.equal(result.state.talks.guide.turnKey, previousTurnKey);
  assert.equal(talkCanPost(workerScenario.talks.find((talk) => talk.id === "guide"), result.state), true);
  assert.equal(
    (await publicPlayerState(result.state, 2)).visibleDeviceState.callLogs[0]?.contentId,
    workerScenario.publicIds.content.demo_call_history
  );
});

test("ToDoはhookで明示的に追加・完了される", async () => {
  const started = await runScenarioHooks(createInitialPlayerState(), {
    eventId: "session_started"
  });
  assert.deepEqual((await publicPlayerState(started.state, 1)).todos.map((todo) => todo.id), ["find_old_note"]);

  const oldNoteOpened = await runScenarioHooks(started.state, {
    eventId: "content_repaired",
    contentId: "old_note"
  });
  assert.deepEqual((await publicPlayerState(oldNoteOpened.state, 2)).todos.map((todo) => todo.id), ["find_rainy_window"]);
});

test("進行milestoneの案内は検索ナビへ追加し、会話位置を動かさない", async () => {
  const initialized = (await reconcileScenarioState(createInitialPlayerState(), "nav-stage-player")).state;
  const before = structuredClone(initialized.talks.search_agent);
  const oldNoteOpened = await runScenarioHooks(initialized, {
    eventId: "content_repaired",
    contentId: "old_note"
  });
  assert.equal(JSON.stringify(oldNoteOpened.transcriptAppends).includes("search_agent::stage_photo"), true);
  assert.equal(oldNoteOpened.state.talks.search_agent.from, before.from);
  assert.equal(oldNoteOpened.state.talks.search_agent.turnKey, before.turnKey);

  const rainyWindowOpened = await runScenarioHooks(oldNoteOpened.state, {
    eventId: "content_repaired",
    contentId: "rainy_window"
  });
  assert.equal(JSON.stringify(rainyWindowOpened.transcriptAppends).includes("search_agent::stage_report"), true);
  assert.equal(rainyWindowOpened.state.talks.search_agent.from, before.from);
  assert.equal(rainyWindowOpened.state.talks.search_agent.turnKey, before.turnKey);
});

test("デモ完了案内は検索ナビへ一度だけ追加する", async () => {
  const initialized = (await reconcileScenarioState(createInitialPlayerState(), "nav-complete-player")).state;
  initialized.stateValues.demo_completed = true;
  initialized.activeTodoIds = ["contact_owner"];
  const completed = await runScenarioHooks(initialized, {
    eventId: "talk_turn_completed",
    talkId: "lobby",
    playerInput: "こんにちは"
  });
  assert.equal(completed.state.stateValues.demo_completion_announced, true);
  assert.deepEqual(completed.state.activeTodoIds, []);
  assert.equal(JSON.stringify(completed.transcriptAppends).includes("search_agent::stage_done"), true);

  const repeated = await runScenarioHooks(completed.state, {
    eventId: "talk_turn_completed",
    talkId: "lobby",
    playerInput: "もう一度"
  });
  assert.equal(JSON.stringify(repeated.transcriptAppends).includes("search_agent::stage_done"), false);
});

test("ナビの色報告はSMS添付を一度だけ配送し、次のToDoと通知を同じ更新へ反映する", async () => {
  const initialized = (await reconcileScenarioState(createInitialPlayerState(), "nav-color-report")).state;
  initialized.stateValues.image_color_reported = true;
  initialized.stateValues.clue_attachments_pending = true;
  initialized.stateValues.old_note_opened = true;
  initialized.activeTodoIds = ["find_rainy_window", "report_clue"];
  const beforeFrom = initialized.talks.guide.from;
  const beforeTurnKey = initialized.talks.guide.turnKey;

  const delivered = await runScenarioHooks(initialized, {
    eventId: "talk_turn_completed",
    talkId: "search_agent",
    playerInput: "青です"
  });
  assert.notEqual(delivered.state.stateValues.clue_attachments_pending, true);
  assert.deepEqual(delivered.state.activeTodoIds, ["unlock_recovery_note"]);
  assert.equal(delivered.state.talks.guide.from, beforeFrom);
  assert.equal(delivered.state.talks.guide.turnKey, beforeTurnKey);
  const guideAppend = delivered.transcriptAppends.find((append) => append.streamId === "talk:guide");
  assert.deepEqual(
    guideAppend?.resolvedMessages?.map((message) => ({
      attachmentId: message.attachment && "attachmentId" in message.attachment ? message.attachment.attachmentId : "",
      contentId: message.attachment && "contentId" in message.attachment ? message.attachment.contentId : ""
    })),
    [
      { attachmentId: "rainy_window_image", contentId: "rainy_window" },
      { attachmentId: "", contentId: "sealed_note" }
    ]
  );
  const publicState = await publicPlayerState(delivered.state, 2, [], null, delivered.transcriptAppends);
  assert.ok(publicState.visibleDeviceState.notifications.some((notification) => notification.id === workerScenario.publicIds.notification.clue_attachments));
  assert.equal(publicState.visibleDeviceState.messages.find((talk) => talk.id === workerScenario.publicIds.talk.guide)?.unread, true);

  const openedAfterReport = await runScenarioHooks(delivered.state, {
    eventId: "content_repaired",
    contentId: "rainy_window"
  });
  assert.equal(openedAfterReport.state.stateValues.rainy_window_opened, true);
  assert.deepEqual(openedAfterReport.state.activeTodoIds, ["unlock_recovery_note"]);
  assert.equal(JSON.stringify(openedAfterReport.transcriptAppends).includes("search_agent::stage_report"), false);

  const repeated = await runScenarioHooks(openedAfterReport.state, {
    eventId: "talk_turn_completed",
    talkId: "search_agent",
    playerInput: "青です"
  });
  assert.equal(repeated.transcriptAppends.some((append) => append.streamId === "talk:guide"), false);
});

test("ラジオの再生条件・cue・生成音声をサーバー側で解決する", async () => {
  const radio = workerScenario.contents.find((content) => content.id === "sample_radio");
  const callLog = workerScenario.contents.find((content) => content.id === "demo_call_history");
  assert.ok(radio);
  assert.ok(callLog);
  const originalRecord = structuredClone(radio.record);
  const originalCallRecord = structuredClone(callLog.record);
  radio.record = {
    ...radio.record,
    audioUrl: "",
    audioSegments: [{ kind: "generated", genAudioId: "demo_voice" }],
    playbackCond: "radio_playback_completed",
    playbackDisabledLabel: "準備中です",
    form: { kind: "html", id: "demo-form", label: "投稿", url: "/demo/form.html", disabled: true },
    formDisabledCond: "radio_playback_completed",
    audioCues: [{ id: "demo_marker", atMs: 2_000 }]
  };
  callLog.record = { ...callLog.record, audioUrl: "", genAudioId: "demo_voice" };
  delete radio.record.audioAttachmentId;
  delete callLog.record.audioAttachmentId;
  const generatedAudio = [{
    id: workerScenario.publicIds.generatedAudio.demo_voice,
    status: "ready",
    requestedAt: null,
    completedAt: null,
    publicAudioUrl: "/generated/demo.wav",
    fallbackAudioUrl: null
  }];
  try {
    const state = createInitialPlayerState();
    const blocked = (await publicPlayerState(state, 1, generatedAudio)).visibleDeviceState.radioItems
      .find((item) => item.id === radio.publicId);
    assert.equal(blocked?.playbackDisabledLabel, "準備中です");
    assert.equal(blocked?.form?.disabled, true);
    assert.equal("playbackCond" in (blocked ?? {}), false);
    assert.equal("audioSegments" in (blocked ?? {}), false);

    state.stateValues.radio_playback_completed = true;
    const ready = (await publicPlayerState(state, 2, generatedAudio)).visibleDeviceState.radioItems
      .find((item) => item.id === radio.publicId);
    assert.equal(ready?.audioUrl, "/generated/demo.wav");
    assert.equal(ready?.audioSegments?.[0]?.genAudioId, workerScenario.publicIds.generatedAudio.demo_voice);
    assert.equal(ready?.audioSegments?.[0]?.generatedAudio?.publicAudioUrl, "/generated/demo.wav");
    assert.deepEqual(ready?.audioCues, [{ index: 1, atMs: 2_000 }]);
    assert.equal(ready?.form?.disabled, true);
    assert.equal("formDisabledCond" in (ready ?? {}), false);
    assert.deepEqual(radioAudioCueForEvent(radio.id, 1, state), {
      cueId: "demo_marker",
      cueTarget: "sample_radio:demo_marker",
      cueIndex: 1
    });
    assert.equal(radioAudioCueForEvent(radio.id, 2, state), null);

    state.stateValues.demo_call_completed = true;
    const generatedCall = (await publicPlayerState(state, 3, generatedAudio)).visibleDeviceState.callLogs
      .find((item) => item.id === callLog.publicId);
    assert.equal(generatedCall?.audioUrl, "/generated/demo.wav");
    assert.equal(generatedCall?.generatedAudio?.id, workerScenario.publicIds.generatedAudio.demo_voice);
  } finally {
    radio.record = originalRecord;
    callLog.record = originalCallRecord;
  }
});

test("デモは任意字幕付きラジオと実動画を含み、字幕なしコンテンツも許容する", () => {
  const scenario = loadAndValidateScenario();
  const radio = scenario.worker.contents.find((content) => content.id === "sample_radio");
  const silentRadio = scenario.worker.contents.find((content) => content.id === "dummy_radio_1");
  const video = scenario.worker.contents.find((content) => content.id === "demo_video");
  const callWithoutTranscript = scenario.worker.contents.find((content) => content.id === "missed_call");
  const voicemail = scenario.worker.contents.find((content) => content.id === "demo_voicemail");

  assert.equal(scenario.worker.attachments.find(item=>item.id===radio?.record.audioAttachmentId)?.asset, "/system/radio-caption-sample.wav");
  assert.equal(radio?.record.transcript?.length, 3);
  assert.equal(silentRadio?.record.transcript, undefined);
  assert.equal(callWithoutTranscript?.record.transcript, undefined);
  assert.equal(voicemail?.record.kind, "voicemail");
  assert.equal(scenario.worker.attachments.find(item=>item.id===voicemail?.record.audioAttachmentId)?.asset, "/system/call-caption-sample.wav");
  assert.equal(voicemail?.record.transcript?.length, 3);
  assert.equal(video?.record.mediaKind, "video");
  assert.equal(scenario.worker.attachments.find(item=>item.id===video?.record.videoAttachmentId)?.asset, "/demo/demo-video.mp4");
  assert.equal(talkCommandAvailable("photo:demo_video", createInitialPlayerState()), true);
  const beforeReceipt = createInitialPlayerState();
  assert.equal(searchScenario("画像受信テスト", beforeReceipt).some((item) => item.title === "受信したダミー画像"), false);
  beforeReceipt.stateValues.demo_image_received = true;
  assert.equal(searchScenario("画像受信テスト", beforeReceipt).some((item) => item.title === "受信したダミー画像"), true);
});

test("デモの一覧アプリはスクロール確認用ダミーデータを持つ", () => {
  const scenario = loadAndValidateScenario();
  assert.deepEqual(
    scenario.worker.contents.filter((content) => content.appId === "notes").slice(0, 3).map((content) => content.id),
    ["welcome_note", "feature_test_guide", "old_note"]
  );
  assert.equal(scenario.worker.contents.find((content) => content.id === "demo_video")?.record.tags.includes("非AI生成"), false);
  for (const [appId, minimum] of [
    ["phone", 6],
    ["mail", 4],
    ["notes", 6],
    ["photos", 6],
    ["calendar", 8],
    ["radio", 5],
    ["browser", 6]
  ]) {
    const items = scenario.worker.contents.filter((content) => content.appId === appId && content.id.includes("dummy_"));
    assert.ok(items.length >= minimum, `${appId}にダミーデータが足りません`);
  }
  assert.ok(scenario.worker.talks.filter((talk) => talk.kind === "sms").length >= 9);
  assert.ok(scenario.worker.talks.filter((talk) => talk.kind === "chat").length >= 8);
});

test("ナビとメッセージ固有の機能テストは受信・画像登録候補・遅延着信を作る", async () => {
  const initial = createInitialPlayerState();
  const linked = await runScenarioHooks(initial, {
    eventId: "talk_turn_completed",
    talkId: "guide",
    playerInput: "別ルームへ送る"
  });
  assert.equal(linked.state.stateValues.demo_sms_message_received, true);
  assert.ok(linked.transcriptAppends.some((delta) => delta.streamId === "talk:sms_receiver"));
  assert.ok((await publicPlayerState(linked.state, 1, [], null, linked.transcriptAppends)).visibleDeviceState.notifications
    .some((notification) => notification.title === "テスト受信箱"));

  const imageReceived = await runScenarioHooks(initial, {
    eventId: "talk_turn_completed",
    talkId: "search_agent",
    playerInput: "画像受信テスト"
  });
  assert.equal(imageReceived.state.stateValues.demo_image_received, true);
  assert.ok(imageReceived.state.revealedAttachmentContentIds.includes("demo_received_image"));
  const imageTalk = workerScenario.talks.find((talk) => talk.id === "sms_media_receiver");
  const imageContent = workerScenario.contents.find((content) => content.id === "demo_received_image");
  assert.ok(imageTalk && imageContent);
  assert.deepEqual(
    observedAlbumMediaContentIds(imageTalk, imageReceived.state, [imageContent.publicId]),
    ["demo_received_image"]
  );

  const delayed = await runScenarioHooks(initial, {
    eventId: "talk_turn_completed",
    talkId: "search_agent",
    playerInput: "遅延メッセージ"
  });
  assert.deepEqual(delayed.scheduleEffects, [{
    type: "queue",
    id: "manual_delayed_message",
    delayMs: 3_000,
    eventId: "deliver_demo_delayed_message",
    fields: {}
  }]);
  const delivered = await runScenarioHooks(delayed.state, {
    eventId: "scheduled_event",
    scheduleId: "deliver_demo_delayed_message"
  });
  assert.equal(delivered.state.stateValues.demo_delayed_message_received, true);
  assert.ok(delivered.transcriptAppends.some((delta) => delta.streamId === "talk:sms_receiver"));
});

test("一度限りの機能テストは再実行を成功扱いせずリセットを案内する", async () => {
  const talk = workerScenario.talks.find((item) => item.id === "search_agent");
  assert.ok(talk);
  for (const [playerInput, completedState] of [
    ["着信テスト", "demo_call_completed"],
    ["遅延メッセージ", "demo_delayed_message_received"],
    ["画像受信テスト", "demo_image_received"]
  ]) {
    const selected = await resolveTalkRule({
      rules: talk.rules,
      from: talk.initialFrom,
      playerInput,
      stateValues: { ...workerScenario.stateVariables, [completedState]: true }
    });
    assert.equal(selected.ok && selected.rule.nextBlocks[0], "search_agent::demo_test_already_done");

    const state = createInitialPlayerState();
    state.stateValues[completedState] = true;
    const result = await runScenarioHooks(state, {
      eventId: "talk_turn_completed",
      talkId: "search_agent",
      playerInput
    });
    assert.equal(result.scheduleEffects.length, 0, `${playerInput}を再予約しています`);
    assert.equal(result.transcriptAppends.length, 0, `${playerInput}のhookが完了済み内容を再追加しています`);
    assert.equal(
      result.transcriptAppends.some((append) => append.streamId === "talk:sms_media_receiver"),
      false,
      `${playerInput}で受信内容を再追加しています`
    );
  }
});

test("デモの会話コマンドは着信とアプリ間連携を既存hookで構成する", async () => {
  for (const [playerInput, effect] of [
    ["ノイズ演出", { type: "noise", durationMs: 500 }],
    ["フラッシュ演出", {
      type: "flash",
      fadeInMs: 30,
      holdMs: 40,
      fadeOutMs: 270,
      intensity: 0.9,
      color: "#fffaf2"
    }],
    ["暗転演出", {
      type: "blackout",
      fadeInMs: 220,
      holdMs: 180,
      fadeOutMs: 300,
      intensity: 1
    }]
  ]) {
    const presentation = await runScenarioHooks(createInitialPlayerState(), {
      eventId: "talk_turn_completed",
      talkId: "search_agent",
      playerInput
    });
    assert.deepEqual(presentation.presentationEffects, [effect]);
  }

  const gameOver = await runScenarioHooks(createInitialPlayerState(), {
    eventId: "talk_turn_completed",
    talkId: "search_agent",
    playerInput: "ゲームオーバー演出"
  });
  assert.equal(gameOver.presentationSequence?.type, "game_over");

  const allClear = await runScenarioHooks(createInitialPlayerState(), {
    eventId: "talk_turn_completed",
    talkId: "search_agent",
    playerInput: "オールクリア演出"
  });
  assert.deepEqual(allClear.presentationSequence, {
    type: "all_clear",
    appId: "radio",
    contentId: "sample_radio",
    autoplay: false
  });

  const call = await runScenarioHooks(createInitialPlayerState(), {
    eventId: "talk_turn_completed",
    talkId: "search_agent",
    playerInput: "着信テスト"
  });
  assert.deepEqual(call.scheduleEffects, [{
    type: "queue",
    id: "manual_demo_call",
    delayMs: 1_500,
    eventId: "show_demo_call",
    fields: {}
  }]);

  const chatUnavailable = await runScenarioHooks(createInitialPlayerState(), {
    eventId: "talk_turn_completed",
    talkId: "guide",
    playerInput: "チャットへ送る"
  });
  assert.equal(chatUnavailable.transcriptAppends.some((delta) => delta.streamId === "talk:guide"), false);

  const chatReady = createInitialPlayerState();
  chatReady.stateValues.sealed_note_unlocked = true;
  chatReady.stateValues.chat_auth_verified = true;
  chatReady.repairedAppIds.push("chat");
  const toChat = await runScenarioHooks(chatReady, {
    eventId: "talk_turn_completed",
    talkId: "guide",
    playerInput: "チャットへ送る"
  });
  assert.equal(toChat.state.stateValues.demo_chat_cross_received, true);
  assert.ok(toChat.transcriptAppends.some((delta) => delta.streamId === "talk:chat_receiver"));

  const toMessages = await runScenarioHooks(chatReady, {
    eventId: "talk_turn_completed",
    talkId: "lobby",
    playerInput: "メッセージへ送る"
  });
  assert.equal(toMessages.state.stateValues.demo_sms_cross_received, true);
  assert.ok(toMessages.transcriptAppends.some((delta) => delta.streamId === "talk:sms_receiver"));

  const withinChat = await runScenarioHooks(chatReady, {
    eventId: "talk_turn_completed",
    talkId: "lobby",
    playerInput: "チャット連携"
  });
  assert.equal(withinChat.state.stateValues.demo_chat_message_received, true);
  assert.ok(withinChat.transcriptAppends.some((delta) => delta.streamId === "talk:chat_receiver"));
});

test("デモ全体の演出コマンドは検索ナビへ集約する", () => {
  const scenario = loadAndValidateScenario();
  const guide = scenario.worker.talks.find((talk) => talk.id === "guide");
  const search = scenario.worker.talks.find((talk) => talk.id === "search_agent");
  assert.equal(guide?.rules.some((rule) => rule.mode === "game_over"), false);
  assert.equal(guide?.rules.some((rule) => rule.criteria.includes("着信テスト")), false);
  assert.ok(search?.rules.some((rule) => rule.intent === "機能テスト" && rule.criteria.includes("ゲームオーバー演出")));
});

test("条件付き表示と検索AI talkを公開シナリオへ生成する", () => {
  const scenario = loadAndValidateScenario();
  assert.ok(scenario.worker.notifications.some((item) => item.id && item.title === "デモ連絡先"));
  assert.equal(scenario.worker.talks.find((talk) => talk.id === "lobby")?.cond, "sealed_note_unlocked");
  assert.equal(scenario.worker.notifications.find((item) => item.id === "welcome"), undefined);
  assert.equal(scenario.worker.notifications.find((item) => item.id === "clue_attachments")?.cond, "image_color_reported && !sealed_note_unlocked");
  assert.equal(scenario.worker.todos.find((item) => item.id === "find_rainy_window")?.cond, "old_note_opened && !rainy_window_opened && !image_color_reported");
  assert.equal(scenario.worker.assistantMessages.find((item) => item.id === "home_hint")?.cond, "!old_note_opened");
  assert.equal(scenario.worker.assistantMessages.find((item) => item.id === "photo_hint")?.cond, "old_note_opened && !rainy_window_opened && !image_color_reported");
  assert.equal(scenario.worker.assistantMessages.find((item) => item.id === "report_hint")?.cond, "rainy_window_opened && !image_color_reported");
  const unlockAssistant = scenario.worker.assistantMessages.find((item) => item.id === "sealed_note_opened");
  assert.equal(unlockAssistant?.surface, "messages");
  assert.equal(unlockAssistant?.cond, "sealed_note_unlocked && !chat_auth_link_sent");
  const completedAssistant = scenario.worker.assistantMessages.find((item) => item.id === "demo_completed_nav");
  assert.equal(completedAssistant?.surface, "chat");
  assert.equal(completedAssistant?.cond, "demo_completed");
  assert.equal(Object.hasOwn(scenario.worker, "searchResponses"), false);
  const searchTalk = scenario.worker.talks.find((talk) => talk.kind === "search_agent");
  assert.equal(searchTalk?.id, "search_agent");
  assert.equal(searchTalk?.label, scenario.worker.project.assistantName);
  assert.deepEqual(
    scenario.worker.talkPeople.find((person) => person.id === "search_agent"),
    { id: "search_agent", name: scenario.worker.project.assistantName, role: "npc", part: "base", order: 3 }
  );
  assert.deepEqual(searchTalk?.startSteps.map((step) => step.kind), ["input", "block", "input"]);
  const searchDefault = searchTalk?.rules.find((rule) => rule.from === searchTalk.initialFrom && rule.isDefault);
  assert.deepEqual(searchDefault?.outputSteps.map((step) => step.kind), ["search", "if", "if"]);
  assert.deepEqual(searchDefault?.nextBlocks, ["search_agent::found", "search_agent::not_found"]);
  assert.equal(searchDefault?.nextFromId, "");
  assert.ok(scenario.hookTalkBlocksByTalk.search_agent.includes("hint_first"));
  const contactResult = searchScenario("デモ連絡先", createInitialPlayerState());
  assert.deepEqual(contactResult.map((item) => [item.appId, item.targetKind, item.title]), [["messages", "content", "デモ連絡先"]]);
  const firstStepResult = searchScenario("古いメモ", createInitialPlayerState());
  assert.deepEqual(firstStepResult.map((item) => [item.appId, item.targetKind, item.title]), [["notes", "content", "古いメモ"]]);
  assert.deepEqual(searchScenario("手がかり", createInitialPlayerState()), []);
  const chatSearchState = createInitialPlayerState();
  chatSearchState.stateValues.sealed_note_unlocked = true;
  chatSearchState.repairedAppIds.push("chat");
  const roomResult = searchScenario("サンプルルーム", chatSearchState);
  assert.deepEqual(roomResult.map((item) => [item.appId, item.targetKind, item.title]), [["chat", "content", "サンプルルーム"]]);
  const callSearchState = createInitialPlayerState();
  callSearchState.stateValues.demo_call_completed = true;
  const callResult = searchScenario("書き起こし", callSearchState);
  assert.deepEqual(callResult.map((item) => [item.appId, item.targetKind, item.title]), [["phone", "content", "着信テスト"]]);
  assert.deepEqual(
    scenario.worker.talkBlocks.find((block) => block.id === "lobby::lobby_reply")?.messages.at(-1)?.quickReplies,
    ["チャット連携", "メッセージへ送る"]
  );
  assert.ok(scenario.worker.talkBlocks.find((block) => block.id === "search_agent::test_menu")?.messages.at(-1)?.quickReplies?.includes("デモ連絡先"));
  assert.equal(scenario.worker.chatAuthGate?.cond, "sealed_note_unlocked && !chat_auth_verified");
  assert.ok(scenario.worker.talkBlocks.some((block) => block.talkId === "guide" && block.blockKey === "chat_auth_link"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.handler === "send_chat_auth_link"));
  assert.deepEqual(scenario.worker.clientCallableEvents, ["chat_auth_link_requested"]);
  assert.equal(scenario.worker.clientCallableEvents.includes("show_demo_call"), false);
  assert.ok(scenario.worker.hooks.some((hook) => hook.handler === "verify_chat_auth"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "session_started" && hook.handler === "mark_session_started"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "content_unlocked" && hook.target === "sealed_note"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "audio_playback_completed" && hook.target === "sample_radio" && hook.handler === "mark_radio_playback_completed"));
  assert.deepEqual(scenario.worker.publicStateVariables, []);
});

test("未使用の全アプリ用クライアントシナリオを生成しない", () => {
  assert.equal(fs.existsSync("src/generated/clientScenario.generated.ts"), false);
});

test("作中日付をタイムゾーン変換せず表示と週へ展開する", () => {
  assert.deepEqual(parseStoryDate("2026-08-12"), { year: 2026, month: 8, day: 12 });
  assert.equal(parseStoryDate("2026-02-29"), null);
  assert.equal(formatStoryDateLabel("2026-08-12"), "8月12日（水）");
  assert.equal(formatStoryDateCompact("2026-08-12"), "8/12");
  assert.deepEqual(
    storyWeekFor("2026-08-12").map((day) => day.value),
    ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"]
  );
});

test("シナリオディレクトリを明示してデモと別の原本を選べる", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-custom-scenario-"));
  try {
    fs.mkdirSync(path.join(temporaryRoot, "scenario"), { recursive: true });
    fs.cpSync("scenario/demo", path.join(temporaryRoot, "scenario/my-story"), { recursive: true });
    const constantsPath = path.join(temporaryRoot, "scenario/my-story/authoring/project_constants.tsv");
    fs.writeFileSync(constantsPath, fs.readFileSync(constantsPath, "utf8").replace("XStoryPhone Demo", "選択された作品"));
    const hooksPath = path.join(temporaryRoot, "scenario/my-story/authoring/hooks.tsv");
    fs.appendFileSync(hooksPath, '\n\tcontent_opened\tnotes\t\tstate.set("session_started", true);\t\ttest_app_target\tfalse\n');
    const scenarioLibUrl = new URL("../scripts/scenario-lib.mjs", import.meta.url).href;
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `import(${JSON.stringify(scenarioLibUrl)}).then(({ loadAndValidateScenario }) => console.log(loadAndValidateScenario().worker.project.name))`
    ], {
      cwd: temporaryRoot,
      env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/my-story" },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "選択された作品");
    fs.writeFileSync(path.join(temporaryRoot, "package.json"), JSON.stringify({ xstoryphone: { scenarioDir: "scenario/my-story" } }));
    const configured = spawnSync(process.execPath, [
      "--input-type=module", "--eval",
      `import { loadAndValidateScenario } from ${JSON.stringify(scenarioLibUrl)}; console.log(loadAndValidateScenario().worker.project.name);`
    ], { cwd: temporaryRoot, env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "" }, encoding: "utf8" });
    assert.equal(configured.status, 0, configured.stderr);
    assert.equal(configured.stdout.trim(), "選択された作品");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("talk単位initialStateを生成し、初期block単位condは明示拒否する", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-talk-initial-state-"));
  try {
    fs.cpSync("scenario", path.join(temporaryRoot, "scenario"), { recursive: true });
    const scenarioPath = path.join(temporaryRoot, "scenario/demo/scenario.fixture.json");
    const scenario = readScenarioFixture(scenarioPath);
    const validator = fileURLToPath(new URL("./helpers/validate-authoring-fixture.mjs", import.meta.url));
    const repairableTalk = scenario.talks.find((talk) => talk.id === "sms_receiver");
    const invalidBlockTalk = scenario.talks.find((talk) => talk.id === "sms_media_receiver");
    repairableTalk.initialState = "repairable";
    repairableTalk.repairLabel = "破損ルーム";
    repairableTalk.search = ["復元ルーム"];
    scenario.hooks.push({
      event: "content_repaired",
      target: repairableTalk.id,
      handler: "mark_session_started",
      cond: "",
      llm: false
    });
    invalidBlockTalk.startBlocks = [{ block: invalidBlockTalk.startBlocks[0], cond: "old_note_opened" }];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));

    const result = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /talk単位のinitialState/u);
    assert.match(result.stderr, /初期block単位のcondは仕様にありません/u);

    invalidBlockTalk.startBlocks = [invalidBlockTalk.startBlocks[0].block];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const generated = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `import(${JSON.stringify(new URL("./helpers/authoring-fixture.mjs", import.meta.url).href)}).then(({ loadAndValidateScenario }) => {
        const talk = loadAndValidateScenario().worker.talks.find((item) => item.id === "sms_receiver");
        console.log(JSON.stringify(talk));
      })`
    ], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const talk = JSON.parse(generated.stdout);
    assert.equal(talk.initialState, "repairable");
    assert.equal(talk.repairLabel, "破損ルーム");
    assert.deepEqual(talk.search, ["復元ルーム"]);

    const historyTalk = scenario.talks.find((item) => item.id === "guide");
    historyTalk.initialState = "repairable";
    historyTalk.search = ["履歴との競合"];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const conflictingRepair = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(conflictingRepair.status, 1);
    assert.match(conflictingRepair.stderr, /talk単位のinitialStateと初期履歴block修復は同時に使えません/u);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("シナリオ検証は不正なcondと未定義変数を実行前に拒否する", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-scenario-"));
  try {
    fs.cpSync("scenario", path.join(temporaryRoot, "scenario"), { recursive: true });
    const scenarioPath = path.join(temporaryRoot, "scenario/demo/scenario.fixture.json");
    const scenario = readScenarioFixture(scenarioPath);
    const validator = fileURLToPath(new URL("./helpers/validate-authoring-fixture.mjs", import.meta.url));
    const historyRepair = scenario.contents.find((content) => content.id === "guide_history_archive_a");
    historyRepair.record.block = "clue_attachments";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const dynamicHistoryBlockResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(dynamicHistoryBlockResult.status, 1);
    assert.match(dynamicHistoryBlockResult.stderr, /record.block は指定talkのstartBlocksに含まれるblock/u);

    historyRepair.record.block = "history_archive_a";
    scenario.notifications[0].cond = "(!old_note_opened";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const result = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /notification clue_attachments: cond が不正です/u);

    scenario.notifications[0].cond = "old_note_opend";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const unknownVariableResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(unknownVariableResult.status, 1);
    assert.match(unknownVariableResult.stderr, /状態変数が未定義です: old_note_opend/u);

    scenario.notifications[0].cond = "!old_note_opened";
    scenario.publicStateVariables = ["old_note_opend"];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const unknownPublicStateResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(unknownPublicStateResult.status, 1);
    assert.match(unknownPublicStateResult.stderr, /publicStateVariables の状態変数が未定義です: old_note_opend/u);

    scenario.publicStateVariables = [];
    scenario.contents.find((content) => content.id === "welcome_note").record.tags = [""];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const invalidTagsResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(invalidTagsResult.status, 1);
    assert.match(invalidTagsResult.stderr, /welcome_note: record.tags は文字列の配列にし、空文字を含めないでください/u);

    scenario.contents.find((content) => content.id === "welcome_note").record.tags = ["案内", "操作"];
    scenario.project.date = "2026-02-29";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const invalidProjectDateResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(invalidProjectDateResult.status, 1);
    assert.match(invalidProjectDateResult.stderr, /project.date は YYYY-MM-DD 形式の実在する日付にしてください/u);

    scenario.project.date = "2026-08-12";
    scenario.contents.find((content) => content.id === "owner_schedule").record.date = "8/12";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const invalidCalendarDateResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(invalidCalendarDateResult.status, 1);
    assert.match(invalidCalendarDateResult.stderr, /owner_schedule: record.date は YYYY-MM-DD 形式の実在する日付にしてください/u);

    scenario.contents.find((content) => content.id === "owner_schedule").record.date = "2026-08-12";
    scenario.project.lockScreen = { method: "fixed-pin", pin: "123" };
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const invalidFixedPinResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(invalidFixedPinResult.status, 1);
    assert.match(invalidFixedPinResult.stderr, /project.lockScreen.pin は4桁から8桁の数字文字列にしてください/u);

    scenario.project.lockScreen = { method: "player-passcode" };
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const invalidBrowserPasscodeResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(invalidBrowserPasscodeResult.status, 1);
    assert.match(invalidBrowserPasscodeResult.stderr, /browser\/staticモードでは project.lockScreen.method に player-passcode を指定できません/u);

    scenario.project.lockScreen = { method: "fixed-pin", pin: "0420" };
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const scenarioLibUrl = new URL("./helpers/authoring-fixture.mjs", import.meta.url).href;
    const fixedPinGenerationResult = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `import(${JSON.stringify(scenarioLibUrl)}).then(({ loadAndValidateScenario }) => {
        const generated = loadAndValidateScenario();
        console.log(JSON.stringify({
          workerPin: generated.worker.project.lockScreen.pin,
          projectConstants: generated.projectConstants
        }));
      })`
    ], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(fixedPinGenerationResult.status, 0, fixedPinGenerationResult.stderr);
    const fixedPinGeneration = JSON.parse(fixedPinGenerationResult.stdout);
    assert.equal(fixedPinGeneration.workerPin, "0420");
    assert.equal(fixedPinGeneration.projectConstants["device.lock_method"], "fixed-pin");
    assert.equal(fixedPinGeneration.projectConstants["device.lock_pin_length"], 4);
    assert.equal(JSON.stringify(fixedPinGeneration.projectConstants).includes("0420"), false);

    scenario.stateVariables.os_time_label = "12:00";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const reservedStateVariableResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(reservedStateVariableResult.status, 1);
    assert.match(reservedStateVariableResult.stderr, /stateVariables.os_time_label はprojectから自動設定される予約変数です/u);

    delete scenario.stateVariables.os_time_label;
    scenario.contents.find((content) => content.id === "browser_guide").record.url = "https://example.com/";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const externalBrowserUrlResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(externalBrowserUrlResult.status, 1);
    assert.match(externalBrowserUrlResult.stderr, /browser_guide: record.url は \/ から始まる同一オリジンURLにしてください/u);

    scenario.contents.find((content) => content.id === "browser_guide").record.url = "/demo/browser/start.html";
    scenario.incomingCalls[0].transcript = [
      { atMs: 1_000, text: "後" },
      { atMs: 0, text: "前" }
    ];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const unorderedTranscriptResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(unorderedTranscriptResult.status, 1);
    assert.match(unorderedTranscriptResult.stderr, /incomingCall.transcript はatMsの昇順にしてください/u);

    scenario.incomingCalls[0].transcript = [
      { atMs: 0, text: "前" },
      { atMs: 1_000, text: "後" }
    ];
    scenario.stateVariables.chapter = { type: "enum", initial: "opening", values: ["opening", "ending"] };
    scenario.stateVariables.visit_count = { type: "integer", initial: 0 };
    scenario.notifications[0].cond = 'chapter == "opening" && visit_count >= 0';
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const typedStateResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(typedStateResult.status, 0, typedStateResult.stderr);

    scenario.notifications[0].cond = 'chapter == "unknown"';
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const invalidEnumResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(invalidEnumResult.status, 1);
    assert.match(invalidEnumResult.stderr, /比較の型が不正です/u);

    scenario.notifications[0].cond = 'chapter == "opening" && visit_count >= 0';
    const originalSearch = scenario.apps[0].search;
    scenario.apps[0].search = [""];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const emptySearchResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(emptySearchResult.status, 1);
    assert.match(emptySearchResult.stderr, /search は文字列、またはAND条件にする文字列配列の配列にしてください/u);

    scenario.apps[0].search = originalSearch;
    scenario.stateVariables.player_input = "";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const reservedStateResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(reservedStateResult.status, 1);
    assert.match(reservedStateResult.stderr, /player_input はシステムの予約変数/u);
    delete scenario.stateVariables.player_input;

    scenario.contents.find((content) => content.id === "sample_radio").record.audioCues = [{ id: "invalid marker", atMs: 2_000 }];
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const invalidCueResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(invalidCueResult.status, 1);
    assert.match(invalidCueResult.stderr, /sample_radio: record.audioCues\[0\] が不正です/u);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("authoring検証はTSV構造・長さ・template・JSON keyを事前に拒否する", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-authoring-validation-"));
  try {
    fs.cpSync("scenario", path.join(temporaryRoot, "scenario"), { recursive: true });
    const scenarioPath = path.join(temporaryRoot, "scenario/demo/scenario.fixture.json");
    const flowPath = path.join(temporaryRoot, "scenario/demo/authoring/talk_flow.tsv");
    const blocksPath = path.join(temporaryRoot, "scenario/demo/authoring/talk_blocks.tsv");
    const baseScenario = JSON.stringify(readScenarioFixture(scenarioPath));
    const baseFlow = fs.readFileSync(flowPath, "utf8");
    const baseBlocks = fs.readFileSync(blocksPath, "utf8");
    const validator = fileURLToPath(new URL("./helpers/validate-authoring-fixture.mjs", import.meta.url));
    function run({ scenario: mutateScenario, flow: mutateFlow, blocks: mutateBlocks } = {}) {
      const scenario = JSON.parse(baseScenario);
      if (mutateScenario) mutateScenario(scenario);
      fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
      fs.writeFileSync(flowPath, mutateFlow ? mutateFlow(baseFlow) : baseFlow);
      fs.writeFileSync(blocksPath, mutateBlocks ? mutateBlocks(baseBlocks) : baseBlocks);
      return spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    }

    const optionalSearch = run({ scenario(scenario) {
      delete scenario.apps[0].search;
      delete scenario.contents[0].search;
    } });
    assert.equal(optionalSearch.status, 0, optionalSearch.stderr);

    const unknownKey = run({ scenario(scenario) { scenario.apps[0].lable = "誤記"; } });
    assert.equal(unknownKey.status, 1);
    assert.match(unknownKey.stderr, /未知のkeyです: lable/u);

    const reservedSearchAppId = run({ scenario(scenario) { scenario.apps[0].id = "search_agent"; } });
    assert.equal(reservedSearchAppId.status, 1);
    assert.match(reservedSearchAppId.stderr, /app id が不正または予約済みです: search_agent/u);

    const removedSearchResponses = run({ scenario(scenario) { scenario.searchResponses = []; } });
    assert.equal(removedSearchResponses.status, 1);
    assert.match(removedSearchResponses.stderr, /未知のkeyです: searchResponses/u);

    const fixedSearchTalkShape = run({ scenario(scenario) {
      const searchTalk = scenario.talks.find((talk) => talk.id === "search_agent");
      searchTalk.label = "個別指定しない";
      searchTalk.startSteps = ["/search 初期検索", "intro"];
    } });
    assert.equal(fixedSearchTalkShape.status, 1);
    assert.match(fixedSearchTalkShape.stderr, /未知のkeyです: label/u);
    assert.match(fixedSearchTalkShape.stderr, /startStepsではblockと\/inputだけ/u);

    const invalidSearchTalkDiscriminator = run({ scenario(scenario) {
      scenario.talks.find((talk) => talk.id === "search_agent").kind = "sms";
    } });
    assert.equal(invalidSearchTalkDiscriminator.status, 1);
    assert.match(invalidSearchTalkDiscriminator.stderr, /id と kind をともに search_agent/u);

    const reservedSearchPerson = run({ scenario(scenario) {
      scenario.talkPeople.push({ id: "search_agent", name: "重複名", role: "npc" });
    } });
    assert.equal(reservedSearchPerson.status, 1);
    assert.match(reservedSearchPerson.stderr, /project.assistantNameから自動生成される予約ID/u);

    const searchTalkNotification = run({ scenario(scenario) {
      scenario.notifications[0].targetTalkId = "search_agent";
    } });
    assert.equal(searchTalkNotification.status, 1);
    assert.match(searchTalkNotification.stderr, /targetTalkId が未定義またはアプリに属さないtalk/u);

    const crossAppTalkNotification = run({ scenario(scenario) {
      scenario.notifications[0].appId = "messages";
      scenario.notifications[0].targetTalkId = "lobby";
      delete scenario.notifications[0].targetContentId;
    } });
    assert.equal(crossAppTalkNotification.status, 1);
    assert.match(crossAppTalkNotification.stderr, /notification\.appIdと同じアプリのtalk/u);

    const crossAppContentNotification = run({ scenario(scenario) {
      scenario.notifications[0].appId = "messages";
      scenario.notifications[0].targetContentId = "welcome_note";
      delete scenario.notifications[0].targetTalkId;
    } });
    assert.equal(crossAppContentNotification.status, 1);
    assert.match(crossAppContentNotification.stderr, /notification\.appIdと同じアプリの対象/u);

    const searchTalkContentHook = run({ scenario(scenario) {
      scenario.hooks.push({ event: "content_opened", target: "search_agent", handler: "mark_session_started" });
    } });
    assert.equal(searchTalkContentHook.status, 1);
    assert.match(searchTalkContentHook.stderr, /targetが未定義です/u);

    const searchTalkMessageLink = run({ blocks(blocks) {
      return blocks.replace("open:notes:welcome_note", "open:messages:search_agent");
    } });
    assert.equal(searchTalkMessageLink.status, 1);
    assert.match(searchTalkMessageLink.stderr, /メッセージリンクの対象が未定義です/u);

    const crossAppMessageLink = run({ blocks(blocks) {
      return blocks.replace("open:notes:welcome_note", "open:chat:welcome_note");
    } });
    assert.equal(crossAppMessageLink.status, 1);
    assert.match(crossAppMessageLink.stderr, /メッセージリンクは対象と同じアプリ/u);

    const supportedSearchMessageLink = run({ blocks(blocks) {
      return blocks.replace(
        "検索とデモ全体の案内を担当するよ。まずは「古いメモ」を探してみよう。",
        "[操作ガイド](open:notes:welcome_note)"
      );
    } });
    assert.equal(supportedSearchMessageLink.status, 0, supportedSearchMessageLink.stderr);
    const normalizedSearchMessageLink = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `import(${JSON.stringify(new URL("./helpers/authoring-fixture.mjs", import.meta.url).href)}).then(({ loadAndValidateScenario }) => {
        const block = loadAndValidateScenario().worker.talkBlocks.find((item) => item.id === "search_agent::intro");
        console.log(JSON.stringify(block.messages[0].segments));
      })`
    ], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(normalizedSearchMessageLink.status, 0, normalizedSearchMessageLink.stderr);
    const searchSegments = JSON.parse(normalizedSearchMessageLink.stdout);
    assert.equal(searchSegments[0].contentId, "welcome_note");
    assert.match(searchSegments[0].linkId, /^search-link_[a-f0-9]{12}$/u);

    const unsupportedSearchMessageFields = run({ blocks(blocks) {
      return blocks.replace(
        "\tsearch_agent\t検索とデモ全体の案内を担当するよ。まずは「古いメモ」を探してみよう。\t\t\t350",
        "\towner\t[外部](https://example.com)\t\t20:14\t350"
      );
    } });
    assert.equal(unsupportedSearchMessageFields.status, 1);
    assert.match(unsupportedSearchMessageFields.stderr, /senderはsearch_agent/u);
    assert.match(unsupportedSearchMessageFields.stderr, /本文、内部リンク、Quick Replyだけ/u);
    assert.match(unsupportedSearchMessageFields.stderr, /発話時刻は実行時に決まる/u);

    const invalidSearchInputOrder = run({ scenario(scenario) {
      scenario.talks.find((talk) => talk.id === "search_agent").startSteps = ["/input show", "intro", "/input hide"];
    } });
    assert.equal(invalidSearchInputOrder.status, 1);
    assert.match(invalidSearchInputOrder.stderr, /\/input hide は表示stepより前/u);

    const ephemeralWithoutSearch = run({ flow(flow) {
      return flow.replace("/search {{player_input}}", "");
    } });
    assert.equal(ephemeralWithoutSearch.status, 1);
    assert.match(ephemeralWithoutSearch.stderr, /未定義.*search_found/u);

    const reservedSearchMatchId = run({
      scenario(scenario) { scenario.features.llm = true; },
      flow(flow) {
        const lines = flow.split("\n");
        const lineIndex = lines.findIndex((line) => line.startsWith("\tsearch_agent\tintro\t") && line.includes("\tmatch\t"));
        const cells = lines[lineIndex].split("\t");
        cells[lines[0].split("\t").indexOf("extract")] = JSON.stringify({ search_found: { rule: "検索結果の有無", null: "ok" } });
        lines[lineIndex] = cells.join("\t");
        return lines.join("\n");
      }
    });
    assert.equal(reservedSearchMatchId.status, 1);
    assert.match(reservedSearchMatchId.stderr, /search_agentのmatch IDに予約名を使用できません: search_found/u);

    const deviceSearchCommand = run({ flow(flow) {
      return flow.replace("\tmessage_reply\tstay", "\t/search 記録\tstay");
    } });
    assert.equal(deviceSearchCommand.status, 1);
    assert.match(deviceSearchCommand.stderr, /\/search と \/if はsearch_agentのnextだけ/u);

    const searchGameOver = run({ flow(flow) {
      const lines = flow.split("\n");
      const lineIndex = lines.findIndex((line) => line.startsWith("\tsearch_agent\tintro\t!old_note_opened\t"));
      const cells = lines[lineIndex].split("\t");
      cells[lines[0].split("\t").indexOf("mode")] = "game_over";
      lines[lineIndex] = cells.join("\t");
      return lines.join("\n");
    } });
    assert.equal(searchGameOver.status, 1);
    assert.match(searchGameOver.stderr, /search_agentではmode=game_overを使用できません/u);

    const searchReadOnlyEndingInInput = run({ flow(flow) {
      const lines = flow.split("\n");
      const lineIndex = lines.findIndex((line) => line.startsWith("\tsearch_agent\tintro\t!old_note_opened\t"));
      const cells = lines[lineIndex].split("\t");
      cells[lines[0].split("\t").indexOf("next")] = '"hint_first\n/input show"';
      cells[lines[0].split("\t").indexOf("mode")] = "";
      lines[lineIndex] = cells.join("\t");
      return lines.join("\n");
    } });
    assert.equal(searchReadOnlyEndingInInput.status, 0, "ruleなし終点＋入力UI設定は正当な読み取り専用遷移");

    const invalidProjectApp = run({ scenario(scenario) {
      scenario.apps.push({ id: "case_files", label: "事件資料", accent: "#777", initialState: "normal", search: [] });
      scenario.contents.push({ id: "case_file", appId: "case_files", initialState: "normal", search: [], record: { title: "資料" } });
    } });
    assert.equal(invalidProjectApp.status, 1);
    assert.match(invalidProjectApp.stderr, /record.body は文字列/u);

    const longBody = run({ scenario(scenario) {
      scenario.contents.find((content) => content.appId === "notes").record.body = "あ".repeat(4_001);
    } });
    assert.equal(longBody.status, 1);
    assert.match(longBody.stderr, /record.body は4000文字以内/u);

    const inherited = run({ flow(flow) {
      const lines = flow.split("\n");
      const cells = lines[2].split("\t");
      cells[1] = "";
      cells[2] = "";
      lines[2] = cells.join("\t");
      return lines.join("\n");
    } });
    assert.equal(inherited.status, 0, inherited.stderr);

    const badHeader = run({ flow(flow) { return flow.replace(/^comment\t/u, "coment\t"); } });
    assert.equal(badHeader.status, 1);
    assert.match(badHeader.stderr, /必須headerがありません: comment|未知または廃止済みのheaderです: coment/u);

    const unclosedQuote = run({ blocks(blocks) { return blocks.replace(/\nヘルプ"\s*$/u, "\nヘルプ"); } });
    assert.equal(unclosedQuote.status, 1);
    assert.match(unclosedQuote.stderr, /引用符が閉じていません/u);

    const invalidMetadata = run({ blocks(blocks) { return blocks.replace(/\thuman\n/u, "\tlegacy\n"); } });
    assert.equal(invalidMetadata.status, 1);
    assert.match(invalidMetadata.stderr, /source は human \/ ai \/ ai_edited/u);

    const badTemplate = run({ blocks(blocks) { return blocks.replace("メッセージアプリ固有の送受信", "{{missing_template}}の送受信"); } });
    assert.equal(badTemplate.status, 1);
    assert.match(badTemplate.stderr, /未定義template \{\{missing_template\}\}/u);

    const validStateTemplate = run({ blocks(blocks) {
      return blocks.replace("メッセージアプリ固有の送受信", "{{session_started}}の送受信");
    } });
    assert.equal(validStateTemplate.status, 0, validStateTemplate.stderr);

    const validMatchTemplate = run({
      scenario(scenario) { scenario.features.llm = true; },
      flow(flow) {
        const lines = flow.split("\n");
        const lineIndex = lines.findIndex((line) => line.startsWith("\tguide\tintro\t") && line.includes("\tdefault\t"));
        const cells = lines[lineIndex].split("\t");
        cells[4] = "ゲームオーバー確認";
        const columns = lines[0].split("\t");
        cells[columns.indexOf("type")] = "match";
        cells[columns.indexOf("text")] = "/^終了$/u";
        cells[columns.indexOf("example")] = "終了";
        cells[columns.indexOf("extract")] = JSON.stringify({ topic: "話題" });
        cells[columns.indexOf("next")] = "game_over_test";
        cells[columns.indexOf("mode")] = "game_over";
        lines.splice(lineIndex, 0, cells.join("\t"));
        return lines.join("\n");
      },
      blocks(blocks) {
        return blocks.replace("*lobby", "game_over_test\n\tguide\t{{topic}}のゲームオーバー演出デモです。\t\t\t500\t\t2026-08-12\thuman\n*lobby");
      }
    });
    assert.equal(validMatchTemplate.status, 0, validMatchTemplate.stderr);
    const scenarioLibUrl = new URL("./helpers/authoring-fixture.mjs", import.meta.url).href;
    const hookBlockGeneration = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `import(${JSON.stringify(scenarioLibUrl)}).then(({ loadAndValidateScenario }) => {
        console.log(JSON.stringify(loadAndValidateScenario().hookTalkBlocksByTalk.guide));
      })`
    ], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(hookBlockGeneration.status, 0, hookBlockGeneration.stderr);
    assert.equal(JSON.parse(hookBlockGeneration.stdout).includes("game_over_reply"), false);

    const invalidTemplateIdentifier = run({ blocks(blocks) { return blocks.replace("メッセージアプリ固有の送受信", "{{bad-key}}の送受信"); } });
    assert.equal(invalidTemplateIdentifier.status, 1);
    assert.match(invalidTemplateIdentifier.stderr, /template構文が不正です: placeholderの識別子が不正です/u);

    const unclosedTemplate = run({ blocks(blocks) { return blocks.replace("メッセージアプリ固有の送受信", "{{missing_templateの送受信"); } });
    assert.equal(unclosedTemplate.status, 1);
    assert.match(unclosedTemplate.stderr, /template構文が不正です: 閉じる \}\} がありません/u);

    const numericTemplateIdentifier = run({ blocks(blocks) { return blocks.replace("メッセージアプリ固有の送受信", "{{1bad}}の送受信"); } });
    assert.equal(numericTemplateIdentifier.status, 1);
    assert.match(numericTemplateIdentifier.stderr, /未定義template \{\{1bad\}\}/u);

    const canonicalRegex = run({ flow(flow) { return flow.replace("/^(?:help|ヘルプ)$/i", "/a/b/i"); } });
    assert.equal(canonicalRegex.status, 1);
    assert.match(canonicalRegex.stderr, /flags は d\/g\/i\/m\/s\/u\/v\/y だけを使ってください/u);

    const invalidCoreHookTargets = run({ scenario(scenario) {
      scenario.hooks.find((hook) => hook.event === "audio_playback_completed").target = "missing_content";
      scenario.contents.find((content) => content.id === "sample_radio").record.audioCues = [{ id: "known_cue", atMs: 1_000 }];
      scenario.hooks.push({
        event: "audio_cue_reached",
        target: "sample_radio:missing_cue",
        handler: "mark_radio_playback_completed"
      });
      delete scenario.hooks.find((hook) => hook.event === "message_link_opened").target;
      delete scenario.hooks.find((hook) => hook.event === "scheduled_event").target;
    } });
    assert.equal(invalidCoreHookTargets.status, 1);
    assert.match(invalidCoreHookTargets.stderr, /content targetが未定義です/u);
    assert.match(invalidCoreHookTargets.stderr, /audio cue targetが未定義です/u);
    assert.match(invalidCoreHookTargets.stderr, /message_link_opened のtargetは必須です/u);
    assert.match(invalidCoreHookTargets.stderr, /scheduled_event のtargetは必須です/u);

    const approvedHookTargets = run({ scenario(scenario) {
      scenario.hooks.push(
        { event: "blocked_content_link_opened", target: "*", handler: "mark_session_started" },
        { event: "content_opened", target: "notes", handler: "mark_session_started" },
        { event: "content_opened", target: "guide", handler: "mark_session_started" },
        { event: "content_opened", handler: "mark_session_started" },
        { event: "talk_turn_completed", target: "search_agent", handler: "mark_session_started" }
      );
    } });
    assert.equal(approvedHookTargets.status, 0, approvedHookTargets.stderr);

    const badLink = run({ blocks(blocks) { return blocks.replace("メッセージアプリ固有の送受信", "[壊れたリンク](invalid)"); } });
    assert.equal(badLink.status, 1);
    assert.match(badLink.stderr, /メッセージリンクが不正です/u);

    const documentAttachment = run({ scenario(scenario) {
      scenario.attachments.push({
        id: "document_test",
        type: "document",
        content: "sealed_note",
        lock: "password",
        title: "文書",
        body: "復元された文書本文"
      });
    } });
    assert.equal(documentAttachment.status, 0, documentAttachment.stderr);

    const radioCue = run({ scenario(scenario) {
      scenario.contents.find((content) => content.id === "sample_radio").record.audioCues = [{ id: "formatted", at: "01:02.5" }];
    } });
    assert.equal(radioCue.status, 0, radioCue.stderr);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("作品Stageには明示した状態変数だけを公開する", async () => {
  workerScenario.publicStateVariables.push("image_color_reported");
  try {
    const state = createInitialPlayerState();
    assert.deepEqual((await publicPlayerState(state, 1)).projectState, { image_color_reported: false });
    state.stateValues.image_color_reported = true;
    assert.deepEqual((await publicPlayerState(state, 2)).projectState, { image_color_reported: true });
    assert.equal("old_note_opened" in (await publicPlayerState(state, 2)).projectState, false);
  } finally {
    workerScenario.publicStateVariables.pop();
  }
});

test("player revisionは検索AI talkを含む進行状態の変化を検知する", async () => {
  const initial = createInitialPlayerState();
  const initialRevision = await playerStateRevision(initial);
  const searchTalk = workerScenario.talks.find((talk) => talk.kind === "search_agent");
  assert.ok(searchTalk);
  const searched = structuredClone(initial);
  searched.talks[searchTalk.id] = (await initializeSearchAgentTalkState(searchTalk, "revision-test", searched)).state;
  assert.notEqual(await playerStateRevision(searched), initialRevision);

  const progressed = structuredClone(initial);
  progressed.stateValues.old_note_opened = true;
  assert.notEqual(await playerStateRevision(progressed), initialRevision);
  assert.notEqual((await publicPlayerState(progressed, 1)).revision, workerScenario.revision);
  assert.equal((await publicPlayerState(progressed, 1)).clientRevision, workerScenario.clientRevision);
  assert.equal((await publicPlayerState(progressed, 1)).transcriptRevision, workerScenario.transcriptRevision);
});

test("clientと会話履歴のrevisionは変更責務を分離する", () => {
  const clientInput = {
    packageVersion: "1.0.0",
    projectConstants: { name: "公開設定" },
    deviceState: { apps: [] },
    publicIds: { content: { note: "public-note" } },
    source: [["src/client/main.ts", "client source"]]
  };
  const transcriptInput = {
    version: 1,
    talks: [{ id: "talk", publicId: "public-talk" }],
    talkPeople: [],
    talkBlocks: [{ id: "talk::start", messages: [{ body: "本文" }] }],
    attachments: [],
    publicIds: { content: {}, talk: { talk: "public-talk" }, attachment: {} },
    runtime: [["src/worker/talkEvents.ts", "runtime"]]
  };
  assert.notEqual(
    clientRevisionFor(clientInput),
    clientRevisionFor({ ...clientInput, source: [["src/client/main.ts", "changed"]] })
  );
  assert.equal(
    clientRevisionFor(clientInput),
    clientRevisionFor({ ...clientInput, privatePin: "1234", privateSearch: ["秘密"] })
  );
  assert.notEqual(
    transcriptRevisionFor(transcriptInput),
    transcriptRevisionFor({ ...transcriptInput, talkBlocks: [{ id: "talk::start", messages: [{ body: "更新後" }] }] })
  );
  assert.equal(
    transcriptRevisionFor(transcriptInput),
    transcriptRevisionFor({ ...transcriptInput, privatePin: "1234", privateSearch: ["秘密"] })
  );
});

test("初期会話の本文と省略時刻は初期化時点で固定する", async () => {
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  const block = workerScenario.talkBlocks.find((item) => item.id === talk?.startBlocks.at(-1));
  const message = block?.messages[0];
  assert.ok(talk && message);
  const originalBody = message.body;
  const originalSentAt = message.sentAt;
  const originalInitial = workerScenario.stateVariables.test_initial_value;
  try {
    message.body = "{{test_initial_value}}";
    message.sentAt = "";
    workerScenario.stateVariables.test_initial_value = "初期値";
    const initialized = initializeTalkState(talk, "initial-turn", {
      ...workerScenario.stateVariables,
      test_initial_value: "初期値"
    });
    const state = createInitialPlayerState();
    state.talks[talk.id] = initialized.state;
    state.stateValues.test_initial_value = "変更後";
    const thread = (await publicPlayerState(state, 1)).visibleDeviceState.messages.find((item) => item.id === talk.publicId);
    const rendered = thread?.messages.find((item) => item.body === "初期値");
    assert.equal(rendered?.body, "初期値");
    assert.equal(rendered?.sentAt, "");
  } finally {
    message.body = originalBody;
    message.sentAt = originalSentAt;
    if (originalInitial === undefined) delete workerScenario.stateVariables.test_initial_value;
    else workerScenario.stateVariables.test_initial_value = originalInitial;
  }
});

test("未到達の本文とtalkは初期応答へ含めず、利用可能になった時だけ差分で返す", async () => {
  const initial = await reconcileScenarioState(createInitialPlayerState(), "player-1");
  const initialPublic = await publicPlayerState(initial.state, 1, [], null, initial.transcriptAppends);
  const serialized = JSON.stringify(initialPublic);
  assert.doesNotMatch(serialized, /そのままナビに色を伝えて/u);
  assert.doesNotMatch(serialized, /パスワードは「0420」/u);
  assert.equal(initial.state.talks.lobby, undefined);
  assert.equal(initialPublic.talks.some((talk) => talk.talkId === workerScenario.publicIds.talk.lobby), false);
  const corruptedNote = initialPublic.visibleDeviceState.notes.find((note) => note.id === workerScenario.publicIds.content.old_note);
  assert.equal(corruptedNote?.corrupted, true);
  assert.equal("imageUrl" in (corruptedNote ?? {}), false);
  assert.equal("tags" in (corruptedNote ?? {}), false);

  const corruptedMail = initialPublic.visibleDeviceState.mails.find((mail) => mail.id === workerScenario.publicIds.content.damaged_mail);
  assert.equal(corruptedMail?.corrupted, true);
  assert.equal(corruptedMail?.subject, "未▚▐▀▜メール");
  assert.equal("cc" in (corruptedMail ?? {}), false);
  assert.equal(serialized.includes("修復されたメール"), false);
  assert.equal(serialized.includes("確認担当"), false);

  const corruptedPhoto = initialPublic.visibleDeviceState.photos.find((photo) => photo.id === workerScenario.publicIds.content.rainy_window);
  assert.equal(corruptedPhoto?.corrupted, true);
  assert.equal("imageUrl" in (corruptedPhoto ?? {}), false);
  assert.equal("tags" in (corruptedPhoto ?? {}), false);

  const corruptedBrowserTab = initialPublic.visibleDeviceState.browserTabs.find((tab) => tab.id === workerScenario.publicIds.content.browser_archive);
  assert.equal(corruptedBrowserTab?.corrupted, true);
  assert.equal("url" in (corruptedBrowserTab ?? {}), false);
  assert.equal(serialized.includes("archive-k7m2q.html"), false);

  const welcomeNote = initialPublic.visibleDeviceState.notes.find((note) => note.id === workerScenario.publicIds.content.welcome_note);
  assert.deepEqual(welcomeNote?.tags, ["案内", "操作"]);

  const repairedState = structuredClone(initial.state);
  repairedState.repairedContentIds.push("old_note", "damaged_mail", "rainy_window", "browser_archive");
  const repairedPublic = await publicPlayerState(repairedState, 2);
  const repairedNote = repairedPublic.visibleDeviceState.notes.find((note) => note.id === workerScenario.publicIds.content.old_note);
  assert.deepEqual(repairedNote?.tags, ["操作", "画像"]);
  const repairedMail = repairedPublic.visibleDeviceState.mails.find((mail) => mail.id === workerScenario.publicIds.content.damaged_mail);
  assert.equal(repairedMail?.subject, "修復されたメール");
  assert.equal(repairedMail?.from, "確認担当");
  assert.equal(repairedMail?.to, "プレイヤー");
  assert.equal(repairedMail?.cc, "デモ運営");
  assert.equal(searchScenario("未整理メール", repairedState).some((result) => result.title === "修復されたメール"), true);
  const repairedPhoto = repairedPublic.visibleDeviceState.photos.find((photo) => photo.id === workerScenario.publicIds.content.rainy_window);
  assert.equal(repairedPhoto?.imageUrl, "/demo/album/rainy-window.webp");
  assert.deepEqual(repairedPhoto?.tags, ["雨", "窓"]);
  const repairedBrowserTab = repairedPublic.visibleDeviceState.browserTabs.find((tab) => tab.id === workerScenario.publicIds.content.browser_archive);
  assert.equal(repairedBrowserTab?.url, "/demo/browser/archive-k7m2q.html");

  const reachedState = structuredClone(initial.state);
  reachedState.stateValues.sealed_note_unlocked = true;
  reachedState.repairedAppIds.push("chat");
  const reached = await reconcileScenarioState(reachedState, "player-1");
  assert.ok(reached.state.talks.lobby);
  assert.equal(reached.transcriptAppends.some((delta) => delta.streamId === "talk:lobby"), false);
  const reachedPublic = await publicPlayerState(reached.state, 3);
  assert.ok(reachedPublic.visibleDeviceState.chatThreads.some((thread) => thread.id === workerScenario.publicIds.talk.lobby));
});

test("予約状態変数から作中の日付と時刻を公開する", async () => {
  const state = createInitialPlayerState();
  assert.deepEqual((await publicPlayerState(state, 1)).scenarioTime, { date: "2026-08-12", timeLabel: "20:14" });
  state.stateValues.os_date = "2026-08-13";
  state.stateValues.os_time_label = "08:05";
  assert.deepEqual((await publicPlayerState(state, 2)).scenarioTime, { date: "2026-08-13", timeLabel: "08:05" });
});

test("未修復の親アプリに属するコンテンツも検索候補へ出し、開く段階で止める", () => {
  const source = workerScenario.contents.find((content) => content.id === "old_note");
  assert.ok(source);
  const testContent = {
    ...source,
    id: "test_unavailable_parent_content",
    publicId: "test-unavailable-parent-content",
    appId: "chat",
    cond: "image_color_reported",
    search: ["未修復親アプリ確認"]
  };
  workerScenario.contents.push(testContent);

  try {
    const state = createInitialPlayerState();
    state.stateValues.image_color_reported = true;
    state.stateValues.sealed_note_unlocked = true;
    assert.equal(searchScenario("未修復親アプリ確認", state).some((result) => result.contentId === testContent.publicId), true);
    assert.equal(appAvailable("chat", state), false);

    state.repairedAppIds.push("chat");
    assert.equal(searchScenario("未修復親アプリ確認", state).some((result) => result.contentId === testContent.publicId), true);
    assert.equal(appAvailable("chat", state), true);
  } finally {
    workerScenario.contents.splice(workerScenario.contents.indexOf(testContent), 1);
  }
});

test("親修復を選んだ作品だけ通常ルームの検索結果に修復の必要性を示す", () => {
  const previous = workerScenario.project.repairParentApp;
  try {
    const state = createInitialPlayerState();
    state.stateValues.sealed_note_unlocked = true;
    const result = () => searchScenario("サンプルルーム", state).find(item => item.contentId === workerScenario.publicIds.talk.lobby);
    workerScenario.project.repairParentApp = false;
    assert.equal(result()?.repairable, false);
    workerScenario.project.repairParentApp = true;
    assert.equal(result()?.repairable, true);
    state.repairedAppIds.push("chat");
    assert.equal(result()?.repairable, false, "親が直れば通常ルームは修復対象でなくなる");
  } finally { workerScenario.project.repairParentApp = previous; }
});

test("検索語はNFKCで正規化し、入れ子配列だけをAND条件として扱う", () => {
  const source = workerScenario.contents.find((content) => content.id === "old_note");
  assert.ok(source);
  const testContent = {
    ...source,
    id: "test_grouped_search_content",
    publicId: "test-grouped-search-content",
    cond: "",
    search: [["ＡＢＣ", "手掛かり"], "別名"]
  };
  workerScenario.contents.push(testContent);

  try {
    const state = createInitialPlayerState();
    assert.equal(searchScenario("abcの手掛かり", state).some((result) => result.contentId === testContent.publicId), true);
    assert.equal(searchScenario("abc", state).some((result) => result.contentId === testContent.publicId), false);
    assert.equal(searchScenario("別名", state).some((result) => result.contentId === testContent.publicId), true);
    assert.equal(searchScenario("別", state).some((result) => result.contentId === testContent.publicId), false);
  } finally {
    workerScenario.contents.splice(workerScenario.contents.indexOf(testContent), 1);
  }
});

test("同一イベントのhook condは各script直前に最新の状態で評価する", async () => {
  workerScenario.stateVariables.test_hook_snapshot = false;
  workerScenario.stateVariables.test_hook_cascade = false;
  const firstHook = { event: "test_hook_snapshot", target: "", handler: "test_hook_snapshot_first", cond: "", llm: false };
  const secondHook = { event: "test_hook_snapshot", target: "", handler: "test_hook_snapshot_second", cond: "test_hook_snapshot", llm: false };
  workerScenario.hooks.push(firstHook, secondHook);
  scenarioHookHandlers.test_hook_snapshot_first = (context) => context.state.set("test_hook_snapshot", true);
  scenarioHookHandlers.test_hook_snapshot_second = (context) => context.state.set("test_hook_cascade", true);

  try {
    const result = await runScenarioHooks(createInitialPlayerState(), {
      eventId: "test_hook_snapshot"
    });
    assert.equal(result.state.stateValues.test_hook_snapshot, true);
    assert.equal(result.state.stateValues.test_hook_cascade, true);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(firstHook), 2);
    delete scenarioHookHandlers.test_hook_snapshot_first;
    delete scenarioHookHandlers.test_hook_snapshot_second;
    delete workerScenario.stateVariables.test_hook_snapshot;
    delete workerScenario.stateVariables.test_hook_cascade;
  }
});

test("custom hookのtargetは定義済みの優先順で解決しevent IDへfallbackしない", async () => {
  const hook = { event: "test_custom_target", target: "", handler: "test_custom_target", cond: "", llm: false };
  let calls = 0;
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_custom_target = () => { calls += 1; };
  try {
    const cases = [
      [{ scheduleId: "schedule", cueTarget: "cue", actionId: "action", formId: "form", contentId: "content", callId: "call", talkId: "talk" }, "schedule"],
      [{ scheduleId: "", cueTarget: "cue" }, "cue"],
      [{ cueTarget: "cue", actionId: "action", formId: "form", contentId: "content", callId: "call", talkId: "talk" }, "cue"],
      [{ actionId: "action", formId: "form", contentId: "content", callId: "call", talkId: "talk" }, "action"],
      [{ formId: "form", contentId: "content", callId: "call", talkId: "talk" }, "form"],
      [{ contentId: "content", callId: "call", talkId: "talk" }, "content"],
      [{ callId: "call", talkId: "talk" }, "call"],
      [{ talkId: "talk" }, "talk"]
    ];
    for (const [fields, expectedTarget] of cases) {
      hook.target = expectedTarget;
      await runScenarioHooks(createInitialPlayerState(), { eventId: "test_custom_target", ...fields });
    }
    assert.equal(calls, cases.length);

    hook.target = "test_custom_target";
    await runScenarioHooks(createInitialPlayerState(), { eventId: "test_custom_target" });
    assert.equal(calls, cases.length);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_custom_target;
  }
});

test("hookは順序付きeffectとしてaddBlock時点のenvと表示順を固定する", async () => {
  const block = workerScenario.talkBlocks.find((item) => item.talkId === "guide" && item.blockKey === "message_test_ack");
  const message = block?.messages[0];
  assert.ok(block && message);
  const originalBody = message.body;
  workerScenario.stateVariables.test_hook_value = "初期";
  workerScenario.stateVariableDefinitions.test_hook_value = { type: "string" };
  const hook = { event: "test_hook_order", target: "", handler: "test_hook_order", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  message.body = "{{test_hook_value}}";
  scenarioHookHandlers.test_hook_order = (context) => {
    context.state.set("test_hook_value", "発話時");
    context.talk.addBlock("guide", "message_test_ack");
    context.talk.addBlock("guide", "message_reply");
    context.state.set("test_hook_value", "発話後");
  };
  try {
    const baseSentAt = "2026-08-12T20:14:01.001Z";
    const result = await runScenarioHooks(createInitialPlayerState(), { eventId: "test_hook_order" }, {
      messageBaseSentAtByTalk: { guide: baseSentAt }
    });
    const append = result.transcriptAppends.find((item) => item.streamId === "talk:guide");
    const events = append?.messages.filter((item) => "event_type" in item) ?? [];
    const resolved = append?.resolvedMessages ?? [];
    assert.equal(result.state.stateValues.test_hook_value, "発話後");
    assert.equal(resolved[0]?.body, "発話時");
    assert.equal(events[0]?.delivered_at, baseSentAt);
    assert.ok(Date.parse(events[1]?.delivered_at ?? "") > Date.parse(resolved[0]?.sentAt ?? ""));
    assert.equal(result.state.talks.guide.from, "guide::message_reply");
  } finally {
    message.body = originalBody;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete workerScenario.stateVariables.test_hook_value;
    delete workerScenario.stateVariableDefinitions.test_hook_value;
    delete scenarioHookHandlers.test_hook_order;
  }
});

test("hookのrepeat表示は派生blockで必要なenvを呼出時点から保存する", async () => {
  const baseBlock = workerScenario.talkBlocks.find((item) => item.talkId === "guide" && item.blockKey === "message_reply");
  const repeatBlockId = baseBlock ? workerScenario.repeatTalkBlocks[baseBlock.id]?.[0] : undefined;
  const repeatBlock = workerScenario.talkBlocks.find((item) => item.id === repeatBlockId);
  const repeatMessage = repeatBlock?.messages[0];
  assert.ok(baseBlock && repeatBlock && repeatMessage);
  const originalBody = repeatMessage.body;
  workerScenario.stateVariables.test_hook_repeat_value = "初期";
  workerScenario.stateVariableDefinitions.test_hook_repeat_value = { type: "string" };
  const hook = { event: "test_hook_repeat_env", target: "", handler: "test_hook_repeat_env", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  repeatMessage.body = "{{test_hook_repeat_value}}";
  scenarioHookHandlers.test_hook_repeat_env = (context) => {
    context.state.set("test_hook_repeat_value", "呼出時");
    context.talk.addBlock("guide", "message_reply", { mode: "stay" });
    context.state.set("test_hook_repeat_value", "発話後");
  };
  try {
    const initial = (await reconcileScenarioState(createInitialPlayerState(), "test-hook-repeat-env")).state;
    initial.talks.guide.blockDisplayCounts[baseBlock.id] = 1;
    const result = await runScenarioHooks(initial, { eventId: "test_hook_repeat_env" });
    const append = result.transcriptAppends.find((item) => item.streamId === "talk:guide");
    const events = append?.messages.filter((item) => "event_type" in item) ?? [];
    const resolved = append?.resolvedMessages ?? [];
    assert.equal(result.state.stateValues.test_hook_repeat_value, "発話後");
    assert.equal(resolved.at(-1)?.body, "呼出時");
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0]?.format_env_json ?? "{}"), { test_hook_repeat_value: "呼出時" });
  } finally {
    repeatMessage.body = originalBody;
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete workerScenario.stateVariables.test_hook_repeat_value;
    delete workerScenario.stateVariableDefinitions.test_hook_repeat_value;
    delete scenarioHookHandlers.test_hook_repeat_env;
  }
});

test("hookのaddBlockは別talkのblockをruntimeでも拒否する", async () => {
  const hook = { event: "test_hook_block_scope", target: "", handler: "test_hook_block_scope", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_hook_block_scope = (context) => context.talk.addBlock("guide", "receiver_reply");
  try {
    await assert.rejects(
      () => runScenarioHooks(createInitialPlayerState(), { eventId: "test_hook_block_scope" }),
      /talk\.addBlockの指定が不正です: guide\/receiver_reply/u
    );
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_hook_block_scope;
  }
});

test("hookの公開拒否は先に記録した副作用も全て破棄する", async () => {
  workerScenario.stateVariables.test_hook_reject = false;
  workerScenario.stateVariableDefinitions.test_hook_reject = { type: "boolean" };
  const hook = { event: "test_hook_reject", target: "", handler: "test_hook_reject", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_hook_reject = (context) => {
    context.state.set("test_hook_reject", true);
    context.talk.addBlock("guide", "message_test_ack");
    context.schedule.after("show_demo_call", 100);
    context.effect.noise();
    context.form.deny("rejected");
  };
  try {
    const initial = createInitialPlayerState();
    const result = await runScenarioHooks(initial, { eventId: "test_hook_reject" });
    assert.equal(result.rejection?.error, "rejected");
    assert.equal(result.state, initial);
    assert.deepEqual(result.transcriptAppends, []);
    assert.deepEqual(result.scheduleEffects, []);
    assert.deepEqual(result.presentationEffects, []);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete workerScenario.stateVariables.test_hook_reject;
    delete workerScenario.stateVariableDefinitions.test_hook_reject;
    delete scenarioHookHandlers.test_hook_reject;
  }
});

test("前景hookはeffectを順番に返し、effectSequence以前の状態だけを保存する", async () => {
  workerScenario.stateVariables.test_effect_before = false;
  workerScenario.stateVariables.test_effect_after = false;
  workerScenario.stateVariableDefinitions.test_effect_before = { type: "boolean" };
  workerScenario.stateVariableDefinitions.test_effect_after = { type: "boolean" };
  const hook = { event: "test_presentation", target: "", handler: "test_presentation", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_presentation = (context) => {
    context.state.set("test_effect_before", true);
    context.effect.noise();
    context.effect.flash({
      fadeInMs: Number.NaN,
      holdMs: -20,
      fadeOutMs: Number.POSITIVE_INFINITY,
      intensity: Number.NaN,
      color: " #ABCDEF "
    });
    context.effect.blackout({ fadeInMs: -1, holdMs: 24_000, fadeOutMs: 0, intensity: 2 });
    context.effectSequence.allClear("radio", "sample_radio", false);
    context.state.set("test_effect_after", true);
  };
  try {
    const result = await runScenarioHooks(createInitialPlayerState(), { eventId: "test_presentation" });
    assert.equal(result.state.stateValues.test_effect_before, true);
    assert.equal(result.state.stateValues.test_effect_after, undefined);
    assert.deepEqual(result.presentationEffects, [
      { type: "noise", durationMs: 100 },
      {
        type: "flash",
        fadeInMs: 30,
        holdMs: 0,
        fadeOutMs: 270,
        intensity: 0.9,
        color: "#abcdef"
      },
      {
        type: "blackout",
        fadeInMs: 16,
        holdMs: 7_968,
        fadeOutMs: 16,
        intensity: 1
      }
    ]);
    assert.deepEqual(result.presentationSequence, {
      type: "all_clear",
      appId: "radio",
      contentId: "sample_radio",
      autoplay: false
    });
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_presentation;
    delete workerScenario.stateVariables.test_effect_before;
    delete workerScenario.stateVariables.test_effect_after;
    delete workerScenario.stateVariableDefinitions.test_effect_before;
    delete workerScenario.stateVariableDefinitions.test_effect_after;
  }
});

test("scheduled eventから一時演出を開始できない", async () => {
  const hook = { event: "scheduled_event", target: "test_presentation", handler: "test_scheduled_presentation", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_scheduled_presentation = (context) => context.effect.noise();
  try {
    await assert.rejects(
      () => runScenarioHooks(createInitialPlayerState(), { eventId: "scheduled_event", scheduleId: "test_presentation" }),
      /scheduled_eventではeffect\.noiseを使用できません/u
    );
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_scheduled_presentation;
  }
});

test("flashとblackoutの旧numeric形式は黙って既定値へ変換しない", async () => {
  const hook = { event: "test_numeric_presentation", target: "", handler: "test_numeric_presentation", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_numeric_presentation = (context) => context.effect.flash(300);
  try {
    await assert.rejects(
      () => runScenarioHooks(createInitialPlayerState(), { eventId: "test_numeric_presentation" }),
      /optionsはobject/u
    );
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_numeric_presentation;
  }
});

test("scheduled eventから入力用の公開拒否を返せない", async () => {
  const hook = { event: "scheduled_event", target: "test_scheduled_rejection", handler: "test_scheduled_rejection", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  try {
    for (const [handler, error] of [
      [(context) => context.form.deny("rejected"), /scheduled_eventではform\.denyを使用できません/u],
      [(context) => context.genAudio.reject("rejected"), /scheduled_eventではgenAudio\.rejectを使用できません/u]
    ]) {
      scenarioHookHandlers.test_scheduled_rejection = handler;
      await assert.rejects(
        () => runScenarioHooks(createInitialPlayerState(), { eventId: "scheduled_event", scheduleId: "test_scheduled_rejection" }),
        error
      );
    }
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_scheduled_rejection;
  }
});

test("同一hook dispatchで同じscheduleまたは生成音声を複数回操作できない", async () => {
  const hook = { event: "test_duplicate_effect", target: "", handler: "test_duplicate_effect", cond: "", llm: false };
  const secondHook = { event: "test_duplicate_effect", target: "", handler: "test_duplicate_effect_second", cond: "", llm: false };
  workerScenario.hooks.push(hook, secondHook);
  scenarioHookHandlers.test_duplicate_effect_second = () => {};
  try {
    for (const [handler, error] of [
      [
        (context) => {
          context.schedule.after("show_demo_call", 100, {}, "same_schedule");
          context.schedule.after("show_demo_call", 200, {}, "same_schedule");
        },
        /同じschedule instanceを複数回操作できません: same_schedule/u
      ],
      [
        (context) => {
          context.schedule.after("show_demo_call", 100, {}, "same_schedule");
          context.schedule.cancel("same_schedule");
        },
        /同じschedule instanceを複数回操作できません: same_schedule/u
      ],
      [
        (context) => {
          context.genAudio.prepare("demo_voice", { inputText: "1回目" });
          context.genAudio.prepare("demo_voice", { inputText: "2回目" });
        },
        /同じgenerated audioを複数回操作できません: demo_voice/u
      ]
    ]) {
      scenarioHookHandlers.test_duplicate_effect = handler;
      await assert.rejects(
        () => runScenarioHooks(createInitialPlayerState(), { eventId: "test_duplicate_effect" }),
        error
      );
    }

    scenarioHookHandlers.test_duplicate_effect = (context) => {
      context.schedule.after("show_demo_call", 100, {}, "same_schedule");
    };
    scenarioHookHandlers.test_duplicate_effect_second = (context) => {
      context.schedule.cancel("same_schedule");
    };
    await assert.rejects(
      () => runScenarioHooks(createInitialPlayerState(), { eventId: "test_duplicate_effect" }),
      /同じschedule instanceを複数回操作できません: same_schedule/u
    );
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(secondHook), 1);
    delete scenarioHookHandlers.test_duplicate_effect;
    delete scenarioHookHandlers.test_duplicate_effect_second;
  }
});

test("hook handlerがPromiseを返す場合は拒否する", async () => {
  const hook = { event: "test_async_hook", target: "", handler: "test_async_hook", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_async_hook = async () => {};
  try {
    await assert.rejects(() => runScenarioHooks(createInitialPlayerState(), { eventId: "test_async_hook" }), /同期関数/u);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_async_hook;
  }
});

test("同じ会話を先に開いても未成立の通知は消去しない", async () => {
  const guidePublicId = workerScenario.publicIds.talk.guide;
  const initialState = createInitialPlayerState();
  assert.deepEqual(notificationIdsForTarget(guidePublicId, initialState), []);

  const afterColorReport = {
    ...initialState,
    stateValues: {
      ...initialState.stateValues,
      image_color_reported: true
    }
  };
  assert.deepEqual(notificationIdsForTarget(guidePublicId, afterColorReport), ["clue_attachments"]);
  const clueNotificationId = (await publicPlayerState(afterColorReport, 1)).visibleDeviceState.notifications[0]?.id;
  assert.equal(clueNotificationId, workerScenario.publicIds.notification.clue_attachments);

  const afterAuthRequest = {
    ...afterColorReport,
    stateValues: {
      ...afterColorReport.stateValues,
      sealed_note_unlocked: true,
      chat_auth_link_sent: true
    }
  };
  assert.deepEqual(notificationIdsForTarget(guidePublicId, afterAuthRequest), ["chat_auth"]);
});

test("search agentはreconcile時に初期stepをcompact eventへ一度だけ生成する", async () => {
  const initial = createInitialPlayerState();
  const reconciled = await reconcileScenarioState(initial, "search-agent-player");
  const talk = reconciled.state.talks[SEARCH_AGENT_TALK_ID];
  assert.ok(talk);
  assert.equal(talk.from, "search_agent::intro");
  assert.equal(talk.inputVisible, true);
  assert.ok(talk.inputVisibleAfterSeq > 0);
  const append = reconciled.transcriptAppends.find((item) => item.streamId === SEARCH_AGENT_STREAM_ID);
  assert.ok(append);
  assert.deepEqual(append.messages.map((event) => event.event_type), ["message_block"]);
  assert.deepEqual(append.messages.map((event) => event.seq), [1]);
  assert.equal(append.messages.some((event) => event.id.includes("search-agent-player")), false);
  assert.equal("body" in append.messages[0], false);

  const second = await reconcileScenarioState(reconciled.state, "search-agent-player");
  assert.equal(second.transcriptAppends.some((item) => item.streamId === SEARCH_AGENT_STREAM_ID), false);
  const projected = await publicPlayerState(reconciled.state, 1, [], null, reconciled.transcriptAppends);
  const metadata = projected.talks.find((item) => item.kind === "search_agent");
  assert.equal(metadata?.inputVisible, true);
  assert.equal(projected.transcriptDeltas.find((item) => item.kind === "search_agent")?.messages.length, 1);
});

test("search agentの初期内部リンクは公開IDへ変換し、照合済み能力として記録する", async () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "search_agent::intro");
  const message = block?.messages[0];
  assert.ok(message);
  const previous = { body: message.body, segments: message.segments };
  message.body = "操作ガイド";
  message.segments = [{
    kind: "link",
    text: "操作ガイド",
    appId: "notes",
    contentId: "welcome_note",
    actionId: "private_action",
    linkId: "search-link_initial"
  }];
  try {
    const reconciled = await reconcileScenarioState(createInitialPlayerState(), "search-link-player");
    assert.deepEqual(reconciled.state.revealedMessageLinks, [{
      id: "search-link_initial",
      talkId: SEARCH_AGENT_TALK_ID,
      appId: "notes",
      contentId: "welcome_note",
      actionId: "private_action"
    }]);
    const projected = await publicPlayerState(reconciled.state, 1, [], null, reconciled.transcriptAppends);
    const publicMessage = projected.transcriptDeltas.find((item) => item.kind === "search_agent")?.messages[0];
    const publicLink = publicMessage?.kind === "message" ? publicMessage.segments?.[0] : undefined;
    assert.ok(publicLink && publicLink.kind === "link" && "contentId" in publicLink);
    assert.equal(publicLink.contentId, workerScenario.publicIds.content.welcome_note);
    assert.equal(publicLink.linkId, "search-link_initial");
    assert.equal("actionId" in publicLink, false);
  } finally {
    message.body = previous.body;
    message.segments = previous.segments;
  }
});

test("内部リンク先のdevice talk IDも公開IDへ変換する", () => {
  const message = publicTalkMessage({
    seq: 1,
    id: "public-talk-link-test",
    talkId: "guide",
    sender: "other",
    body: "サンプルルーム",
    segments: [{ kind: "link", text: "サンプルルーム", appId: "chat", contentId: "lobby", linkId: "talk-link" }],
    attachment: null,
    sentAt: "2026-08-12T00:00:00.000Z"
  });
  const link = message.segments?.[0];
  assert.ok(link && link.kind === "link" && "contentId" in link);
  assert.equal(link.contentId, workerScenario.publicIds.talk.lobby);
});

test("表示済みsearch blockへ追加・変更した内部リンク能力をreconcileする", async () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "search_agent::intro");
  const message = block?.messages[0];
  assert.ok(message);
  const previous = { body: message.body, segments: message.segments };
  const previousMode = workerScenario.playerMode;
  workerScenario.playerMode = "server";
  try {
    const initialized = await reconcileScenarioState(createInitialPlayerState(), "search-link-migration");
    assert.equal(initialized.state.revealedMessageLinks.length, 0);

    message.body = "操作ガイド";
    message.segments = [{
      kind: "link",
      text: "操作ガイド",
      appId: "notes",
      contentId: "welcome_note",
      linkId: "search-link_migrated_v1"
    }];
    const added = await reconcileScenarioState(initialized.state, "search-link-migration");
    assert.equal(added.state.revealedMessageLinks.some((item) => item.id === "search-link_migrated_v1"), true);

    message.segments = [{
      kind: "link",
      text: "機能テスト一覧",
      appId: "notes",
      contentId: "feature_test_guide",
      linkId: "search-link_migrated_v2"
    }];
    const changed = await reconcileScenarioState(added.state, "search-link-migration");
    assert.equal(changed.state.revealedMessageLinks.some((item) => item.id === "search-link_migrated_v1"), false);
    assert.equal(changed.state.revealedMessageLinks.some((item) => (
      item.id === "search-link_migrated_v2" && item.contentId === "feature_test_guide"
    )), true);
  } finally {
    workerScenario.playerMode = previousMode;
    message.body = previous.body;
    message.segments = previous.segments;
  }
});

test("browser modeはIndexedDBにない表示済みbase blockの新リンク能力を推測しない", async () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "search_agent::intro");
  const message = block?.messages[0];
  assert.ok(message);
  const previous = { body: message.body, segments: message.segments };
  const previousMode = workerScenario.playerMode;
  workerScenario.playerMode = "browser";
  try {
    const initialized = await reconcileScenarioState(createInitialPlayerState(), "search-link-browser-migration");
    message.body = "操作ガイド";
    message.segments = [{
      kind: "link",
      text: "操作ガイド",
      appId: "notes",
      contentId: "welcome_note",
      linkId: "search-link_browser_unseen"
    }];
    const reconciled = await reconcileScenarioState(initialized.state, "search-link-browser-migration");
    assert.equal(reconciled.state.revealedMessageLinks.some((item) => item.id === "search-link_browser_unseen"), false);
  } finally {
    workerScenario.playerMode = previousMode;
    message.body = previous.body;
    message.segments = previous.segments;
  }
});

test("後から追加されたsearch repeat variantの未表示リンク能力は推測しない", async () => {
  const base = workerScenario.talkBlocks.find((item) => item.id === "search_agent::intro");
  assert.ok(base);
  const repeatId = "search_agent::intro@2";
  const repeat = {
    ...structuredClone(base),
    id: repeatId,
    blockKey: "intro@2",
    repeatOf: base.id,
    repeatIndex: 2,
    messages: [{
      ...structuredClone(base.messages[0]),
      id: `${repeatId}_1`,
      body: "未表示リンク",
      segments: [{
        kind: "link",
        text: "未表示リンク",
        appId: "notes",
        contentId: "welcome_note",
        actionId: "hidden_action",
        linkId: "search-link_never_displayed"
      }]
    }]
  };
  const previousVariants = workerScenario.repeatTalkBlocks[base.id];
  const previousMode = workerScenario.playerMode;
  workerScenario.playerMode = "server";
  workerScenario.talkBlocks.push(repeat);
  workerScenario.repeatTalkBlocks[base.id] = [repeatId];
  try {
    const initialized = await reconcileScenarioState(createInitialPlayerState(), "search-repeat-migration");
    initialized.state.talks[SEARCH_AGENT_TALK_ID].blockDisplayCounts[base.id] = 2;
    const reconciled = await reconcileScenarioState(initialized.state, "search-repeat-migration");
    assert.equal(reconciled.state.revealedMessageLinks.some((item) => item.id === "search-link_never_displayed"), false);
  } finally {
    workerScenario.playerMode = previousMode;
    workerScenario.talkBlocks.splice(workerScenario.talkBlocks.indexOf(repeat), 1);
    if (previousVariants) workerScenario.repeatTalkBlocks[base.id] = previousVariants;
    else delete workerScenario.repeatTalkBlocks[base.id];
  }
});

test("hookがsearch agentを初期化する場合も初期リンク能力を記録する", async () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "search_agent::intro");
  const message = block?.messages[0];
  assert.ok(message);
  const previous = { body: message.body, segments: message.segments };
  message.body = "操作ガイド";
  message.segments = [{
    kind: "link",
    text: "操作ガイド",
    appId: "notes",
    contentId: "welcome_note",
    linkId: "search-link_hook_initial"
  }];
  const hook = { event: "test_search_agent_initialize", target: "", handler: "test_search_agent_initialize", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_search_agent_initialize = (context) => {
    context.talk.addBlock(SEARCH_AGENT_TALK_ID, "stage_photo", { mode: "stay" });
  };
  try {
    const result = await runScenarioHooks(createInitialPlayerState(), { eventId: hook.event }, { playerId: "search-link-init-hook" });
    assert.equal(result.state.revealedMessageLinks.some((item) => item.id === "search-link_hook_initial"), true);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_search_agent_initialize;
    message.body = previous.body;
    message.segments = previous.segments;
  }
});

test("hookで繰り返し追加したsearch agent内部リンクは能力を増殖させない", async () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "search_agent::stage_photo");
  const message = block?.messages[0];
  assert.ok(message);
  const previous = { body: message.body, segments: message.segments };
  message.body = "操作ガイド";
  message.segments = [{
    kind: "link",
    text: "操作ガイド",
    appId: "notes",
    contentId: "welcome_note",
    linkId: "search-link_hook"
  }];
  const hook = { event: "test_search_agent_link_hook", target: "", handler: "test_search_agent_link_hook", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_search_agent_link_hook = (context) => {
    context.talk.addBlock(SEARCH_AGENT_TALK_ID, "stage_photo", { mode: "stay" });
  };
  try {
    const initialized = await reconcileScenarioState(createInitialPlayerState(), "search-link-hook-player");
    const first = await runScenarioHooks(initialized.state, { eventId: hook.event }, { playerId: "search-link-hook-player" });
    const second = await runScenarioHooks(first.state, { eventId: hook.event }, { playerId: "search-link-hook-player" });
    assert.equal(first.state.revealedMessageLinks.some((item) => item.id === "search-link_hook"), true);
    assert.equal(second.state.revealedMessageLinks.filter((item) => item.id === "search-link_hook").length, 1);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_search_agent_link_hook;
    message.body = previous.body;
    message.segments = previous.segments;
  }
});

test("hookのtalk.searchはsearch agentのfromを動かさず結果eventと発見能力を同じstateへ記録する", async () => {
  const initialized = await reconcileScenarioState(createInitialPlayerState(), "search-hook-player");
  const before = initialized.state.talks[SEARCH_AGENT_TALK_ID];
  const hook = { event: "test_search_agent_hook", target: "", handler: "test_search_agent_hook", cond: "", llm: false };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers.test_search_agent_hook = (context) => context.talk.search(SEARCH_AGENT_TALK_ID, "古いメモ");
  try {
    const result = await runScenarioHooks(initialized.state, { eventId: "test_search_agent_hook" }, { playerId: "search-hook-player" });
    const after = result.state.talks[SEARCH_AGENT_TALK_ID];
    assert.equal(after.from, before.from);
    assert.equal(after.turnKey, before.turnKey);
    assert.equal(after.lastMessageSeq, before.lastMessageSeq + 1);
    const append = result.transcriptAppends.find((item) => item.streamId === SEARCH_AGENT_STREAM_ID);
    assert.equal(append?.messages[0]?.event_type, "search_result");
    assert.equal(result.state.discoveredTargetKeys.length > initialized.state.discoveredTargetKeys.length, true);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers.test_search_agent_hook;
  }
});
