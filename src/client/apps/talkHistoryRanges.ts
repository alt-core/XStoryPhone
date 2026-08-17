import type { BrokenTalkHistoryRange } from "../scenario-runtime/types";

type SequencedMessage = { seq?: number };

function messageSeq(message: SequencedMessage | undefined, fallback: number) {
  return typeof message?.seq === "number" && Number.isInteger(message.seq) && message.seq > 0
    ? message.seq
    : fallback;
}

export function brokenRangesBeforeMessage(
  messages: readonly SequencedMessage[],
  ranges: readonly BrokenTalkHistoryRange[],
  messageIndex: number
) {
  const previousSeq = messageIndex > 0 ? messageSeq(messages[messageIndex - 1], messageIndex) : 0;
  const currentSeq = messageSeq(messages[messageIndex], messageIndex + 1);
  return ranges.filter((range) => range.beforeSeq > previousSeq && range.beforeSeq <= currentSeq);
}

export function brokenRangesAfterMessages(
  messages: readonly SequencedMessage[],
  ranges: readonly BrokenTalkHistoryRange[]
) {
  const lastSeq = messageSeq(messages[messages.length - 1], messages.length);
  return ranges.filter((range) => range.beforeSeq > lastSeq);
}
