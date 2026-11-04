import assert from "node:assert/strict";
import test from "node:test";
import { latestQuickReplyPlacement, resolvedTalkInputState } from "../src/client/system/talkInputState.ts";

const base = {
  canPost: true,
  inputVisible: true,
  inputVisibleAfterSeq: 0,
  inputEnabled: true,
  inputEnabledAfterSeq: 0
};

const items = [
  { id: "one", seq: 1, sender: "other", quickReplies: ["古い候補"] },
  { id: "two", seq: 2, sender: "other", quickReplies: ["はい", "いいえ"] }
];

test("talk入力のshowとenableは境界messageの表示後に反映する", () => {
  const waiting = resolvedTalkInputState(
    { ...base, inputVisibleAfterSeq: 2, inputEnabledAfterSeq: 2 },
    items,
    new Set(["one"])
  );
  assert.deepEqual(waiting, { visible: false, enabled: false, canSubmit: false });

  const reached = resolvedTalkInputState(
    { ...base, inputVisibleAfterSeq: 2, inputEnabledAfterSeq: 2 },
    items,
    new Set(["one", "two"])
  );
  assert.deepEqual(reached, { visible: true, enabled: true, canSubmit: true });
});

test("hideとdisableは遅延境界に関係なく即時反映する", () => {
  const resolved = resolvedTalkInputState(
    { ...base, inputVisible: false, inputVisibleAfterSeq: 2, inputEnabled: false, inputEnabledAfterSeq: 2 },
    items,
    new Set(["one", "two"])
  );
  assert.deepEqual(resolved, { visible: false, enabled: false, canSubmit: false });
});

test("visibleとenabledは独立し、hide中も送信可能・disable中はcomposerだけ表示できる", () => {
  assert.deepEqual(
    resolvedTalkInputState({ ...base, inputVisible: false }, items, new Set(["one", "two"])),
    { visible: false, enabled: true, canSubmit: true }
  );
  assert.deepEqual(
    resolvedTalkInputState({ ...base, inputEnabled: false }, items, new Set(["one", "two"])),
    { visible: true, enabled: false, canSubmit: false }
  );
  assert.deepEqual(
    latestQuickReplyPlacement(items, new Set(["one", "two"]), true),
    { messageId: "two", replies: ["はい", "いいえ"] },
    "composerのhideはQuick Replyを無効化しない"
  );
});

test("履歴windowの先頭より古い境界は到達済みとみなす", () => {
  const trimmed = [{ id: "later", seq: 201, sender: "other" }];
  const resolved = resolvedTalkInputState(
    { ...base, inputVisibleAfterSeq: 180, inputEnabledAfterSeq: 180 },
    trimmed,
    new Set(["later"])
  );
  assert.deepEqual(resolved, { visible: true, enabled: true, canSubmit: true });
});

test("Quick Replyは最新のNPC messageが表示済みかつ送信可能な時だけ配置する", () => {
  assert.equal(latestQuickReplyPlacement(items, new Set(["one"]), true), undefined);
  assert.deepEqual(
    latestQuickReplyPlacement(items, new Set(["one", "two"]), true),
    { messageId: "two", replies: ["はい", "いいえ"] }
  );
  assert.equal(latestQuickReplyPlacement(items, new Set(["one", "two"]), false), undefined);
  assert.deepEqual(
    latestQuickReplyPlacement([...items, { id: "owner", seq: 3, sender: "owner" }], new Set(["one", "two", "owner"]), true),
    undefined
  );
});

test("消費済みseqまでのQuick Replyを閉じ、後続の表示済み候補は出す", () => {
  const visible = new Set(["one", "two"]);
  for (const closedSeq of [2, 3]) {
    assert.equal(latestQuickReplyPlacement(items, visible, true, closedSeq), undefined);
  }
  for (const closedSeq of [undefined, 0, -1, 1]) {
    assert.equal(latestQuickReplyPlacement(items, visible, true, closedSeq)?.messageId, "two");
  }
  const next = { id: "three", seq: 3, sender: "other", quickReplies: [{ label: "次へ", text: "" }] };
  assert.equal(latestQuickReplyPlacement([...items, next], visible, true, 2), undefined, "遅延表示中は前の候補へ戻らない");
  visible.add(next.id);
  const placement = latestQuickReplyPlacement([...items, next], visible, true, 2);
  assert.equal(placement?.messageId, next.id);
  assert.equal(placement?.replies, next.quickReplies, "ラベルと発言の組を分解せず渡す");
  assert.equal(latestQuickReplyPlacement([...items, next], visible, false, 2), undefined);
});

test("seqのない旧履歴でもQuick Replyの消費境界は従来の並び順で扱う", () => {
  const legacy = items.map(({ seq, ...item }) => item);
  assert.equal(latestQuickReplyPlacement(legacy, new Set(["one", "two"]), true, 2), undefined);
  assert.equal(latestQuickReplyPlacement(legacy, new Set(["one", "two"]), true, 1)?.messageId, "two");
});
