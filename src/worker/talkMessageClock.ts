import type { StoredTalkEvent } from "../server/store.ts";
import type { StoredTalkMessage } from "../shared/scenario.ts";

export function nextTalkMessageSentAt(lastDeliveredAt: string, earliestSentAt: string) {
  const previous = Date.parse(lastDeliveredAt);
  const earliest = Date.parse(earliestSentAt);
  return new Date(Number.isFinite(previous) ? Math.max(earliest, previous + 1) : earliest).toISOString();
}

export function latestTalkDeliveredAt(
  previous: string,
  events: readonly Pick<StoredTalkEvent, "delivered_at">[],
  messages: readonly Pick<StoredTalkMessage, "sentAt">[]
) {
  let latest = Date.parse(previous);
  // 空blockも記録順を持つため、展開後のmessageだけで水位を決めない。
  for (const value of [...events.map((event) => event.delivered_at), ...messages.map((message) => message.sentAt)]) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && (!Number.isFinite(latest) || timestamp > latest)) latest = timestamp;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : "";
}
