import { tick } from "svelte";

type ConversationScrollAppId = "messages" | "chat";

const scrollPositions = new Map<string, number>();
const BOTTOM_THRESHOLD_PX = 120;

function scrollKey(appId: ConversationScrollAppId, threadId: string) {
  return `${appId}:${threadId}`;
}

function rememberConversationScroll(appId: ConversationScrollAppId, threadId: string, scrollTop: number) {
  if (!threadId) {
    return;
  }

  scrollPositions.set(scrollKey(appId, threadId), scrollTop);
}

function forgetConversationScroll(appId: ConversationScrollAppId, threadId: string) {
  if (!threadId) {
    return;
  }

  scrollPositions.delete(scrollKey(appId, threadId));
}

export function consumeConversationScroll(appId: ConversationScrollAppId, threadId: string) {
  const key = scrollKey(appId, threadId);
  const scrollTop = scrollPositions.get(key);
  scrollPositions.delete(key);

  return scrollTop;
}

export function isConversationNearBottom(element: HTMLElement | undefined) {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX;
}

export function rememberConversationScrollForLink(appId: ConversationScrollAppId, threadId: string, element: HTMLElement | undefined) {
  if (!threadId || !element) {
    return;
  }

  if (isConversationNearBottom(element)) {
    forgetConversationScroll(appId, threadId);
    return;
  }

  rememberConversationScroll(appId, threadId, element.scrollTop);
}

function applyScrollTop(element: HTMLElement | undefined, scrollTop: number) {
  if (!element) {
    return;
  }

  element.scrollTop = scrollTop;
  element.dispatchEvent(new Event("scroll"));
}

export function scrollConversationToBottomAfterTick(element: () => HTMLElement | undefined) {
  void tick().then(() => {
    const applyBottomScroll = () => {
      const target = element();
      applyScrollTop(target, target?.scrollHeight ?? 0);
    };

    applyBottomScroll();
    window.requestAnimationFrame(applyBottomScroll);
  });
}

export function restoreConversationScrollAfterTick(element: () => HTMLElement | undefined, scrollTop: number) {
  void tick().then(() => {
    applyScrollTop(element(), scrollTop);
  });
}
