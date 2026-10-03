export const REQUIRED_ASSISTANT_TRIGGERS = ["blocked_link", "search_open_failed", "album_added", "repaired", "history_repaired"] as const;
export type AssistantNotice = typeof REQUIRED_ASSISTANT_TRIGGERS[number] | "app_unavailable";
export type AssistantMessage = {
  id: string;
  trigger: string;
  body: string;
  weight: number;
  agentAction?: "idle" | "hi";
  hide?: "auto" | "close" | "never";
};

export function validAssistantTrigger(trigger: string, appIds: ReadonlySet<string>) {
  if ((REQUIRED_ASSISTANT_TRIGGERS as readonly string[]).includes(trigger) || trigger === "app_unavailable") return true;
  const [kind, appId, extra] = trigger.split(":");
  return extra === undefined && Boolean(appId)
    && (kind === "screen" || ["app_unavailable", "blocked_link", "repaired", "history_repaired"].includes(kind))
    && (appIds.has(appId) || (kind === "screen" && appId === "home"));
}

// 原因別の段階を混ぜて抽選しない。パネル内の開封失敗には独立した文脈を使う。
export function assistantNoticeTriggers(notice: AssistantNotice, appId?: string) {
  if (notice === "search_open_failed" || notice === "album_added") return [notice];
  return [...(appId ? [`${notice}:${appId}`] : []), notice, ...(notice === "app_unavailable" ? ["blocked_link"] : [])];
}

export function hasAssistantCandidate(messages: readonly AssistantMessage[], trigger: string) {
  return messages.some(message => message.trigger === trigger && message.weight > 0);
}

export function selectAssistantMessage<T extends AssistantMessage>(messages: readonly T[], triggers: readonly string[], random = Math.random): T | undefined {
  for (const trigger of triggers) {
    const candidates = messages.filter(message => message.trigger === trigger && message.weight > 0);
    if (!candidates.length) continue;
    let cursor = random() * candidates.reduce((sum, message) => sum + message.weight, 0);
    for (const message of candidates) {
      cursor -= message.weight;
      if (cursor <= 0) return message;
    }
    return candidates[candidates.length - 1];
  }
}
