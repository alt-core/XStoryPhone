import type { ScenarioHookHandlerRegistry } from "../shared/hooks.ts";
import type { WorkerScenario } from "../shared/scenario.ts";
import { createAnswerDeriver, STATIC_ANSWER_PREFIX_LENGTH, StaticResourceError, type StaticAnswerIndex } from "../shared/staticAnswer.ts";
export { StaticResourceError } from "../shared/staticAnswer.ts";
import { combineStaticParts, type FetchedStaticPart, type StaticAnswer, type StaticManifest, type StaticPart } from "./definition.ts";
import type { LoadedPart } from "./playerStore.ts";

export type StaticFetchBudget = { retries: number };

export function createStaticLoader(options: {
  entryUrl: string;
  projectId: string;
  clientRevision: string;
  fetch?: typeof fetch;
  module?: (url: string) => Promise<{ scenarioHookHandlers: ScenarioHookHandlerRegistry }>;
  wait?: (ms: number) => Promise<void>;
}) {
  const fetchFile = options.fetch ?? fetch;
  const loadModule = options.module ?? (url => import(/* @vite-ignore */ url));
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const cache = new Map<string, FetchedStaticPart>();
  let manifest: StaticManifest;
  let base: FetchedStaticPart;
  let releaseUrl: URL;

  async function readWithRetry<T>(read: () => Promise<T>, budget: StaticFetchBudget): Promise<T> {
    for (;;) {
      try { return await read(); }
      catch (error) {
        if (error instanceof StaticResourceError) throw error;
        if (error instanceof SyntaxError) throw new StaticResourceError("staticファイルの構文が不正です。配布物を確認してください。");
        if (!budget.retries) throw new StaticResourceError("staticファイルの取得に失敗しました。");
        const delay = budget.retries-- === 2 ? 1_000 : 3_000;
        await wait(delay);
      }
    }
  }

  async function json(url: string, budget: StaticFetchBudget): Promise<unknown> {
    return readWithRetry(async () => {
      const response = await fetchFile(url, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new StaticResourceError(`staticファイルを取得できません: HTTP ${response.status}`);
      // body読取り中の通信断も同じ予算で再試行し、構文エラーだけを区別する。
      return response.json();
    }, budget);
  }

  async function module(url: string, budget: StaticFetchBudget) {
    let attempt = 0;
    return readWithRetry(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // 一部ブラウザーは失敗したimportもURL単位で記憶する。再試行だけ別URLで再取得する。
      const resource = new URL(url);
      if (attempt) resource.searchParams.set("retry", String(attempt));
      attempt += 1;
      try {
        return await Promise.race([loadModule(resource.href), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("module_timeout")), 15_000);
        })]);
      } finally { clearTimeout(timer); }
      // import自体は取消せない。期限後の到着だけでpartを有効化するcallbackは持たない。
    }, budget);
  }

  async function part(id: string, url: string, budget: StaticFetchBudget) {
    const cached = cache.get(url);
    if (cached) return cached;
    const data = await json(url, budget) as StaticPart;
    if (data?.projectId !== manifest.projectId || data.releaseId !== manifest.releaseId || data.id !== id
      || !data.definition || !Array.isArray(data.rules)) throw new StaticResourceError("partの作品・配布版・形式が一致しません。");
    let handlers: ScenarioHookHandlerRegistry = {};
    if (data.hookModule) {
      if (data.hookModule !== "hooks.js") throw new StaticResourceError("partのhook取得先が不正です。");
      handlers = (await module(new URL("hooks.js", url).href, budget)).scenarioHookHandlers;
      if (!handlers || typeof handlers !== "object" || Object.values(handlers).some(handler => typeof handler !== "function")) throw new StaticResourceError("partのhook形式が不正です。");
    }
    const loaded = { ...data, handlers };
    cache.set(url, loaded);
    return loaded;
  }

  return {
    get manifest() { return manifest; },
    get base() { return base; },
    async initialize(budget: StaticFetchBudget) {
      if (base) return;
      const data = await json(options.entryUrl, budget) as StaticManifest;
      if (data?.projectId !== options.projectId || data.clientRevision !== options.clientRevision
        || !/^[a-f0-9]{24}$/u.test(data.releaseId) || typeof data.salt !== "string"
        || !Number.isSafeInteger(data.iterations) || data.iterations < 1 || data.iterations > 2_000_000
        || data.base !== `scenario/${data.releaseId}/base/part.json`) throw new StaticResourceError("staticの入口設定が作品またはクライアントと一致しません。");
      manifest = data;
      const baseUrl = new URL(data.base, options.entryUrl).href;
      releaseUrl = new URL("../", baseUrl);
      const loadedBase = await part("base", baseUrl, budget);
      if (!loadedBase.definition.project || loadedBase.definition.project.id !== options.projectId || loadedBase.definition.playerMode !== "static") throw new StaticResourceError("baseの作品定義が不正です。");
      base = loadedBase;
    },
    async definitions(parts: readonly LoadedPart[], budget: StaticFetchBudget) {
      if (!base) throw new StaticResourceError("staticの初期化が完了していません。");
      const loaded = [];
      for (const item of parts) {
        if (!/^[a-z][a-z0-9_-]*$/u.test(item.id) || item.id === "base" || !/^[a-f0-9]{32}$/u.test(item.locator)) throw new StaticResourceError("取得済partの指定が不正です。");
        loaded.push(await part(item.id, new URL(`parts/${item.locator}/part.json`, releaseUrl).href, budget));
      }
      return combineStaticParts(base.definition as WorkerScenario, [base, ...loaded]);
    },
    answers(budget: StaticFetchBudget) {
      const derive = createAnswerDeriver(manifest);
      return async (index: StaticAnswerIndex, input: string, kind: StaticAnswer["kind"]) => {
        const digest = await derive(input, index.id, kind === "pin");
        if (!index.prefixes.includes(digest.slice(0, STATIC_ANSWER_PREFIX_LENGTH))) return null;
        const answer = await json(new URL(`answers/${digest}.json`, releaseUrl).href, budget) as StaticAnswer;
        if (answer?.projectId !== manifest.projectId || answer.releaseId !== manifest.releaseId || answer.entryId !== index.id
          || answer.kind !== kind || !Array.isArray(answer.parts) || (kind === "talk" && !answer.rule)) throw new StaticResourceError("回答データの作品・配布版・形式が一致しません。");
        return answer;
      };
    }
  };
}
