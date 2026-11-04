// 従来の文字列はそのまま保ち、発言を変える選択肢だけを一組の値で扱う。
export type QuickReply = string | { label: string; text: string };

export type TalkSendOptions = {
  display?: string;
  quickReplySeq?: number;
};

export function quickReplyLabel(reply: QuickReply) {
  return typeof reply === "string" ? reply : reply.label;
}

export function quickReplyText(reply: QuickReply) {
  return typeof reply === "string" ? reply : reply.text;
}

export function quickReplyTemplateTexts(reply: QuickReply) {
  return typeof reply === "string" ? [reply] : [reply.label, reply.text];
}

export function quickReplySummary(reply: QuickReply) {
  return typeof reply === "string" ? reply : `${reply.label} => ${reply.text}`;
}

export function isQuickReply(value: unknown): value is QuickReply {
  return typeof value === "string" || Boolean(value && typeof value === "object"
    && "label" in value && typeof value.label === "string"
    && "text" in value && typeof value.text === "string");
}
