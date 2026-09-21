import type { StoredPlayerState } from "../../server/store.ts";
import type { ScenarioRuntime } from "../scenarioRuntime.ts";
import { resolveMediaRecord } from "../../shared/scenarioMedia.ts";
// 定義はこの実行単位に閉じ込め、別プレイヤーの処理と共有変更しない。
export function createTalkCommandRuntime(runtime: ScenarioRuntime) {
  const { contentAvailable, contentByInternalId, contentByPublicId } = runtime;
  function talkCommand(value: string) {
    const match = /^(photo|share):([a-zA-Z0-9_:-]+)$/u.exec(value);
    return match ? { kind: match[1] as "photo" | "share", contentId: match[2] } : null;
  }
  function internalizeTalkCommand(value: string) {
    const command = talkCommand(value);
    if (!command)
      return value;
    const content = contentByPublicId(command.contentId);
    return content ? `${command.kind}:${content.id}` : `${command.kind}:__invalid_content__`;
  }
  function talkCommandAvailable(value: string, state: StoredPlayerState) {
    const command = talkCommand(value);
    if (!command)
      return true;
    const content = contentByInternalId(command.contentId);
    if (!content || content.appId !== (command.kind === "photo" ? "photos" : "radio"))
      return false;
    if (!contentAvailable(content, state))
      return false;
    if (command.kind !== "photo") return true;
    const media = resolveMediaRecord(content.record,runtime.workerScenario.attachments,false);
    return ["imageUrl","audioUrl","videoUrl"].some(key=>typeof media[key]==="string" && media[key]);
  }
  function semanticInputForTalkCommand(value: string) {
    const command = talkCommand(value);
    if (!command)
      return value;
    const content = contentByInternalId(command.contentId);
    const photoDescription = command.kind === "photo" ? runtime.workerScenario.photoDescriptions[command.contentId]?.trim() : "";
    const label = content && ["title", "programTitle", "name"]
      .map((key) => content.record[key])
      .find((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return command.kind === "photo"
      ? photoDescription
        ? `プレイヤーはテキスト本文なしで、次の内容の画像または動画コンテンツだけを添付しました: ${photoDescription}`
        : `プレイヤーは${label ? `「${label}」という` : ""}画像または動画を添付しました。`
      : `プレイヤーは${label ? `「${label}」という` : ""}ラジオ項目を共有しました。`;
  }
  return { talkCommand, internalizeTalkCommand, talkCommandAvailable, semanticInputForTalkCommand };
}
