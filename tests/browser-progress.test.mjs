import assert from "node:assert/strict";
import test from "node:test";
import { decodeBrowserProgress, encodeBrowserProgress } from "../src/server/browserProgress.ts";
import { createInitialPlayerState, reconcileScenarioState, workerScenario } from "../src/worker/scenario.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";
import {
  applyCompactStateAssignments,
  effectiveStateValues,
  setStateValue
} from "../src/worker/stateValues.ts";

test("ブラウザー進行トークンは同じ作品の更新を引き継ぎ、改ざんと別作品を拒否する", async () => {
  const state = createInitialPlayerState();
  state.stateValues = { image_color_reported: true };
  const player = { id: "browser-player", state, stateVersion: 3 };
  const token = await encodeBrowserProgress("test-secret", "project-a", "revision-a", player);
  assert.equal(token.split(".").length, 2);

  const decoded = await decodeBrowserProgress("test-secret", "project-a", token);
  assert.equal(decoded?.id, player.id);
  assert.equal(decoded?.stateVersion, 3);
  assert.deepEqual(decoded?.state.stateValues, { image_color_reported: true });

  const tamperedIndex = token.length - 2;
  const tamperedCharacter = token[tamperedIndex] === "a" ? "b" : "a";
  const tampered = `${token.slice(0, tamperedIndex)}${tamperedCharacter}${token.slice(tamperedIndex + 1)}`;
  assert.equal(await decodeBrowserProgress("test-secret", "project-a", tampered), null);
  assert.equal((await decodeBrowserProgress("test-secret", "project-a", token))?.stateVersion, 3);
  assert.equal(await decodeBrowserProgress("test-secret", "project-b", token), null);

  const nextRevisionToken = await encodeBrowserProgress("test-secret", "project-a", "revision-b", player);
  assert.notEqual(nextRevisionToken, token);
  assert.equal((await decodeBrowserProgress("test-secret", "project-a", nextRevisionToken))?.stateVersion, 3);
});

test("ブラウザー進行トークンはアプリの安全上限を超えたら発行しない", async () => {
  const state = createInitialPlayerState();
  state.discoveredTargetKeys = Array.from({ length: 3_000 }, () => `notes:${crypto.randomUUID()}`);
  await assert.rejects(
    () => encodeBrowserProgress("test-secret", "project-a", "revision-a", { id: "browser-player", state, stateVersion: 1 }),
    /browser_progress_too_large/u
  );
});

test("デモを終盤まで進めてもbrowser進行トークンへ十分な余白を残す", async () => {
  let state = createInitialPlayerState();
  for (const [id, initial] of Object.entries(workerScenario.stateVariables)) {
    if (typeof initial === "boolean" && !id.endsWith("_received")) state.stateValues[id] = true;
  }
  state.repairedAppIds.push("chat");
  state.repairedContentIds = workerScenario.contents.filter((item) => item.initialState !== "normal").map((item) => item.id);
  state.unlockedContentIds = ["sealed_note"];
  state.discoveredTargetKeys = [
    ...workerScenario.apps.map((item) => `${item.id}:${item.id}`),
    ...workerScenario.contents.map((item) => `${item.appId}:${item.publicId}`)
  ];
  state.clearedNotificationIds = workerScenario.notifications.map((item) => item.id);
  state.revealedAttachmentContentIds = ["rainy_window", "sealed_note", "demo_received_image"];
  state = (await reconcileScenarioState(state, "browser-player")).state;
  for (const [target, playerInput] of [
    ["guide", "メッセージ連携"],
    ["guide", "画像受信テスト"],
    ["guide", "チャットへ送る"],
    ["lobby", "チャット連携"],
    ["lobby", "メッセージへ送る"]
  ]) {
    state = (await runScenarioHooks(state, { event: "talk_sent", target, playerInput })).state;
  }
  const token = await encodeBrowserProgress("test-secret", "demo", "revision", {
    id: "browser-player",
    state,
    stateVersion: 10
  });
  assert.ok(token.length < 5 * 1024, `デモ進行tokenが大きすぎます: ${token.length}`);
});

test("stateVariablesは既定値との差分だけを保存する", () => {
  const defaults = { started: false, phase: 0, name: "" };
  let overrides = {};
  overrides = setStateValue(defaults, overrides, "started", true);
  overrides = setStateValue(defaults, overrides, "phase", 2);
  assert.deepEqual(overrides, { started: true, phase: 2 });
  assert.deepEqual(effectiveStateValues(defaults, overrides), { started: true, phase: 2, name: "" });

  overrides = setStateValue(defaults, overrides, "started", false);
  assert.deepEqual(overrides, { phase: 2 });
  assert.deepEqual(applyCompactStateAssignments(defaults, overrides, ["phase=0", "name=\"ナビ\""]), { name: "ナビ" });
});

test("作中日時の予約状態変数は通常の状態更新と同じ経路を使う", () => {
  const defaults = { os_date: "2026-08-12", os_time_label: "20:14" };
  let overrides = setStateValue(defaults, {}, "os_time_label", "21:30");
  overrides = applyCompactStateAssignments(defaults, overrides, ['os_date="2026-08-13"']);
  assert.deepEqual(overrides, { os_date: "2026-08-13", os_time_label: "21:30" });
  assert.throws(() => setStateValue(defaults, overrides, "os_date", "2026-02-29"), /os_date/u);
});
