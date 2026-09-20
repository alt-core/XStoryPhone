import { renderTemplate } from "../../shared/condition.ts";
import type { ScenarioTalk } from "../../shared/scenario.ts";
import { messageTemplatesForBlock } from "../scenario.ts";

export type TalkRecentMessage = { speaker: string; body: string };

// stayで直近履歴が増えても、現在の問いを文脈から落とさない。
export function talkFlowRecentMessages(
  talk: ScenarioTalk,
  fromId: string,
  stateValues: Record<string, unknown>,
  recentMessages: readonly TalkRecentMessage[] = []
): TalkRecentMessage[] {
  const env = Object.fromEntries(Object.entries(stateValues)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => [key, String(value)]));
  const fromMessages = messageTemplatesForBlock(fromId).slice(-2).map((template) => ({
    speaker: template.senderRole === "owner" ? "phone_owner" : template.senderName || talk.label || "other",
    body: renderTemplate(template.body, env).trim()
  })).filter((message) => message.body);
  const seen = new Set<string>();
  return [...fromMessages, ...recentMessages.filter((message) => message.body).slice(-2)]
    .filter((message) => {
      const key = `${message.speaker}\0${message.body}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
