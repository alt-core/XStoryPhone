import assert from "node:assert/strict";
import test from "node:test";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const waiting = { id: "radio", contentId: "radio", programTitle: "音声", generatedAudio: { status: "running" } };
const ready = { ...waiting, generatedAudio: { status: "ready" }, audioUrl: "/ready.wav" };
const fixed = { id: "fixed-item", contentId: "fixed-content", programTitle: "固定音声", audioUrl: "/fixed.wav" };
function radio(props = {}) {
  const played = [];
  const harness = componentScriptHarness(new URL("../src/client/apps/RadioApp.svelte", import.meta.url), {
    items: [waiting], autoplayContentId: "radio", autoplayRequestId: 1,
    onStartPlayback: async request => { played.push(request); return true; }, ...props
  }, { onMount() {}, tick: async () => {}, captionAt: () => "", getRunningSharedAudioContext: () => null });
  return { harness, played };
}
test("表示中とは別の固定音声も、一回のautoplay要求で選択して再生する", async () => {
  const { harness, played } = radio({ items: [ready, fixed], autoplayRequestId: 0 });
  harness.update({ autoplayContentId: fixed.contentId, autoplayRequestId: 1 });
  harness.flush();
  await Promise.resolve();
  harness.flush();
  assert.equal(played.length, 1);
  assert.equal(played[0].item.id, fixed.id);
  assert.equal(played[0].segments[0].url, fixed.audioUrl);
});
test("再生中・再生開始中の同じ番組へのautoplay要求は、終了後へ持ち越さない", async () => {
  for (const field of ["playbackItemId", "playbackLoadingItemId"]) {
    const { harness, played } = radio({ items: [fixed], autoplayRequestId: 0, [field]: fixed.id });
    harness.update({ autoplayContentId: fixed.contentId, autoplayRequestId: 1 });
    assert.equal(played.length, 0);
    harness.update({ [field]: "" });
    await Promise.resolve();
    harness.flush();
    assert.equal(played.length, 0, `${field}が解除されても再再生しない`);
  }
});
test("別番組の生成待ちは選択更新で取り消さず、ready後に一度だけ再生する", async () => {
  const { harness, played } = radio({ items: [fixed, waiting], autoplayRequestId: 0 });
  harness.update({ autoplayContentId: waiting.contentId, autoplayRequestId: 1 });
  harness.flush();
  assert.equal(played.length, 0);
  harness.update({ items: [fixed, ready] });
  await Promise.resolve();
  harness.flush();
  assert.equal(played.length, 1);
  assert.equal(played[0].item.id, ready.id);
});
test("再生条件を満たさない固定番組へのautoplayは、後の条件成立を待たない", async () => {
  const { harness, played } = radio({ items: [{ ...fixed, playbackDisabledLabel: "現在は再生できません" }], autoplayContentId: fixed.contentId });
  harness.update({ items: [fixed] });
  await Promise.resolve();
  harness.flush();
  assert.equal(played.length, 0);
});
test("選択の描画待ちに停止・画面破棄されたautoplayは再開しない", async () => {
  for (const cancel of [h => h.evaluate("stopPlayback()"), h => h.destroy()]) {
    const { harness, played } = radio({ items: [ready, fixed], autoplayRequestId: 0 });
    harness.update({ autoplayContentId: fixed.contentId, autoplayRequestId: 1 });
    cancel(harness);
    await Promise.resolve();
    assert.equal(played.length, 0);
  }
});
test("生成待ちの途中で手動再生が始まったら、終了後にautoplayを残さない", async () => {
  const { harness, played } = radio();
  harness.update({ items: [ready], playbackLoadingItemId: ready.id });
  harness.update({ playbackLoadingItemId: "", playbackItemId: ready.id });
  harness.update({ playbackItemId: "" });
  await Promise.resolve();
  harness.flush();
  assert.equal(played.length, 0);
});
test("ラジオは準備中の明示autoplayを保持し、ready後に一度だけ再生する", async () => {
  const { harness, played } = radio();
  assert.equal(played.length, 0);
  harness.update({ items: [ready] });
  await Promise.resolve();
  harness.flush();
  assert.equal(played.length, 1);
  assert.equal(played[0].segments[0].url, "/ready.wav");
});
test("停止と対象変更は待機autoplayを取り消し、未指示のreadyでは再生しない", () => {
  for (const cancel of [h => h.evaluate("stopPlayback()"), h => h.update({ items: [waiting, { id: "other", contentId: "other" }], focusContentId: "other", focusContentRequestId: 1 })]) {
    const { harness, played } = radio();
    cancel(harness);
    harness.update({ items: [ready] });
    assert.equal(played.length, 0);
  }
  const ordinary = radio({ autoplayRequestId: 0 });
  ordinary.harness.update({ items: [ready] });
  assert.equal(ordinary.played.length, 0);
});
test("failedは待機表示と区別し、画面内で再取得できる", async () => {
  let reads = 0;
  const { harness } = radio({ items: [{ ...waiting, generatedAudio: { status: "failed" } }], onRefresh: async () => { reads += 1; } });
  assert.equal(harness.evaluate("broadcastWaiting"), false);
  assert.equal(harness.evaluate("broadcastFailed"), true);
  await harness.evaluate("refreshAudioState()");
  assert.equal(reads, 1);
});
