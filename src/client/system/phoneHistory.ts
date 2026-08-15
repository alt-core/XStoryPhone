import type { AppId } from "../scenario-runtime/types";

export type PhoneHistoryRoute =
  | { kind: "home" }
  | { kind: "app"; appId: AppId; contentId?: string };

export type PhoneHistoryState = {
  owner: "xstoryphone";
  version: 1;
  scope: string;
  index: number;
  route: PhoneHistoryRoute;
};

type HistoryLike = Pick<History, "state" | "pushState" | "replaceState" | "go" | "back">;

const appIds = new Set<string>(["phone", "messages", "photos", "chat", "notes", "calendar", "radio"]);

function routeFrom(value: unknown): PhoneHistoryRoute | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const route = value as { kind?: unknown; appId?: unknown; contentId?: unknown };
  if (route.kind === "home") {
    return { kind: "home" };
  }
  if (route.kind !== "app" || typeof route.appId !== "string" || !appIds.has(route.appId)) {
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

export function phoneHistoryStateFrom(value: unknown, scope?: string): PhoneHistoryState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const state = value as Partial<PhoneHistoryState>;
  const route = routeFrom(state.route);
  if (
    state.owner !== "xstoryphone"
    || state.version !== 1
    || typeof state.scope !== "string"
    || !state.scope
    || (scope !== undefined && state.scope !== scope)
    || !Number.isInteger(state.index)
    || (state.index ?? -1) < 0
    || !route
  ) {
    return null;
  }

  return { owner: "xstoryphone", version: 1, scope: state.scope, index: state.index as number, route };
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
    route
  };
  history.replaceState(next, "");
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
    route
  };
  history.pushState(next, "");
  return next;
}

export function goToPhoneHistoryHome(history: HistoryLike, scope: string) {
  const current = phoneHistoryStateFrom(history.state, scope);
  if (current && current.index > 0) {
    history.go(-current.index);
    return true;
  }
  replacePhoneHistoryRoute(history, scope, { kind: "home" });
  return false;
}

export function goBackInPhoneHistory(history: HistoryLike, scope: string) {
  const current = phoneHistoryStateFrom(history.state, scope);
  if (!current || current.index <= 0) {
    return false;
  }
  history.back();
  return true;
}
