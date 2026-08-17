import assert from "node:assert/strict";
import test from "node:test";
import { captionAt } from "../src/client/system/timedTranscript.ts";

test("字幕は再生位置以前の最後の項目を表示する", () => {
  const transcript = [
    { atMs: 0, text: "開始" },
    { atMs: 2_000, text: "途中" },
    { atMs: 4_000, text: "終了" }
  ];
  assert.equal(captionAt(transcript, 0), "開始");
  assert.equal(captionAt(transcript, 3_999), "途中");
  assert.equal(captionAt(transcript, 4_000), "終了");
});

test("字幕データは省略できる", () => {
  assert.equal(captionAt(undefined, 3_000), "");
  assert.equal(captionAt([], 3_000), "");
});
