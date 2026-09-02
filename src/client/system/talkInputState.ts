import type { TalkInputState } from "../scenario-runtime/types.ts";

type SequencedTalkItem = {
  id: string;
  seq?: number;
  sender: "owner" | "other";
  quickReplies?: string[];
};

function itemSeq(item: SequencedTalkItem, index: number) {
  return typeof item.seq === "number" && Number.isInteger(item.seq) && item.seq > 0
    ? item.seq
    : index + 1;
}

function delayedTrue(value: boolean, afterSeq: number, latestVisibleSeq: number, firstLoadedSeq: number) {
  if (!value) return false;
  return afterSeq <= 0
    || latestVisibleSeq >= afterSeq
    || (firstLoadedSeq > 0 && firstLoadedSeq > afterSeq);
}

export function resolvedTalkInputState(
  state: TalkInputState | undefined,
  items: readonly SequencedTalkItem[],
  visibleItemIds: ReadonlySet<string>
) {
  if (!state) return { visible: true, enabled: false, canSubmit: false };
  const firstLoadedSeq = items.length ? itemSeq(items[0], 0) : 0;
  const latestVisibleSeq = items.reduce((latest, item, index) => (
    visibleItemIds.has(item.id) ? Math.max(latest, itemSeq(item, index)) : latest
  ), 0);
  const visible = delayedTrue(state.inputVisible, state.inputVisibleAfterSeq, latestVisibleSeq, firstLoadedSeq);
  const enabled = delayedTrue(state.inputEnabled, state.inputEnabledAfterSeq, latestVisibleSeq, firstLoadedSeq);
  return { visible, enabled, canSubmit: state.canPost && enabled };
}

export function latestQuickReplyPlacement(
  items: readonly SequencedTalkItem[],
  visibleItemIds: ReadonlySet<string>,
  canSubmit: boolean
) {
  if (!canSubmit) return undefined;
  const latest = items[items.length - 1];
  if (!latest || latest.sender !== "other" || !visibleItemIds.has(latest.id) || !latest.quickReplies?.length) {
    return undefined;
  }
  return { messageId: latest.id, replies: latest.quickReplies };
}
