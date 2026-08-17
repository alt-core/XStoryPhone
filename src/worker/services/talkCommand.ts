import type { StoredPlayerState } from "../../server/store.ts";
import { contentAvailable, contentByInternalId, contentByPublicId, workerScenario } from "../scenario.ts";

export function talkCommand(value: string) {
  const match = /^(photo|share):([a-zA-Z0-9_:-]+)$/u.exec(value);
  return match ? { kind: match[1] as "photo" | "share", contentId: match[2] } : null;
}

export function internalizeTalkCommand(value: string) {
  const command = talkCommand(value);
  if (!command) return value;
  const content = contentByPublicId(command.contentId);
  return content ? `${command.kind}:${content.id}` : `${command.kind}:__invalid_content__`;
}

export function talkCommandAvailable(value: string, state: StoredPlayerState) {
  const command = talkCommand(value);
  if (!command) return true;
  const content = contentByInternalId(command.contentId);
  if (!content || content.appId !== (command.kind === "photo" ? "photos" : "radio")) return false;
  if (!contentAvailable(content, state)) return false;
  return command.kind === "photo"
    ? typeof content.record.imageUrl === "string"
      || typeof content.record.audioUrl === "string"
      || typeof content.record.videoUrl === "string"
    : true;
}

export function semanticInputForTalkCommand(value: string) {
  const command = talkCommand(value);
  if (!command) return value;
  const content = contentByInternalId(command.contentId);
  const photoDescription = command.kind === "photo" ? workerScenario.photoDescriptions[command.contentId]?.trim() : "";
  const label = content && ["title", "programTitle", "name"]
    .map((key) => content.record[key])
    .find((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return command.kind === "photo"
    ? photoDescription
      ? `プレイヤーはテキスト本文なしで、次の内容の画像または動画コンテンツだけを添付しました: ${photoDescription}`
      : `プレイヤーは${label ? `「${label}」という` : ""}画像または動画を添付しました。`
    : `プレイヤーは${label ? `「${label}」という` : ""}ラジオ項目を共有しました。`;
}
