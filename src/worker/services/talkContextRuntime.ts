import { renderTemplate } from "../../shared/condition.ts";
import type { ScenarioTalk } from "../../shared/scenario.ts";
import type { ScenarioRuntime } from "../scenarioRuntime.ts";
export type TalkRecentMessage = {
  speaker: string;
  body: string;
};
// 定義はこの実行単位に閉じ込め、別プレイヤーの処理と共有変更しない。
export function createTalkContextRuntime(runtime: Pick<ScenarioRuntime, "messageTemplatesForBlock">) {
  const { messageTemplatesForBlock } = runtime;
  // stayで直近履歴が増えても、現在の問いを文脈から落とさない。

  function talkFlowRecentMessages(talk: ScenarioTalk, fromId: string, stateValues: Record<string, unknown>, recentMessages: readonly TalkRecentMessage[] = []): TalkRecentMessage[] {
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
        if (seen.has(key))
          return false;
        seen.add(key);
        return true;
      });
  }
  return { talkFlowRecentMessages };
}
