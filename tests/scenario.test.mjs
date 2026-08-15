import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { parseRegexCriteria } from "../src/shared/conversation.ts";
import {
  createInitialPlayerState,
  notificationIdsForTarget,
  publicPlayerState,
  reconcileScenarioState,
  searchScenario,
  workerScenario
} from "../src/worker/scenario.ts";

test("デモシナリオは検索アプリを作らず、修復対象を保持する", () => {
  const scenario = loadAndValidateScenario();
  assert.equal(scenario.worker.apps.some((app) => app.id === "search"), false);
  assert.equal(scenario.worker.apps.find((app) => app.id === "chat")?.initialState, "repairable");
  assert.equal(scenario.worker.contents.find((content) => content.id === "old_note")?.initialState, "repairable");
  assert.equal(scenario.worker.contents.find((content) => content.id === "rainy_window")?.initialState, "repairable");
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "content_repaired" && hook.target === "old_note"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "content_repaired" && hook.target === "rainy_window"));
  assert.equal(scenario.deviceState.apps.some((app) => app.initialState === "hidden"), false);
  assert.equal(scenario.deviceState.apps.some((app) => app.id === "chat"), false);
  assert.equal(scenario.worker.apps.find((app) => app.id === "chat")?.cond, "sealed_note_unlocked");
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

test("生成ナビアトラスは元UIと同じ8x9契約を持つ", () => {
  const source = fs.readFileSync("public/search-agent/search-agent-spritesheet.svg", "utf8");
  assert.match(source, /viewBox="0 0 1536 1872"/u);
  assert.equal((source.match(/<ellipse /gu) ?? []).length, 10);
});

test("会話ブロックは複数発話・添付・遅延・出典を保持する", () => {
  const scenario = loadAndValidateScenario();
  const talk = scenario.worker.talks.find((item) => item.id === "guide");
  const foundRule = talk?.rules.find((rule) => rule.intent === "灯りの色を報告");
  assert.equal(foundRule?.nextBlocks.length, 2);
  assert.equal(foundRule?.cond, "rainy_window_opened");
  const colorCriteria = parseRegexCriteria(foundRule?.criteria ?? "");
  assert.equal(colorCriteria.kind, "ready");
  if (colorCriteria.kind === "ready") {
    assert.equal(colorCriteria.regex.test("黄色です"), true);
    colorCriteria.regex.lastIndex = 0;
    assert.equal(colorCriteria.regex.test("オレンジ色に見えます"), true);
    colorCriteria.regex.lastIndex = 0;
    assert.equal(colorCriteria.regex.test("見つけた"), false);
  }
  const messages = foundRule?.nextBlocks.flatMap((blockId) =>
    scenario.worker.talkBlocks.find((block) => block.id === blockId)?.messages ?? []
  ) ?? [];
  assert.equal(messages.length, 3);
  assert.equal(messages[1]?.attachmentId, "rainy_window_image");
  assert.equal(messages[1]?.delayMs, 700);
  assert.equal(messages[1]?.source, "human");
  assert.equal(messages[1]?.updatedAt, "2026-08-12");
  assert.equal(messages[2]?.attachmentId, "sealed_note_file");
  assert.equal(messages[2]?.segments?.some((segment) => segment.kind === "link" && segment.contentId === "welcome_note"), true);
  assert.equal(scenario.deviceState.notes.some((note) => note.title === "鍵付きメモ"), false);
  assert.equal(JSON.stringify(scenario.deviceState).includes("unlockCode"), false);
  assert.equal(scenario.worker.contents.find((content) => content.id === "sealed_note")?.record.unlockCode, "0420");
  assert.equal(scenario.worker.contents.some((content) => content.id === "orange_mark"), false);
});

test("共通分岐とリピートblockをtalk単位で解決する", () => {
  const scenario = loadAndValidateScenario();
  const talk = scenario.worker.talks.find((item) => item.id === "guide");
  assert.ok(talk?.rules.some((rule) => rule.from === "*" && rule.intent === "ヘルプ"));
  const promptRule = talk?.rules.find((rule) => rule.from === talk.initialFrom && rule.isDefault);
  const promptBlock = promptRule?.nextBlocks[0] ?? "";
  assert.equal(scenario.worker.repeatTalkBlocks[promptBlock]?.length, 1);
  assert.match(scenario.worker.repeatTalkBlocks[promptBlock]?.[0] ?? "", /@2$/u);
});

