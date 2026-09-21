import type { ScenarioTalkBlockMessage } from "./scenario.ts";

export function templateVariableNames(value: string) {
  return [...value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/gu)].map(match => match[1]);
}

// 未取得の初期履歴も通常台本と同じキー集合を使い、開始時のenvだけ確保する。
export function messageTemplateKeys(message: Pick<ScenarioTalkBlockMessage, "body" | "segments" | "quickReplies" | "initialTemplateKeys">) {
  return message.initialTemplateKeys ?? [...new Set([
    ...templateVariableNames(message.body),
    ...(message.segments ?? []).flatMap(segment => segment.kind === "text" ? templateVariableNames(segment.text) : []),
    ...(message.quickReplies ?? []).flatMap(templateVariableNames)
  ])];
}
