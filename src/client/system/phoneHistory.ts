import type { AppId } from "../scenario-runtime/types";
import { isAppId } from "../../shared/appRegistry.ts";
import { isMemoryStorage } from "./clientStorage.ts";

// ブラウザーのタブ内ページ履歴。戻った時に表示とアプリ内の戻るボタンを当時のとおりに復元する。
export type BrowserPageHistory = {
  urls: string[];
  index: number;
};

export type PhoneHistoryRoute =
  | { kind: "home" }
  | { kind: "app"; appId: AppId; contentId?: string; page?: BrowserPageHistory };

export type PhoneHistoryState = {
  owner: "xstoryphone";
  version: 1;
  scope: string;
  index: number;
  route: PhoneHistoryRoute;
  previousRoute?: PhoneHistoryRoute;
};

type HistoryLike = Pick<History, "state" | "pushState" | "replaceState" | "back">;
type PhoneHistoryMarker = Pick<PhoneHistoryState, "owner" | "version" | "scope" | "index">;

export const BROWSER_PAGE_HISTORY_LIMIT = 50;
const BROWSER_PAGE_URL_MAX_LENGTH = 2048;

// 画面詳細は現在のページ・スコープだけで保持し、History APIには識別子だけ渡す。
let memoryScope: string | undefined;
const memoryStates = new Map<number, PhoneHistoryState>();

function browserPageHistoryFrom(value: unknown): BrowserPageHistory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const page = value as { urls?: unknown; index?: unknown };
  if (
    !Array.isArray(page.urls)
    || page.urls.length === 0
    || page.urls.length > BROWSER_PAGE_HISTORY_LIMIT
    || !page.urls.every((url) => typeof url === "string" && url.trim() && url.length <= BROWSER_PAGE_URL_MAX_LENGTH)
    || !Number.isInteger(page.index)
    || (page.index as number) < 0
    || (page.index as number) >= page.urls.length
  ) {
    return null;
  }

  return { urls: [...page.urls as string[]], index: page.index as number };
}

function routeFrom(value: unknown): PhoneHistoryRoute | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const route = value as { kind?: unknown; appId?: unknown; contentId?: unknown; page?: unknown };
  if (route.kind === "home") {
    return { kind: "home" };
  }
  if (route.kind !== "app" || !isAppId(route.appId)) {
    return null;
  }
  if (route.contentId !== undefined && (typeof route.contentId !== "string" || !route.contentId.trim())) {
    return null;
  }
  const page = route.page === undefined ? undefined : browserPageHistoryFrom(route.page);
  if (page === null || (page && (route.appId !== "browser" || route.contentId === undefined))) {
    return null;
  }

  return {
    kind: "app",
    appId: route.appId as AppId,
    ...(typeof route.contentId === "string" ? { contentId: route.contentId } : {}),
    ...(page ? { page } : {})
  };
}

export function phoneHistoryMarkerFrom(value: unknown): PhoneHistoryMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const state = value as Partial<PhoneHistoryMarker>;
  if (
    state.owner !== "xstoryphone"
    || state.version !== 1
    || typeof state.scope !== "string"
    || !state.scope
    || !Number.isInteger(state.index)
    || (state.index ?? -1) < 0
  ) {
    return null;
  }

  return {
    owner: "xstoryphone",
    version: 1,
    scope: state.scope,
    index: state.index as number
  };
}

export function phoneHistoryStateFrom(value: unknown, scope?: string): PhoneHistoryState | null {
  const marker = phoneHistoryMarkerFrom(value);
  if (!marker || (scope !== undefined && marker.scope !== scope)) {
    return null;
  }
  const state = isMemoryStorage
    ? (marker.scope === memoryScope ? memoryStates.get(marker.index) : undefined)
    : value as Partial<PhoneHistoryState>;
  if (!state) {
    return null;
  }
  const route = routeFrom(state.route);
  const previousRoute = state.previousRoute === undefined ? undefined : routeFrom(state.previousRoute);
  if (!route || (state.previousRoute !== undefined && !previousRoute)) {
    return null;
  }

  return {
    ...marker,
    route,
    ...(previousRoute ? { previousRoute } : {})
  };
}

function writePhoneHistoryState(history: HistoryLike, next: PhoneHistoryState, method: "pushState" | "replaceState") {
  if (!isMemoryStorage) {
    history[method](next, "");
    return;
  }

  const { owner, version, scope, index } = next;
  history[method]({ owner, version, scope, index }, "");
  if (memoryScope !== scope) {
    memoryStates.clear();
    memoryScope = scope;
  } else if (method === "pushState") {
    for (const previousIndex of memoryStates.keys()) {
      if (previousIndex >= index) memoryStates.delete(previousIndex);
    }
  }
  memoryStates.set(index, next);
}

function sameBrowserPageHistory(left: BrowserPageHistory | undefined, right: BrowserPageHistory | undefined) {
  return left === right || Boolean(
    left && right
    && left.index === right.index
    && left.urls.length === right.urls.length
    && left.urls.every((url, index) => url === right.urls[index])
  );
}

export function samePhoneHistoryRoute(left: PhoneHistoryRoute, right: PhoneHistoryRoute) {
  return left.kind === right.kind
    && (left.kind === "home" || (
      right.kind === "app"
      && left.appId === right.appId
      && left.contentId === right.contentId
      && sameBrowserPageHistory(left.page, right.page)
    ));
}

export function replacePhoneHistoryRoute(history: HistoryLike, scope: string, route: PhoneHistoryRoute) {
  const current = phoneHistoryStateFrom(history.state, scope);
  const next: PhoneHistoryState = {
    owner: "xstoryphone",
    version: 1,
    scope,
    index: current?.index ?? 0,
    route,
    ...(current?.previousRoute ? { previousRoute: current.previousRoute } : {})
  };
  writePhoneHistoryState(history, next, "replaceState");
  return next;
}

export function pushPhoneHistoryRoute(history: HistoryLike, scope: string, route: PhoneHistoryRoute) {
  const current = phoneHistoryStateFrom(history.state, scope);
  if (!current) {
    return replacePhoneHistoryRoute(history, scope, route);
  }
  if (samePhoneHistoryRoute(current.route, route)) {
    return current;
  }

  const next: PhoneHistoryState = {
    owner: "xstoryphone",
    version: 1,
    scope,
    index: current.index + 1,
    route,
    previousRoute: current.route
  };
  writePhoneHistoryState(history, next, "pushState");
  return next;
}

export function goBackInPhoneHistory(history: HistoryLike, scope: string, expectedPreviousAppId?: AppId) {
  const current = phoneHistoryStateFrom(history.state, scope);
  if (
    !current
    || current.index <= 0
    || (expectedPreviousAppId !== undefined && (
      current.previousRoute?.kind !== "app" || current.previousRoute.appId !== expectedPreviousAppId
    ))
  ) {
    return false;
  }
  history.back();
  return true;
}
