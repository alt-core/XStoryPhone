import type { AppId, AssistantMessage, TransientAssistantMessage } from "../scenario-runtime/types";

export function albumMediaAddedAssistantKey(appId: AppId, contentId: string) {
  return `${appId}:${contentId}`;
}

export function selectAssistantSurfaceMessage(transient: TransientAssistantMessage | undefined, authored: AssistantMessage | undefined) {
  return transient ?? authored;
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
  transientMessage: TransientAssistantMessage | undefined;
}) {
  const keyPrefix = `${appId}:`;
  return {
    pendingKeys: pendingKeys.filter((key) => !key.startsWith(keyPrefix)),
    transientMessage:
      transientMessage?.surface === appId && transientMessage.notice === "album_added"
        ? undefined
        : transientMessage
  };
}
