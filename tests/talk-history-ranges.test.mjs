import assert from "node:assert/strict";
import test from "node:test";
import {
  brokenRangesAfterMessages,
  brokenRangesBeforeMessage
} from "../src/client/apps/talkHistoryRanges.ts";

test("破損したtalk初期履歴を元のメッセージ位置へ差し込む", () => {
  const messages = [{ seq: 4 }, { seq: 7 }];
  const ranges = [
    { beforeSeq: 4 },
    { beforeSeq: 7 },
    { beforeSeq: 8 }
  ];

  assert.deepEqual(brokenRangesBeforeMessage(messages, ranges, 0), [ranges[0]]);
  assert.deepEqual(brokenRangesBeforeMessage(messages, ranges, 1), [ranges[1]]);
  assert.deepEqual(brokenRangesAfterMessages(messages, ranges), [ranges[2]]);
});

test("表示メッセージがないtalkでも破損領域を表示する", () => {
  const ranges = [{ beforeSeq: 3 }];
  assert.deepEqual(brokenRangesAfterMessages([], ranges), ranges);
});
