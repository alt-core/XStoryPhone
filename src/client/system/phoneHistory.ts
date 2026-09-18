import type { AppId } from "../scenario-runtime/types";
import { isAppId } from "../../shared/appRegistry.ts";
import { isMemoryStorage } from "./clientStorage.ts";

export type PhoneHistoryRoute =
  | { kind: "home" }
  | { kind: "app"; appId: AppId; contentId?: string };

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

// 画面詳細は現在のページ・スコープだけで保持し、History APIには識別子だけ渡す。
let memoryScope: string | undefined;
const memoryStates = new Map<number, PhoneHistoryState>();

function routeFrom(value: unknown): PhoneHistoryRoute | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const route = value as { kind?: unknown; appId?: unknown; contentId?: unknown };
  if (route.kind === "home") {
    return { kind: "home" };
  }
  if (route.kind !== "app" || !isAppId(route.appId)) {
    return null;
  }
  if (route.contentId !== undefined && (typeof route.contentId !== "string" || !route.contentId.trim())) {
    return null;
  }

  return {
    kind: "app",
    appId: route.appId as AppId,
    ...(typeof route.contentId === "string" ? { contentId: route.contentId } : {})
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

export function samePhoneHistoryRoute(left: PhoneHistoryRoute, right: PhoneHistoryRoute) {
  return left.kind === right.kind
    && (left.kind === "home" || (right.kind === "app" && left.appId === right.appId && left.contentId === right.contentId));
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
