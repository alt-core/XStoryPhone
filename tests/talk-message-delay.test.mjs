import assert from "node:assert/strict";
import test from "node:test";
import {
  explicitTalkMessageDelayMs,
  queuedTalkMessageDelayMs,
  shouldDelayTalkMessage,
  shouldQueueTalkMessage
} from "../src/client/system/talkMessageDelay.ts";

test("遅延返信の後続メッセージは表示順を追い越さない", () => {
  const delayed = { id: "delayed", sender: "other", delayMs: 350, delayOnFirstDisplay: true };
  const immediate = { id: "immediate", sender: "other" };

  assert.equal(shouldDelayTalkMessage(delayed), true);
  assert.equal(shouldQueueTalkMessage(delayed, 1, 0, false), true);
  assert.equal(shouldQueueTalkMessage(immediate, 2, 0, true), true);
  assert.equal(queuedTalkMessageDelayMs(immediate), 0);
});

test("プレイヤー発話以前の履歴と通常の即時返信は待機させない", () => {
  const delayed = { id: "old", sender: "other", delayMs: 350, delayOnFirstDisplay: true };
  const immediate = { id: "reply", sender: "other" };
  const owner = { id: "owner", sender: "owner", delayMs: 350, delayOnFirstDisplay: true };

  assert.equal(shouldQueueTalkMessage(delayed, 0, 1, false), false);
  assert.equal(shouldQueueTalkMessage(immediate, 2, 1, false), false);
  assert.equal(shouldDelayTalkMessage(owner), false);
});

test("異常に長い表示遅延は既存上限へ収める", () => {
  const message = { id: "long", sender: "other", delayMs: 60_000, delayOnFirstDisplay: true };
  assert.equal(explicitTalkMessageDelayMs(message), 8_000);
  assert.equal(queuedTalkMessageDelayMs(message), 8_000);
});
