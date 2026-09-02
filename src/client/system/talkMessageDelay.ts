export type TalkDelayMessage = {
  id: string;
  sender?: "owner" | "other";
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
};

const MAX_MESSAGE_DELAY_MS = 8_000;

export function explicitTalkMessageDelayMs(message: TalkDelayMessage) {
  if (typeof message.delayMs !== "number" || !Number.isFinite(message.delayMs)) return undefined;
  return Math.max(0, Math.min(message.delayMs, MAX_MESSAGE_DELAY_MS));
}

export function shouldDelayTalkMessage(message: TalkDelayMessage) {
  const delayMs = explicitTalkMessageDelayMs(message);
  return message.sender !== "owner" && message.delayOnFirstDisplay === true && delayMs !== undefined && delayMs > 0;
}

export function shouldQueueTalkMessage(
  message: TalkDelayMessage,
  messageIndex: number,
  ownerIndex: number,
  earlierReplyPending: boolean
) {
  return messageIndex > ownerIndex && (earlierReplyPending || shouldDelayTalkMessage(message));
}

export function queuedTalkMessageDelayMs(message: TalkDelayMessage) {
  return shouldDelayTalkMessage(message) ? explicitTalkMessageDelayMs(message) ?? 0 : 0;
}
