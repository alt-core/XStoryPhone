import { pathnameKey } from "../../shared/deploymentUrls.ts";
import type { BrowserTabItem } from "../scenario-runtime/types";
import { BROWSER_PAGE_HISTORY_LIMIT, type BrowserPageHistory } from "./phoneHistory.ts";
import { resourceUrl } from "./resourceUrls.ts";

export function browserTabContentId(tab: Pick<BrowserTabItem, "id" | "contentId">) {
  return tab.contentId ?? tab.id;
}

export function normalizeBrowserDisplayUrl(value: string) {
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
}

export function browserDocumentKey(value: string, includeHash = false) {
  try {
    const url = new URL(value, window.location.origin);
    const path = pathnameKey(url.pathname);
    return path !== null && url.origin === window.location.origin
      ? `${path}${url.search}${includeHash ? url.hash : ""}`
      : "";
  } catch {
    return "";
  }
}

export function browserUrlAllowed(tab: Pick<BrowserTabItem, "url" | "allowedUrls">, value: string) {
  const targetKey = browserDocumentKey(value);
  if (!targetKey) {
    return false;
  }
  return [tab.url, ...(tab.allowedUrls ?? [])]
    .filter((url): url is string => Boolean(url))
    .some((url) => browserDocumentKey(resourceUrl(url)) === targetKey);
}

export function browserStartUrl(tab: Pick<BrowserTabItem, "url">) {
  return tab.url ? normalizeBrowserDisplayUrl(resourceUrl(tab.url)) : "";
}

export function initialBrowserPage(tab: Pick<BrowserTabItem, "url">): BrowserPageHistory | undefined {
  const url = browserStartUrl(tab);
  return url ? { urls: [url], index: 0 } : undefined;
}

export function currentBrowserPageUrl(page: BrowserPageHistory) {
  return page.urls[page.index] ?? page.urls[0] ?? "";
}

export function sameBrowserDocument(left: string, right: string) {
  const leftKey = browserDocumentKey(left, true);
  return Boolean(leftKey) && leftKey === browserDocumentKey(right, true);
}

// 実ブラウザーと同じく、戻った位置から別のページへ移ると先の履歴は捨てる。
export function navigateBrowserPage(page: BrowserPageHistory, url: string): BrowserPageHistory {
  if (sameBrowserDocument(currentBrowserPageUrl(page), url)) {
    return page;
  }
  const urls = [...page.urls.slice(0, page.index + 1), url].slice(-BROWSER_PAGE_HISTORY_LIMIT);
  return { urls, index: urls.length - 1 };
}

export function replaceBrowserPageUrl(page: BrowserPageHistory, url: string): BrowserPageHistory {
  const urls = page.urls.map((item, index) => (index === page.index ? url : item));
  return { urls, index: page.index };
}

export function stepBackBrowserPage(page: BrowserPageHistory): BrowserPageHistory | undefined {
  return page.index > 0 ? { urls: page.urls, index: page.index - 1 } : undefined;
}

// 外から開いたタブは最初のページへ移る。前に見ていたページはアプリ内の戻るボタンで戻れる。
export function browserPageAtStart(page: BrowserPageHistory | undefined, tab: Pick<BrowserTabItem, "url">) {
  const start = initialBrowserPage(tab);
  if (!start) {
    return page;
  }
  return page ? navigateBrowserPage(page, start.urls[0]) : start;
}