test("着信定義と予約イベント用hookを生成する", () => {
  const scenario = loadAndValidateScenario();
  assert.equal(scenario.worker.incomingCalls.find((call) => call.id === "demo_call")?.name, "着信テスト");
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "schedule_demo_call"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "show_demo_call"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "demo_form"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "demo_all_clear"));
});

test("game_over分岐は一時表示用blockを保持する", () => {
  const scenario = loadAndValidateScenario();
  const rule = scenario.worker.talks
    .find((talk) => talk.id === "guide")
    ?.rules.find((item) => item.mode === "game_over");
  assert.equal(rule?.intent, "ゲームオーバー確認");
  assert.equal(rule?.nextBlocks.length, 1);
  assert.ok(scenario.worker.talkBlocks.some((block) => block.id === rule?.nextBlocks[0]));
});

test("条件付き表示と検索応答を公開シナリオへ生成する", () => {
  const scenario = loadAndValidateScenario();
  assert.ok(scenario.deviceState.notifications.some((item) => item.id && item.title === "ナビ"));
  assert.equal(scenario.worker.talks.find((talk) => talk.id === "lobby")?.cond, "sealed_note_unlocked");
  assert.equal(scenario.worker.notifications.find((item) => item.id === "welcome")?.cond, "!old_note_opened");
  assert.equal(scenario.worker.assistantMessages.find((item) => item.id === "home_hint")?.cond, "!old_note_opened");
  assert.equal(scenario.worker.assistantMessages.find((item) => item.id === "photo_hint")?.cond, "old_note_opened && !rainy_window_opened");
  assert.equal(scenario.worker.assistantMessages.find((item) => item.id === "report_hint")?.cond, "rainy_window_opened && !image_color_reported");
  assert.equal(scenario.worker.searchResponses.find((item) => item.id === "hint")?.suppressResults, true);
  assert.equal(scenario.worker.searchResponses.find((item) => item.id === "hint_photo")?.cond, "old_note_opened && !rainy_window_opened");
  assert.equal(scenario.worker.chatAuthGate?.cond, "sealed_note_unlocked && !chat_auth_verified");
  assert.ok(scenario.worker.talkBlocks.some((block) => block.talkId === "guide" && block.blockKey === "chat_auth_link"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.handler === "send_chat_auth_link"));
  assert.deepEqual(scenario.worker.clientCallableEvents, ["chat_auth_link_requested"]);
  assert.equal(scenario.worker.clientCallableEvents.includes("show_demo_call"), false);
  assert.ok(scenario.worker.hooks.some((hook) => hook.handler === "verify_chat_auth"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "session_started" && hook.handler === "mark_session_started"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "content_unlocked" && hook.target === "sealed_note"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.target === "audio_playback_completed" && hook.handler === "mark_radio_playback_completed"));
  assert.deepEqual(scenario.worker.publicStateVariables, []);
});

test("未使用の全アプリ用クライアントシナリオを生成しない", () => {
  assert.equal(fs.existsSync("src/generated/clientScenario.generated.ts"), false);
});

