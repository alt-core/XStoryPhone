import assert from "node:assert/strict";
import test from "node:test";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { createScenarioRuntime } from "../src/worker/scenarioRuntime.ts";
import { createTalkCommandRuntime } from "../src/worker/services/talkCommandRuntime.ts";

test("写真はtitleを持たず、修復の前後とも内容説明を公開しない", async () => {
  const { worker } = loadAndValidateScenario();
  const photos = worker.contents.filter(content => content.appId === "photos");
  assert.ok(photos.length > 0);
  assert.ok(photos.every(photo => !Object.hasOwn(photo.record, "title")));
  const runtime = createScenarioRuntime(worker);
  const state = runtime.createInitialPlayerState();
  const before = await runtime.publicPlayerState(state, 0);
  const corrupted = before.visibleDeviceState.photos.find(photo => photo.contentId === worker.publicIds.content.rainy_window);
  assert.equal(corrupted.corrupted, true);
  assert.equal(corrupted.repairLabel, photos.find(photo => photo.id === "rainy_window").repairLabel);
  assert.equal(Object.hasOwn(corrupted, "imageUrl"), false);
  assert.equal(Object.hasOwn(corrupted, "tags"), false);

  state.repairedContentIds.push(...photos.map(photo => photo.id));
  state.stateValues.demo_image_received = true;
  const after = await runtime.publicPlayerState(state, 1);
  assert.equal(after.visibleDeviceState.photos.length, photos.length);
  for (const snapshot of [before, after]) {
    for (const photo of snapshot.visibleDeviceState.photos) {
      assert.equal(Object.hasOwn(photo, "title"), false);
      assert.equal(Object.hasOwn(photo, "description"), false);
    }
    const serialized = JSON.stringify(snapshot);
    for (const description of Object.values(worker.photoDescriptions)) {
      assert.equal(serialized.includes(description), false);
    }
  }
  assert.ok(after.visibleDeviceState.notes.some(note => typeof note.title === "string"));
});

test("写真の検索名は媒体別の汎用ラベルで、内部IDを名前へ代用しない", () => {
  const { worker } = loadAndValidateScenario();
  const runtime = createScenarioRuntime(worker);
  const state = runtime.createInitialPlayerState();
  const image = runtime.searchScenario("夕方", state).find(result => result.contentId === worker.publicIds.content.evening_platform);
  const video = runtime.searchScenario("デモ動画", state).find(result => result.contentId === worker.publicIds.content.demo_video);
  assert.equal(image.title, "写真");
  assert.equal(video.title, "動画");
  assert.notEqual(image.contentId, "evening_platform");
  assert.notEqual(video.contentId, "demo_video");

  const stillWorker = structuredClone(worker);
  const still = stillWorker.contents.find(content => content.id === "demo_video");
  still.record.mediaKind = "still_video";
  still.record.audioAttachmentId = stillWorker.contents.find(content => content.id === "sample_radio").record.audioAttachmentId;
  delete still.record.videoAttachmentId;
  const stillRuntime = createScenarioRuntime(stillWorker);
  assert.equal(stillRuntime.searchScenario("デモ動画", stillRuntime.createInitialPlayerState())
    .find(result => result.contentId === still.publicId).title, "動画");
});

test("写真の会話判定は非公開descriptionを使い、未指定なら一般的な添付説明になる", () => {
  const { worker } = loadAndValidateScenario();
  const { semanticInputForTalkCommand } = createTalkCommandRuntime(createScenarioRuntime(worker));
  assert.match(semanticInputForTalkCommand("photo:rainy_window"), /青い灯り/u);
  assert.equal(semanticInputForTalkCommand("photo:dummy_photo_1"), "プレイヤーは画像または動画を添付しました。");
  const radioTitle = worker.contents.find(content => content.id === "sample_radio").record.programTitle;
  assert.equal(semanticInputForTalkCommand("share:sample_radio"), `プレイヤーは「${radioTitle}」というラジオ項目を共有しました。`);
});
