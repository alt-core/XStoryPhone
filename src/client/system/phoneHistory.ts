import type { AppId } from "../scenario-runtime/types";
import { isAppId } from "../../shared/appRegistry.ts";
import { isMemoryStorage } from "./clientStorage.ts";

// ブラウザーのタブ内ページ履歴。戻った時に表示とアプリ内の戻るボタンを当時のとおりに復元する。
export type BrowserPageHistory = {
  urls: string[];
  index: number;
};

export type PhoneHistoryRoute = (
  | { kind: "home" }
  | { kind: "app"; appId: AppId; contentId?: string; page?: BrowserPageHistory }
) & { searchAgentOpen?: boolean };

export type PhoneHistoryView = {
  appScroll?: Array<{ path: number[]; top: number; left: number; frame?: boolean; bottom?: boolean }>;
  searchAgent?: { scrollTop: number; visibleMessageCount: number };
};

export type PhoneHistoryState = {
  owner: "xstoryphone";
  version: 1;
  scope: string;
  index: number;
  route: PhoneHistoryRoute;
  previousRoute?: PhoneHistoryRoute;
  view?: PhoneHistoryView;
};

type HistoryLike = Pick<History, "state" | "pushState" | "replaceState" | "back" | "go">;
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

  const route = value as { kind?: unknown; appId?: unknown; contentId?: unknown; page?: unknown; searchAgentOpen?: unknown };
  if (route.searchAgentOpen !== undefined && typeof route.searchAgentOpen !== "boolean") {
    return null;
  }
  const searchAgent = route.searchAgentOpen ? { searchAgentOpen: true } : {};
  if (route.kind === "home") {
    return { kind: "home", ...searchAgent };
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
    ...(page ? { page } : {}),
    ...searchAgent
  };
}

