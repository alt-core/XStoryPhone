import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { parseRegexCriteria, resolveTalkRule } from "../src/shared/conversation.ts";
import { formatStoryDateCompact, formatStoryDateLabel, parseStoryDate, storyWeekFor } from "../src/shared/storyDate.ts";
import { semanticInputForTalkCommand, talkCommandAvailable } from "../src/worker/services/talkCommand.ts";
import {
  albumPhotoIdsForMediaAttachment,
  createInitialPlayerState,
  initialTalkTurnKey,
  appAvailable,
  notificationIdsForTarget,
  observedAlbumMediaContentIds,
  playerStateRevision,
  publicPlayerState,
  publicTalkMessage,
  radioAudioCueForEvent,
  reconcileScenarioState,
  resolveTalkAttachment,
  restoredTalkHistoryMessages,
  scenarioMessageBlockId,
  revealTalkMessages,
  searchScenario,
  talkCanPost,
  workerScenario
} from "../src/worker/scenario.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";
import { scenarioHookHandlers } from "../src/project/hooks.ts";

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

test("機能テスト用キーワードはどの会話地点からでも正規表現で選択できる", async () => {
  for (const [talkId, input] of [["guide", "着信テスト"], ["lobby", "チャット連携"]]) {
    const talk = workerScenario.talks.find((item) => item.id === talkId);
    assert.ok(talk);
    const result = await resolveTalkRule({
      rules: talk.rules,
      from: talk.initialFrom,
      playerInput: input,
      stateValues: workerScenario.stateVariables
    });
    assert.equal(result.ok && result.rule.intent, "機能テスト");
    assert.equal(result.ok && result.source, "regex");
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
  assert.equal(scenario.worker.contents.find((content) => content.id === "sealed_note")?.record.unlockCode, undefined);
  assert.equal(
    scenario.worker.lockedContentPasswords.find((item) => item.contentId === "sealed_note")?.passwordHash,
    createHash("sha256").update("0420").digest("hex")
  );
  assert.equal(scenario.worker.contents.some((content) => content.id === "orange_mark"), false);
  const photoDescription = scenario.worker.photoDescriptions.rainy_window;
  assert.match(photoDescription, /黄色い灯り/u);
  assert.equal(JSON.stringify(scenario.deviceState).includes(photoDescription), false);
  assert.match(semanticInputForTalkCommand("photo:rainy_window"), /黄色い灯り/u);
});

test("talk初期履歴は連続する未修復blockを一つの破損領域にまとめ、修復時だけ本文を公開する", async () => {
  const initialized = await reconcileScenarioState(createInitialPlayerState(), "player-history-repair");
  const guide = workerScenario.talks.find((talk) => talk.id === "guide");
  const initialDelta = initialized.transcriptAppends.find((delta) => delta.streamId === "talk:guide");
  assert.ok(guide);
  assert.deepEqual(initialDelta?.messages.map((message) => message.seq), [4]);
  assert.doesNotMatch(JSON.stringify(initialDelta), /修復対象になる過去のメッセージ履歴/u);

  const initialPublic = await publicPlayerState(initialized.state, 1, [], null, initialized.transcriptAppends);
  const publicGuide = initialPublic.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId);
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

  const partiallyRepairedPublic = await publicPlayerState(repaired, 2, [], null, [{
    streamId: "talk:guide",
    transcriptKey: repaired.talks.guide.transcriptKey,
    messages: restored?.messages ?? []
  }]);
  const partiallyRepairedGuide = partiallyRepairedPublic.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId);
  assert.deepEqual(partiallyRepairedGuide?.brokenHistoryRanges, [{ beforeSeq: 4 }]);
  assert.equal(partiallyRepairedPublic.talks.find((talk) => talk.talkId === guide.publicId)?.historyRevision, 1);

  repaired.repairedContentIds.push("guide_history_archive_b");
  const fullyRepairedPublic = await publicPlayerState(repaired, 3);
  const fullyRepairedGuide = fullyRepairedPublic.visibleDeviceState.messages.find((thread) => thread.id === guide.publicId);
  assert.equal(fullyRepairedGuide?.brokenHistoryRanges, undefined);
  assert.equal(fullyRepairedPublic.talks.find((talk) => talk.talkId === guide.publicId)?.historyRevision, 2);
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
  assert.deepEqual(
    initialized.transcriptAppends.find((delta) => delta.streamId === "talk:lobby")?.messages.map((message) => message.seq),
    [2]
  );
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
  const talk = scenario.worker.talks.find((item) => item.id === "guide");
  assert.ok(talk?.rules.some((rule) => rule.from === "*" && rule.intent === "ヘルプ"));
  const promptRule = talk?.rules.find((rule) => rule.from === talk.initialFrom && rule.isDefault);
  const promptBlock = promptRule?.nextBlocks[0] ?? "";
  assert.equal(scenario.worker.repeatTalkBlocks[promptBlock]?.length, 1);
  assert.match(scenario.worker.repeatTalkBlocks[promptBlock]?.[0] ?? "", /@2$/u);
});

