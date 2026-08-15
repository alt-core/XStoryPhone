import type { AppId, AssistantMessage } from "../scenario-runtime/types";

export const ALBUM_MEDIA_ADDED_ASSISTANT_BODY = "新しいデータをアルバムに追加しておきました！";

export function albumMediaAddedAssistantKey(appId: AppId, contentId: string) {
  return `${appId}:${contentId}`;
}

export function isAlbumMediaAddedAssistant(message: AssistantMessage | undefined) {
  return message?.body === ALBUM_MEDIA_ADDED_ASSISTANT_BODY;
}

export function assistantHiddenByComposerPhotoDraft(activeAppId: AppId | null, draftByApp: Partial<Record<AppId, boolean>>) {
  if (activeAppId !== "messages" && activeAppId !== "chat") {
    return false;
  }

  return draftByApp[activeAppId] === true;
}

export function clearAlbumAssistantStateForPhotoDraft({
  appId,
  pendingKeys,
  transientMessage
}: {
  appId: AppId;
  pendingKeys: readonly string[];
  transientMessage: AssistantMessage | undefined;
}) {
  const keyPrefix = `${appId}:`;
  return {
    pendingKeys: pendingKeys.filter((key) => !key.startsWith(keyPrefix)),
    transientMessage:
      transientMessage?.surface === appId && isAlbumMediaAddedAssistant(transientMessage)
        ? undefined
        : transientMessage
  };
}