test("シナリオ検証は不正なcondと未定義変数を実行前に拒否する", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-scenario-"));
  try {
    fs.cpSync("scenario", path.join(temporaryRoot, "scenario"), { recursive: true });
    const scenarioPath = path.join(temporaryRoot, "scenario/demo/scenario.json");
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
    scenario.notifications[0].cond = "(!old_note_opened";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const validator = fileURLToPath(new URL("../scripts/scenario-validate.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /notification welcome: cond が不正です/u);

    scenario.notifications[0].cond = "old_note_opend";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const unknownVariableResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(unknownVariableResult.status, 1);
    assert.match(unknownVariableResult.stderr, /未定義の状態変数です: old_note_opend/u);

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
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("作品Stageには明示した状態変数だけを公開する", () => {
  workerScenario.publicStateVariables.push("image_color_reported");
  try {
    const state = createInitialPlayerState();
    assert.deepEqual(publicPlayerState(state, 1).projectState, { image_color_reported: false });
    state.stateValues.image_color_reported = true;
    assert.deepEqual(publicPlayerState(state, 2).projectState, { image_color_reported: true });
    assert.equal("old_note_opened" in publicPlayerState(state, 2).projectState, false);
  } finally {
    workerScenario.publicStateVariables.pop();
  }
});

test("未到達の本文とtalkは初期応答へ含めず、利用可能になった時だけ差分で返す", () => {
  const initial = reconcileScenarioState(createInitialPlayerState());
  const initialPublic = publicPlayerState(initial.state, 1, [], null, initial.transcriptAppends);
  const serialized = JSON.stringify(initialPublic);
  assert.doesNotMatch(serialized, /表示されたタグから灯りの色/u);
  assert.doesNotMatch(serialized, /パスワードは「0420」/u);
  assert.equal(initial.state.talks.lobby, undefined);
  assert.equal(initialPublic.talks.some((talk) => talk.talkId === workerScenario.publicIds.talk.lobby), false);
  const corruptedNote = initialPublic.visibleDeviceState.notes.find((note) => note.id === workerScenario.publicIds.content.old_note);
  assert.equal(corruptedNote?.corrupted, true);
  assert.equal("imageUrl" in (corruptedNote ?? {}), false);
  assert.equal("tags" in (corruptedNote ?? {}), false);

  const corruptedPhoto = initialPublic.visibleDeviceState.photos.find((photo) => photo.id === workerScenario.publicIds.content.rainy_window);
  assert.equal(corruptedPhoto?.corrupted, true);
  assert.equal("imageUrl" in (corruptedPhoto ?? {}), false);
  assert.equal("tags" in (corruptedPhoto ?? {}), false);

  const welcomeNote = initialPublic.visibleDeviceState.notes.find((note) => note.id === workerScenario.publicIds.content.welcome_note);
  assert.deepEqual(welcomeNote?.tags, ["案内", "操作"]);

  const repairedState = structuredClone(initial.state);
  repairedState.repairedContentIds.push("old_note", "rainy_window");
  const repairedPublic = publicPlayerState(repairedState, 2);
  const repairedNote = repairedPublic.visibleDeviceState.notes.find((note) => note.id === workerScenario.publicIds.content.old_note);
  assert.deepEqual(repairedNote?.tags, ["操作", "画像"]);
  const repairedPhoto = repairedPublic.visibleDeviceState.photos.find((photo) => photo.id === workerScenario.publicIds.content.rainy_window);
  assert.equal(repairedPhoto?.imageUrl, "/demo/album/rainy-window.webp");
  assert.deepEqual(repairedPhoto?.tags, ["雨", "窓", "黄色い灯り"]);

  const reachedState = structuredClone(initial.state);
  reachedState.stateValues.sealed_note_unlocked = true;
  reachedState.repairedAppIds.push("chat");
  const reached = reconcileScenarioState(reachedState);
  assert.ok(reached.state.talks.lobby);
  assert.ok(reached.transcriptAppends.some((delta) => delta.streamId === "talk:lobby"));
});

test("未修復の親アプリに属するコンテンツは検索結果へ出さない", () => {
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
    assert.equal(searchScenario("未修復親アプリ確認", state).some((result) => result.contentId === testContent.publicId), false);

    state.repairedAppIds.push("chat");
    assert.equal(searchScenario("未修復親アプリ確認", state).some((result) => result.contentId === testContent.publicId), true);
  } finally {
    workerScenario.contents.splice(workerScenario.contents.indexOf(testContent), 1);
  }
});

test("同じ会話を先に開いても未成立の通知は消去しない", () => {
  const guidePublicId = workerScenario.publicIds.talk.guide;
  const initialState = createInitialPlayerState();
  assert.deepEqual(notificationIdsForTarget(guidePublicId, initialState), ["welcome"]);

  const beforeAuth = {
    ...initialState,
    stateValues: {
      ...initialState.stateValues,
      old_note_opened: true,
      image_color_reported: true
    }
  };
  assert.deepEqual(notificationIdsForTarget(guidePublicId, beforeAuth), []);

  const afterAuthRequest = {
    ...beforeAuth,
    stateValues: {
      ...beforeAuth.stateValues,
      chat_auth_link_sent: true
    }
  };
  assert.deepEqual(notificationIdsForTarget(guidePublicId, afterAuthRequest), ["chat_auth"]);
});