function viewFrom(value: unknown): PhoneHistoryView | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const view = value as PhoneHistoryView;
  const appScroll = Array.isArray(view.appScroll) && view.appScroll.every((entry) => (
    entry && Array.isArray(entry.path) && entry.path.every((index) => Number.isInteger(index) && index >= 0)
    && Number.isFinite(entry.top) && Number.isFinite(entry.left)
    && (entry.frame === undefined || typeof entry.frame === "boolean")
    && (entry.bottom === undefined || typeof entry.bottom === "boolean")
  )) ? view.appScroll.map((entry) => ({
    path: [...entry.path], top: entry.top, left: entry.left,
    ...(entry.frame === undefined ? {} : { frame: entry.frame }),
    ...(entry.bottom ? { bottom: true } : {})
  })) : undefined;
  const searchAgent = view.searchAgent && Number.isFinite(view.searchAgent.scrollTop)
    && Number.isInteger(view.searchAgent.visibleMessageCount) && view.searchAgent.visibleMessageCount >= 0
    ? { scrollTop: view.searchAgent.scrollTop, visibleMessageCount: view.searchAgent.visibleMessageCount }
    : undefined;
  return {
    ...(appScroll ? { appScroll } : {}),
    ...(searchAgent ? { searchAgent } : {})
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
  const view = viewFrom(state.view);
  if (!route || (state.previousRoute !== undefined && !previousRoute)) {
    return null;
  }

  return {
    ...marker,
    route,
    ...(previousRoute ? { previousRoute } : {}),
    ...(view ? { view } : {})
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

export function samePhoneHistoryPage(left: PhoneHistoryRoute, right: PhoneHistoryRoute) {
  return left.kind === right.kind
    && (left.kind === "home" || (
      right.kind === "app"
      && left.appId === right.appId
      && left.contentId === right.contentId
      && sameBrowserPageHistory(left.page, right.page)
    ));
}

export function samePhoneHistoryRoute(left: PhoneHistoryRoute, right: PhoneHistoryRoute) {
  return Boolean(left.searchAgentOpen) === Boolean(right.searchAgentOpen)
    && samePhoneHistoryPage(left, right);
}

type HistoryOperation =
  | { kind: "push" | "replace"; route: PhoneHistoryRoute; view?: PhoneHistoryView }
  | { kind: "view"; view: PhoneHistoryView }
  | { kind: "back" };
type OperationPlan = {
  state: PhoneHistoryState;
  method: "pushState" | "replaceState" | "collapse" | "back";
};
type PendingTravel = {
  scope: string;
  index: number;
  plan: OperationPlan;
};
type HistoryController = {
  scope: string;
  states: Map<number, PhoneHistoryState>;
  projectedStates: Map<number, PhoneHistoryState>;
  planned: PhoneHistoryState | null;
  queue: HistoryOperation[];
  pending?: PendingTravel;
};

const historyControllers = new WeakMap<HistoryLike, HistoryController>();

function stateWithLatestView(controller: HistoryController, value: unknown, scope = controller.scope) {
  const state = phoneHistoryStateFrom(value, scope);
  if (!state) return null;
  const cached = controller.states.get(state.index);
  if (!cached || cached.scope !== scope || !samePhoneHistoryRoute(cached.route, state.route)) return state;
  // スクロールだけの更新ではHistory APIを書かず、タブ内の最新位置を優先する。
  delete state.view;
  if (cached.view) state.view = cached.view;
  return state;
}

function controllerFor(history: HistoryLike, scope: string) {
  let controller = historyControllers.get(history);
  if (!controller) {
    controller = {
      scope, states: new Map(), projectedStates: new Map(), planned: null, queue: []
    };
    historyControllers.set(history, controller);
  }
  if (controller.scope !== scope) {
    // 実行中のgoは取り消せないため、そのpopだけを待ち、古い操作の書込みは破棄する。
    controller.scope = scope;
    controller.states.clear();
    controller.queue = [];
  }
  if (!controller.pending && controller.queue.length === 0) {
    controller.planned = stateWithLatestView(controller, history.state, scope);
    if (controller.planned) controller.states.set(controller.planned.index, controller.planned);
    controller.projectedStates = new Map(controller.states);
  } else if (controller.planned?.scope !== scope) {
    controller.planned = stateWithLatestView(controller, history.state, scope);
    controller.projectedStates = new Map(controller.states);
  }
  return controller;
}

function planOperation(
  scope: string,
  current: PhoneHistoryState | null,
  operation: HistoryOperation,
  states: Map<number, PhoneHistoryState>
): OperationPlan | null {
  if (operation.kind === "back") {
    if (!current || current.index <= 0) return null;
    const state = states.get(current.index - 1) ?? {
      owner: "xstoryphone", version: 1, scope, index: current.index - 1,
      route: current.previousRoute ?? current.route
    };
    return { state, method: "back" };
  }
  if (operation.kind === "view") {
    return current ? { state: { ...current, view: operation.view }, method: "replaceState" } : null;
  }
  const route = operation.route;
  if (operation.kind === "push" && current && samePhoneHistoryRoute(current.route, route)) {
    return null;
  }
  const view = operation.view ?? (operation.kind === "replace" ? current?.view : undefined);
  const state: PhoneHistoryState = {
    owner: "xstoryphone", version: 1, scope,
    index: current?.index ?? 0,
    route,
    ...(current?.previousRoute ? { previousRoute: current.previousRoute } : {}),
    ...(view ? { view } : {})
  };
  if (operation.kind === "replace" || !current) return { state, method: "replaceState" };
  if (current.previousRoute && samePhoneHistoryPage(current.route, route)
    && samePhoneHistoryRoute(current.previousRoute, route)) {
    const base = states.get(Math.max(0, current.index - 2));
    state.index = Math.max(0, current.index - 1);
    delete state.previousRoute;
    if (current.index >= 2 && base) state.previousRoute = base.route;
    return { state, method: "collapse" };
  }
  state.index = current.index + 1;
  state.previousRoute = current.route;
  return { state, method: "pushState" };
}

function rememberPlan(states: Map<number, PhoneHistoryState>, plan: OperationPlan) {
  if (plan.method === "pushState" || plan.method === "collapse") {
    for (const index of states.keys()) {
      if (index >= plan.state.index) states.delete(index);
    }
  }
  states.set(plan.state.index, plan.state);
}

function rebuildProjection(history: HistoryLike, controller: HistoryController) {
  const pending = controller.pending?.scope === controller.scope ? controller.pending.plan : undefined;
  controller.planned = pending?.state ?? stateWithLatestView(controller, history.state);
  controller.projectedStates = new Map(controller.states);
  if (pending) rememberPlan(controller.projectedStates, pending);
  for (const operation of controller.queue) {
    const plan = planOperation(controller.scope, controller.planned, operation, controller.projectedStates);
    if (!plan) continue;
    controller.planned = plan.state;
    rememberPlan(controller.projectedStates, plan);
  }
}

function matchesTravel(value: unknown, pending: PendingTravel) {
  const marker = phoneHistoryMarkerFrom(value);
  return marker?.scope === pending.scope && marker.index === pending.index;
}

function completeTravel(history: HistoryLike, controller: HistoryController, value: unknown) {
  const pending = controller.pending;
  if (!pending || !matchesTravel(value, pending)) return false;
  delete controller.pending;
  const sameScope = controller.scope === pending.scope;
  const landed = stateWithLatestView(controller, value, pending.scope);
  if (sameScope && landed) {
    controller.states.set(landed.index, landed);
    if (pending.plan.method === "collapse") {
      const next = { ...pending.plan.state };
      delete next.previousRoute;
      if (pending.plan.state.index === 0) {
        next.index = landed.index;
        if (landed.previousRoute) next.previousRoute = landed.previousRoute;
      } else {
        next.index = landed.index + 1;
        next.previousRoute = landed.route;
      }
      const method = pending.plan.state.index === 0 ? "replaceState" : "pushState";
      writePhoneHistoryState(history, next, method);
      rememberPlan(controller.states, { state: next, method: pending.plan.method });
    }
  }
  rebuildProjection(history, controller);
  drainOperations(history, controller);
  return true;
}

function drainOperations(history: HistoryLike, controller: HistoryController) {
  while (!controller.pending && controller.queue.length > 0) {
    const operation = controller.queue.shift()!;
    const current = stateWithLatestView(controller, history.state);
    const plan = planOperation(controller.scope, current, operation, controller.states);
    if (!plan) continue;
    if (plan.method === "back" || plan.method === "collapse") {
      const target = plan.method === "back" ? plan.state.index : Math.max(0, current!.index - 2);
      const pending = { scope: controller.scope, index: target, plan };
      controller.pending = pending;
      // 根元のA→B→Aは一つだけ戻って置換する。二つ戻ると端末外のページへ出てしまう。
      if (plan.method === "back" || current!.index === 1) history.back();
      else history.go(-2);
      // 同期的なHistory代替にも対応する。ブラウザでは後続のpopstateで完了する。
      if (controller.pending === pending && matchesTravel(history.state, pending)) {
        completeTravel(history, controller, history.state);
      }
    } else {
      if (operation.kind === "view") {
        if (isMemoryStorage && memoryScope === controller.scope) memoryStates.set(plan.state.index, plan.state);
      } else {
        writePhoneHistoryState(history, plan.state, plan.method);
      }
      rememberPlan(controller.states, plan);
    }
  }
  rebuildProjection(history, controller);
}

function enqueueOperation(history: HistoryLike, scope: string, operation: HistoryOperation) {
  const controller = controllerFor(history, scope);
  const plan = planOperation(scope, controller.planned, operation, controller.projectedStates);
  if (!plan) return controller.planned;
  // 巻戻し待ちの連続した位置保存は、最後のsnapshotだけを残す。
  if (operation.kind === "view" && controller.queue[controller.queue.length - 1]?.kind === "view") {
    controller.queue[controller.queue.length - 1] = operation;
  } else {
    controller.queue.push(operation);
  }
  controller.planned = plan.state;
  rememberPlan(controller.projectedStates, plan);
  drainOperations(history, controller);
  return controller.planned;
}

// 巻戻し中も、呼出し済みの操作をすべて反映した最新の状態を返す。
export function currentPhoneHistoryState(history: HistoryLike, scope: string) {
  return controllerFor(history, scope).planned;
}

// pop時のHistory APIは到着先を指すため、まだ表示中の出発entryへだけ保存する。
export function savePhoneHistoryViewBeforePop(
  history: HistoryLike,
  scope: string,
  displayedRoute: PhoneHistoryRoute,
  capture: () => PhoneHistoryView | undefined
) {
  const controller = historyControllers.get(history);
  const source = controller?.planned;
  // systemによるパネル非表示でも、同じページの離脱位置は更新する。
  if (!controller || controller.scope !== scope || controller.pending || controller.queue.length
    || !source || source.scope !== scope || !samePhoneHistoryPage(source.route, displayedRoute)) return false;
  const view = capture();
  if (!view) return false;
  const next = { ...source, view: viewFrom({ ...source.view, ...view }) ?? {} };
  controller.states.set(next.index, next);
  controller.projectedStates.set(next.index, next);
  controller.planned = next;
  if (isMemoryStorage && memoryScope === scope) memoryStates.set(next.index, next);
  return true;
}

// 内部の圧縮に使ったpopは画面へ反映しない。通常の戻る・進むは呼出し側が復元する。
export function consumePhoneHistoryPop(history: HistoryLike, eventState: unknown) {
  const controller = historyControllers.get(history);
  if (!controller) return false;
  const pending = controller.pending;
  if (pending && matchesTravel(eventState, pending)) {
    const consumed = pending.plan.method === "collapse" || pending.scope !== controller.scope;
    completeTravel(history, controller, eventState);
    return consumed;
  }
  if (!pending) {
    const state = stateWithLatestView(controller, eventState);
    if (state) controller.states.set(state.index, state);
    rebuildProjection(history, controller);
  }
  return false;
}

export function replacePhoneHistoryRoute(
  history: HistoryLike, scope: string, route: PhoneHistoryRoute, view?: PhoneHistoryView
) {
  return enqueueOperation(history, scope, { kind: "replace", route: routeFrom(route)!, view: viewFrom(view) })!;
}

export function pushPhoneHistoryRoute(
  history: HistoryLike, scope: string, route: PhoneHistoryRoute, view?: PhoneHistoryView
) {
  return enqueueOperation(history, scope, { kind: "push", route: routeFrom(route)!, view: viewFrom(view) })!;
}

// 離脱位置は既存の操作queueで順序を保つ。投影stateだけへ書くと再planで失われる。
// History APIへの書込みは画面の変更時だけ行う。
export function replacePhoneHistoryView(history: HistoryLike, scope: string, view: PhoneHistoryView) {
  return enqueueOperation(history, scope, { kind: "view", view: viewFrom(view) ?? {} });
}

export function goBackInPhoneHistory(history: HistoryLike, scope: string, expectedPreviousAppId?: AppId) {
  const current = currentPhoneHistoryState(history, scope);
  if (!current || current.index <= 0 || (expectedPreviousAppId !== undefined && (
    current.previousRoute?.kind !== "app" || current.previousRoute.appId !== expectedPreviousAppId
  ))) return false;
  enqueueOperation(history, scope, { kind: "back" });
  return true;
}