test("会話の投稿可否は現在地点で有効な通常分岐がある場合だけtrueになる", async () => {
  const talk = workerScenario.talks.find((item) => item.id === "guide");
  assert.ok(talk);
  const initialized = (await reconcileScenarioState(createInitialPlayerState(), "player-1")).state;
  assert.equal(talkCanPost(talk, initialized), true);

  const terminalState = structuredClone(initialized);
  terminalState.talks[talk.id].from = "__terminal__";
  assert.equal(talkCanPost(talk, terminalState), false);
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
  assert.ok(scenario.worker.contents.find((content) => content.id === "demo_call_history")?.record.transcript);
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "schedule_demo_call"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "show_demo_call"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "demo_form"));
  assert.ok(scenario.worker.hooks.some((hook) => hook.event === "scenario_event" && hook.target === "demo_all_clear"));
});

test("着信完了後に履歴と案内メッセージを利用可能にする", async () => {
  const initial = createInitialPlayerState();
  const result = await runScenarioHooks(initial, {
    event: "scenario_event",
    target: "incoming_call_completed",
    fields: { callId: "demo_call" }
  });
  assert.equal(result.state.stateValues.demo_call_completed, true);
  assert.ok(result.transcriptAppends.some((delta) =>
    delta.streamId === "talk:guide"
    && delta.messages.some((message) => message.body.includes("着信履歴"))
  ));
  const hookMessage = result.transcriptAppends.flatMap((delta) => delta.messages)
    .find((message) => message.body.includes("着信履歴"));
  assert.equal(hookMessage?.delayMs, 500);
  assert.equal(hookMessage?.delayOnFirstDisplay, true);
  assert.equal(
    hookMessage?.id,
    `${await scenarioMessageBlockId("hook-preview", "sms", "guide", "guide::call_history_guide")}:1`
  );
  assert.equal(result.state.talks.guide.from, "guide::call_history_guide");
  assert.equal(
    result.state.talks.guide.turnKey,
    await initialTalkTurnKey("hook-preview", "guide", "guide::call_history_guide")
  );
  assert.ok((await publicPlayerState(result.state, 2)).visibleDeviceState.callLogs.some((call) =>
    call.contentId === workerScenario.publicIds.content.demo_call_history
  ));
});

