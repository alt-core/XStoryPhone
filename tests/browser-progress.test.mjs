import assert from "node:assert/strict";
import test from "node:test";
import { decodeBrowserProgress, encodeBrowserProgress } from "../src/server/browserProgress.ts";
import { normalizeStoredPlayerState } from "../src/server/store.ts";
import { createInitialPlayerState } from "../src/worker/scenario.ts";
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
});

test("ブラウザー進行トークンはrequest headerへ収まる上限を超えたら発行しない", async () => {
  const state = createInitialPlayerState();
  state.discoveredTargetKeys = Array.from({ length: 800 }, (_, index) => `notes:content-${index.toString().padStart(4, "0")}`);
  await assert.rejects(
    () => encodeBrowserProgress("test-secret", "project-a", "revision-a", { id: "browser-player", state, stateVersion: 1 }),
    /browser_progress_too_large/u
  );
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

test("旧PlayerState内の会話・検索履歴をstreamへ欠落なく移す", () => {
  const legacy = createInitialPlayerState();
  legacy.talks.guide = {
    from: "guide:intro",
    turnKey: "legacy-turn",
    blockDisplayCounts: {},
    messages: [{
      id: "legacy-talk-1",
      talkId: "guide-public",
      sender: "other",
      body: "旧会話",
      attachment: null,
      sentAt: "2026-08-14T00:00:00.000Z"
    }],
    lastReadMessageId: "legacy-talk-1"
  };
  legacy.searchAgentMessages = [{
    id: "legacy-search-1",
    requestId: "legacy-request",
    role: "user",
    body: "旧検索",
    sentAt: "2026-08-14T00:00:00.000Z"
  }, {
    id: "legacy-search-2",
    requestId: "legacy-request",
    role: "assistant",
    body: "見つかりました",
    results: [{ contentId: "content-public", appId: "notes", targetKind: "content", repairable: true }],
    sentAt: "2026-08-14T00:00:01.000Z"
  }];

  const normalized = normalizeStoredPlayerState(legacy);
  assert.equal(normalized.state.talks.guide.lastMessageSeq, 1);
  assert.equal(normalized.state.talks.guide.lastReadMessageSeq, 1);
  assert.equal("messages" in normalized.state.talks.guide, false);
  assert.equal("searchAgentMessages" in normalized.state, false);
  assert.deepEqual(normalized.state.discoveredTargetKeys, ["notes:content-public"]);
  assert.deepEqual(normalized.legacyTranscripts.map((item) => [item.streamId, item.messages[0].seq]), [
    ["talk:guide", 1],
    ["search", 1]
  ]);
});
