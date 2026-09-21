import type { ClientStorageSettings } from "../shared/clientStorage.ts";
import type { PlayerState, PlayerStateResponse } from "../client/system/playerApi.ts";
import { BrowserPlayerStorageError } from "../client/system/playerStorageError.ts";
import { createPartSession } from "../worker/partSession.ts";
import { createPlayerOperations } from "../server/playerApp.ts";
import type { StoredSearchAgentEvent, StoredTalkEvent } from "../server/store.ts";
import { createStaticLoader, StaticResourceError } from "./loader.ts";
import { createStaticPlayerStore, type LoadedPart } from "./playerStore.ts";

export function createStaticPlayerExecution(options: {
  projectId: string; clientRevision: string; entryUrl: string; storage: ClientStorageSettings; resetForTesting?: boolean;
  fetch?: typeof fetch; module?: Parameters<typeof createStaticLoader>[0]["module"]; wait?: (ms: number) => Promise<void>;
}) {
  const store = createStaticPlayerStore(options.projectId, options.storage);
  const loader = createStaticLoader(options);
  let cached: PlayerState | null = null;
  let initialized = false;
  let queue: Promise<unknown> = Promise.resolve();
  const renderedStreams = new Map<string, { source: unknown; revision: string; historyRevision: number; messages: unknown[]; }>();
  const marker = "static-player";

  const execution = {
    async initialize() {
      if (initialized) return;
      await store.initialize();
      const budget = { retries: 2 };
      await loader.initialize(budget);
      // 再開定義が揃う前に状態整理して、未取得を削除済みと誤認しない。
      await loader.definitions(store.current?.parts ?? [], budget);
      initialized = true;
    },
    marker() { return store.current ? marker : undefined; },
    cachedState() { return cached; },
    prepare() { return store.prepare(); },
    async clear(expected?: string | null) { await store.clear(expected); cached = null; renderedStreams.clear(); },
    async delete() { await store.deleteDatabase(); cached = null; initialized = false; renderedStreams.clear(); },
    request(path: string, init: RequestInit = {}) {
      const perform = async () => {
        if (!initialized) throw new BrowserPlayerStorageError("unavailable", "staticの初期化が完了していません。");
        let parent = await store.prepare();
        if (path === "/api/reset-for-testing") {
          if (!options.resetForTesting) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
          await store.clear(parent);
          cached = null; renderedStreams.clear();
          return Response.json({ ok: true });
        }
        const epoch = store.generation;
        const previous = store.current ? structuredClone(store.current.player) : null;
        if (path === "/api/session/start" && previous) throw new BrowserPlayerStorageError("conflict", "開始済みのプレイデータがあります。");
        const budget = { retries: 2 };
        const knownParts = new Map((store.current?.parts ?? []).map(part => [part.id, part]));
        const definitions = await loader.definitions([...knownParts.values()], budget);
        const answer = loader.answers(budget);
        const remember = (parts: readonly LoadedPart[]) => {
          for (const part of parts) {
            const known = knownParts.get(part.id);
            if (known && known.locator !== part.locator) throw new StaticResourceError("同じpartの取得先が一致しません。");
            knownParts.set(part.id, { id: part.id, locator: part.locator });
          }
        };
        const parts = createPartSession(definitions.scenario, definitions.handlers, {
          async load(ids) {
            const requested = ids.filter(id => id !== "base").map(id => {
              const part = knownParts.get(id);
              if (!part) throw new StaticResourceError(`partの正規取得先がありません: ${id}`);
              return part;
            });
            return loader.definitions(requested, budget);
          },
          async secret(rule, input) {
            if (!rule.answerIndex) throw new StaticResourceError("secretの照合情報がありません。");
            const resolved = await answer(rule.answerIndex, input, "talk");
            if (!resolved) return null;
            if (resolved.rule?.type !== "secret" || resolved.rule.from !== rule.from || resolved.rule.part !== rule.part) throw new StaticResourceError("回答の分岐が入口と一致しません。");
            remember(resolved.parts);
            return resolved.rule;
          },
          async password(definition, input) {
            if (!definition.answerIndex) throw new StaticResourceError("passwordの照合情報がありません。");
            const resolved = await answer(definition.answerIndex, input, "password");
            if (!resolved) return null;
            remember(resolved.parts);
            return resolved.parts.map(part => part.id);
          },
          async pin(input) {
            const lock = definitions.scenario.project.lockScreen;
            if (lock.method !== "fixed-pin" || !lock.answerIndex) throw new StaticResourceError("PINの照合情報がありません。");
            const resolved = await answer(lock.answerIndex, input, "pin");
            if (!resolved) return null;
            remember(resolved.parts);
            return resolved.parts.map(part => part.id);
          }
        });
        const dependencies = {
          config: { appEnv: options.resetForTesting ? "dev" : "prod", llm: {}, playerInputLogging: false }
        };
        const operations = createPlayerOperations(parts.runtime, parts.hooks, undefined, {
          read: () => store.current ? structuredClone(store.current.player) : null,
          async commit(player) {
            const acquired = player.state.loadedPartIds.filter(id => id !== "base").map(id => {
              const part = knownParts.get(id);
              if (!part) throw new StaticResourceError(`保存するpartの取得先がありません: ${id}`);
              return part;
            });
            await store.commit(parent, epoch, player, loader.manifest.releaseId, acquired);
            parent = await store.prepare();
          }
        }, parts);
        let body: Record<string, unknown> | null = null;
        try { body = typeof init.body === "string" ? JSON.parse(init.body) : null; } catch { /* HTTP入口と同じ不正入力判定へ渡す。 */ }
        const result = await operations.execute(`${init.method ?? "GET"} ${path}`, { hostname: "static.invalid", body }, dependencies);
        const payload = result.payload as { ok: boolean; playerState?: PlayerStateResponse; sessionToken?: string; error?: string; };
        const saved = store.current?.player;
        if (saved && payload.playerState) {
          const projection = await parts.runtimeFor(saved.state);
          const smsMessages = [], chatMessages = [];
          let searchAgentMessages: ReturnType<typeof projection.publicSearchAgentTimelineItems> = [];
          const publicTalks = new Map(payload.playerState.talks.map(talk => [talk.talkId, talk]));
          for (const talk of projection.workerScenario.talks) {
            const progress = saved.state.talks[talk.id];
            const transcript = store.streams.get(`talk:${talk.id}`);
            if (!progress || !transcript || transcript.transcriptKey !== progress.transcriptKey || !projection.talkAvailable(talk, saved.state)) continue;
            const historyRevision = publicTalks.get(talk.publicId)?.historyRevision ?? 0;
            const old = renderedStreams.get(talk.id);
            const unchanged = old?.source === transcript && old.revision === projection.workerScenario.revision && old.historyRevision === historyRevision;
            if (projection.isSearchAgentTalk(talk)) {
              searchAgentMessages = unchanged ? old.messages as typeof searchAgentMessages
                : projection.publicSearchAgentTimelineItems(transcript.messages as StoredSearchAgentEvent[], talk.publicId);
              if (!unchanged) renderedStreams.set(talk.id, { source: transcript, revision: projection.workerScenario.revision, historyRevision, messages: searchAgentMessages });
            } else {
              const messages = unchanged ? old.messages : projection.visibleTalkMessagesForState(talk, saved.state, transcript.messages as StoredTalkEvent[]).map(projection.publicTalkMessage);
              if (!unchanged) renderedStreams.set(talk.id, { source: transcript, revision: projection.workerScenario.revision, historyRevision, messages });
              if (talk.kind === "sms") smsMessages.push(...messages); else chatMessages.push(...messages);
            }
          }
          const { transcriptDeltas: _transcriptDeltas, progressToken: _progressToken, ...publicState } = payload.playerState;
          cached = { ...publicState, smsMessages, chatMessages, searchAgentMessages } as PlayerState;
          payload.playerState = cached as PlayerState & PlayerStateResponse;
        }
        if (payload.ok && typeof payload.sessionToken === "string") payload.sessionToken = marker;
        return Response.json(payload, { status: result.status });
      };
      const next = queue.then(perform, perform);
      queue = next.then(() => undefined, () => undefined);
      return next.catch(error => {
        if (error instanceof StaticResourceError) return Response.json({ ok: false, error: "static_resource_unavailable", retryable: false }, { status: 502 });
        if (error instanceof BrowserPlayerStorageError) throw error;
        console.error("[static]", error);
        return Response.json({ ok: false, error: "server_error" }, { status: 500 });
      });
    }
  };
  return execution;
}

export type StaticPlayerExecution = ReturnType<typeof createStaticPlayerExecution>;