test("ToDoはhookで明示的に追加・完了される", async () => {
  const started = await runScenarioHooks(createInitialPlayerState(), {
    event: "session_started",
    target: ""
  });
  assert.deepEqual((await publicPlayerState(started.state, 1)).todos.map((todo) => todo.id), ["find_old_note"]);

  const oldNoteOpened = await runScenarioHooks(started.state, {
    event: "content_repaired",
    target: "old_note"
  });
  assert.deepEqual((await publicPlayerState(oldNoteOpened.state, 2)).todos.map((todo) => todo.id), ["find_rainy_window"]);
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

  assert.equal(radio?.record.audioUrl, "/system/radio-caption-sample.wav");
  assert.equal(radio?.record.transcript?.length, 3);
  assert.equal(silentRadio?.record.transcript, undefined);
  assert.equal(callWithoutTranscript?.record.transcript, undefined);
  assert.equal(video?.record.mediaKind, "video");
  assert.equal(video?.record.videoUrl, "/demo/demo-video.mp4");
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

test("メッセージの機能テストは別ルーム受信・画像登録候補・遅延着信を作る", async () => {
  const initial = createInitialPlayerState();
  const linked = await runScenarioHooks(initial, {
    event: "talk_sent",
    target: "guide",
    playerInput: "メッセージ連携"
  });
  assert.equal(linked.state.stateValues.demo_sms_message_received, true);
  assert.ok(linked.transcriptAppends.some((delta) => delta.streamId === "talk:sms_receiver"));
  assert.ok((await publicPlayerState(linked.state, 1, [], null, linked.transcriptAppends)).visibleDeviceState.notifications
    .some((notification) => notification.title === "テスト受信箱"));

  const imageReceived = await runScenarioHooks(initial, {
    event: "talk_sent",
    target: "guide",
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
    event: "talk_sent",
    target: "guide",
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
    event: "scenario_event",
    target: "deliver_demo_delayed_message"
  });
  assert.equal(delivered.state.stateValues.demo_delayed_message_received, true);
  assert.ok(delivered.transcriptAppends.some((delta) => delta.streamId === "talk:sms_receiver"));
});

test("デモの会話コマンドは着信とアプリ間連携を既存hookで構成する", async () => {
  const call = await runScenarioHooks(createInitialPlayerState(), {
    event: "talk_sent",
    target: "guide",
    playerInput: "着信テスト"
  });
  assert.deepEqual(call.scheduleEffects, [{
    type: "queue",
    id: "manual_demo_call",
    delayMs: 1_500,
    eventId: "show_demo_call",
    fields: {}
  }]);

  const chatReady = createInitialPlayerState();
  chatReady.stateValues.sealed_note_unlocked = true;
  chatReady.stateValues.chat_auth_verified = true;
  chatReady.repairedAppIds.push("chat");
  const toChat = await runScenarioHooks(chatReady, {
    event: "talk_sent",
    target: "guide",
    playerInput: "チャットへ送る"
  });
  assert.equal(toChat.state.stateValues.demo_chat_cross_received, true);
  assert.ok(toChat.transcriptAppends.some((delta) => delta.streamId === "talk:chat_receiver"));

  const toMessages = await runScenarioHooks(chatReady, {
    event: "talk_sent",
    target: "lobby",
    playerInput: "メッセージへ送る"
  });
  assert.equal(toMessages.state.stateValues.demo_sms_cross_received, true);
  assert.ok(toMessages.transcriptAppends.some((delta) => delta.streamId === "talk:sms_receiver"));

  const withinChat = await runScenarioHooks(chatReady, {
    event: "talk_sent",
    target: "lobby",
    playerInput: "チャット連携"
  });
  assert.equal(withinChat.state.stateValues.demo_chat_message_received, true);
  assert.ok(withinChat.transcriptAppends.some((delta) => delta.streamId === "talk:chat_receiver"));
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
  assert.ok(scenario.deviceState.notifications.some((item) => item.id && item.title === "デモ進行係"));
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

test("シナリオ検証は不正なcondと未定義変数を実行前に拒否する", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-scenario-"));
  try {
    fs.cpSync("scenario", path.join(temporaryRoot, "scenario"), { recursive: true });
    const scenarioPath = path.join(temporaryRoot, "scenario/demo/scenario.json");
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
    const validator = fileURLToPath(new URL("../scripts/scenario-validate.mjs", import.meta.url));
    const historyRepair = scenario.contents.find((content) => content.id === "guide_history_archive_a");
    historyRepair.record.block = "found_lead";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const dynamicHistoryBlockResult = spawnSync(process.execPath, [validator], { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(dynamicHistoryBlockResult.status, 1);
    assert.match(dynamicHistoryBlockResult.stderr, /record.block は指定talkのstartBlocksに含まれるblock/u);

    historyRepair.record.block = "history_archive_a";
    scenario.notifications[0].cond = "(!old_note_opened";
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
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
    assert.match(invalidBrowserPasscodeResult.stderr, /browserモードでは project.lockScreen.method に player-passcode を指定できません/u);

    scenario.project.lockScreen = { method: "fixed-pin", pin: "0420" };
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
    const scenarioLibUrl = new URL("../scripts/scenario-lib.mjs", import.meta.url).href;
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

test("player revisionは進行表示の変化を検知し、検索履歴だけでは変えない", async () => {
  const initial = createInitialPlayerState();
  const initialRevision = await playerStateRevision(initial);
  const searched = { ...initial, searchLastMessageSeq: 2, searchTranscriptKey: "search-updated" };
  assert.equal(await playerStateRevision(searched), initialRevision);

  const progressed = structuredClone(initial);
  progressed.stateValues.old_note_opened = true;
  assert.notEqual(await playerStateRevision(progressed), initialRevision);
  assert.notEqual((await publicPlayerState(progressed, 1)).revision, workerScenario.revision);
  assert.equal((await publicPlayerState(progressed, 1)).clientRevision, workerScenario.revision);
});

test("未到達の本文とtalkは初期応答へ含めず、利用可能になった時だけ差分で返す", async () => {
  const initial = await reconcileScenarioState(createInitialPlayerState(), "player-1");
  const initialPublic = await publicPlayerState(initial.state, 1, [], null, initial.transcriptAppends);
  const serialized = JSON.stringify(initialPublic);
  assert.doesNotMatch(serialized, /表示されたタグから灯りの色/u);
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
  assert.deepEqual(repairedPhoto?.tags, ["雨", "窓", "黄色い灯り"]);
  const repairedBrowserTab = repairedPublic.visibleDeviceState.browserTabs.find((tab) => tab.id === workerScenario.publicIds.content.browser_archive);
  assert.equal(repairedBrowserTab?.url, "/demo/browser/archive-k7m2q.html");

  const reachedState = structuredClone(initial.state);
  reachedState.stateValues.sealed_note_unlocked = true;
  reachedState.repairedAppIds.push("chat");
  const reached = await reconcileScenarioState(reachedState, "player-1");
  assert.ok(reached.state.talks.lobby);
  assert.ok(reached.transcriptAppends.some((delta) => delta.streamId === "talk:lobby"));
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

test("同一イベントのhook適格性は実行開始時点の状態で確定する", async () => {
  workerScenario.stateVariables.test_hook_snapshot = false;
  workerScenario.stateVariables.test_hook_cascade = false;
  const firstHook = { event: "scenario_event", target: "test_hook_snapshot", handler: "test_hook_snapshot_first", cond: "", llm: false };
  const secondHook = { event: "scenario_event", target: "test_hook_snapshot", handler: "test_hook_snapshot_second", cond: "test_hook_snapshot", llm: false };
  workerScenario.hooks.push(firstHook, secondHook);
  scenarioHookHandlers.test_hook_snapshot_first = (context) => context.state.set("test_hook_snapshot", true);
  scenarioHookHandlers.test_hook_snapshot_second = (context) => context.state.set("test_hook_cascade", true);

  try {
    const result = await runScenarioHooks(createInitialPlayerState(), {
      event: "scenario_event",
      target: "test_hook_snapshot"
    });
    assert.equal(result.state.stateValues.test_hook_snapshot, true);
    assert.equal(result.state.stateValues.test_hook_cascade, undefined);
  } finally {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(firstHook), 2);
    delete scenarioHookHandlers.test_hook_snapshot_first;
    delete scenarioHookHandlers.test_hook_snapshot_second;
    delete workerScenario.stateVariables.test_hook_snapshot;
    delete workerScenario.stateVariables.test_hook_cascade;
  }
});

test("同じ会話を先に開いても未成立の通知は消去しない", async () => {
  const guidePublicId = workerScenario.publicIds.talk.guide;
  const initialState = createInitialPlayerState();
  assert.deepEqual(notificationIdsForTarget(guidePublicId, initialState), ["welcome"]);
  const initialNotificationId = (await publicPlayerState(initialState, 1)).visibleDeviceState.notifications[0]?.id;
  assert.equal(initialNotificationId, workerScenario.publicIds.notification.welcome);

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
