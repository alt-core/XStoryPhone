import type { PhoneHistoryState } from "./phoneHistory.ts";
import { isConversationNearBottom } from "../apps/conversationScrollMemory.ts";

export type PhoneHistoryScrollPositions = NonNullable<NonNullable<PhoneHistoryState["view"]>["appScroll"]>;
type ScrollPosition = PhoneHistoryScrollPositions[number];

function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    // 別オリジンのフレームにはアクセスしない。
    return null;
  }
}

export function capturePhoneHistoryScroll(root: HTMLElement | null): PhoneHistoryScrollPositions {
  const positions: PhoneHistoryScrollPositions = [];
  if (!root) return positions;

  function capture(element: Element, path: number[]) {
    // 会話は末尾にいた事実を残し、戻る間に届いた新着も含めて末尾へ復元する。
    const followsConversation = element.getAttribute("data-phone-history-scroll") === "conversation"
      && isConversationNearBottom(element as HTMLElement);
    if (
      followsConversation || element.scrollTop !== 0 || element.scrollLeft !== 0
      || element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
    ) {
      positions.push({ path, top: element.scrollTop, left: element.scrollLeft, ...(followsConversation ? { bottom: true } : {}) });
    }
    if (element.tagName === "IFRAME") {
      const scrollingElement = frameDocument(element as HTMLIFrameElement)?.scrollingElement;
      if (scrollingElement) {
        positions.push({ path, top: scrollingElement.scrollTop, left: scrollingElement.scrollLeft, frame: true });
      }
    }
    Array.from(element.children).forEach((child, index) => capture(child, [...path, index]));
  }

  capture(root, []);
  return positions;
}

function elementAt(root: HTMLElement, path: number[]): Element | undefined {
  let element: Element | undefined = root;
  for (const index of path) {
    element = element?.children[index];
    if (!element) return undefined;
  }
  return element;
}

function restoreElement(element: Element, position: ScrollPosition) {
  element.scrollTop = position.bottom ? element.scrollHeight : position.top;
  element.scrollLeft = position.left;
}

// 画面遷移時には戻り値を呼び、古い iframe の読み込み待ちを解除する。
export function restorePhoneHistoryScroll(
  root: HTMLElement | null,
  positions: PhoneHistoryScrollPositions | undefined
): () => void {
  const cleanups: Array<() => void> = [];
  if (!root || !positions) return () => {};

  for (const position of positions) {
    const element = elementAt(root, position.path);
    if (!element) continue;
    if (!position.frame) {
      restoreElement(element, position);
      continue;
    }
    if (element.tagName !== "IFRAME") continue;

    const frame = element as HTMLIFrameElement;
    const document = frameDocument(frame);
    if (document?.scrollingElement) restoreElement(document.scrollingElement, position);

    // location.replace 直後は以前の完了済み document が見えるため、次の load も一度だけ待つ。
    const restoreOnLoad = () => {
      frame.removeEventListener("load", restoreOnLoad);
      // 同じ位置に別の画面が描画されていても、以前の要素から復元しない。
      if (elementAt(root, position.path) !== frame) return;
      const scrollingElement = frameDocument(frame)?.scrollingElement;
      if (scrollingElement) restoreElement(scrollingElement, position);
    };
    frame.addEventListener("load", restoreOnLoad);
    cleanups.push(() => frame.removeEventListener("load", restoreOnLoad));
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
