import type { ScenarioHookHandlerRegistry } from "../shared/hooks.ts";
import type { TalkRule, WorkerScenario } from "../shared/scenario.ts";
import { copyStoredPlayerState, type StoredPlayerState } from "../server/store.ts";
import { createScenarioRuntime } from "./scenarioRuntime.ts";
import { scenarioForParts } from "./scenarioParts.ts";
import { createScenarioHooksRuntime } from "./services/scenarioHooksRuntime.ts";

export type PartSource = {
  load(ids: readonly string[]): Promise<{ scenario: WorkerScenario; handlers: ScenarioHookHandlerRegistry }>;
  secret?(rule: TalkRule, input: string): Promise<TalkRule | null>;
  password?(definition: WorkerScenario["lockedContentPasswords"][number], input: string): Promise<readonly string[] | null>;
  pin?(input: string): Promise<readonly string[] | null>;
};

export function createPartSession(catalog: WorkerScenario, suppliedHandlers: ScenarioHookHandlerRegistry, source?: PartSource) {
  let definitions = catalog;
  const handlers = { ...suppliedHandlers };
  const blockAccess: Record<string, readonly string[]> = {};
  const runtime = createScenarioRuntime(scenarioForParts(definitions, ["base"]));
  const hooks = createScenarioHooksRuntime(runtime, handlers, blockAccess);
  let selectedKey = "";
  function select(ids: readonly string[]) {
    const selected = scenarioForParts(definitions, ids);
    runtime.useScenario(selected);
    for (const key of Object.keys(blockAccess)) delete blockAccess[key];
    Object.assign(blockAccess, selected.hookTalkBlocks ?? {});
    selectedKey = JSON.stringify(ids);
  }
  select(["base"]);
  return {
    runtime, hooks, source,
    async runtimeFor(state: StoredPlayerState) {
      const ids = state.loadedPartIds ?? ["base"];
      if (JSON.stringify(ids) === selectedKey) return runtime;
      // 拒否応答等で以前の状態を表示しても、実行中の候補viewを巻き戻さない。
      const catalog = source ? (await source.load(ids)).scenario : definitions;
      return createScenarioRuntime(scenarioForParts(catalog,ids));
    },
    staticAudioDefinition(filename: string) {
      return definitions.generatedAudio.find(audio => audio.provider === "static" && `${audio.publicId}.wav` === filename);
    },
    async restore(state: StoredPlayerState) {
      const ids = state.loadedPartIds ?? ["base"];
      if (JSON.stringify(ids) === selectedKey) return;
      if (source) {
        const loaded = await source.load(ids);
        definitions = loaded.scenario;
        Object.assign(handlers, loaded.handlers);
      }
      for (const id of ids) if (!(definitions.parts ?? ["base"]).includes(id)) throw new Error(`取得済partが配布物にありません: ${id}`);
      select(ids);
    },
    async activate(state: StoredPlayerState, requested: readonly string[]) {
      const before = state.loadedPartIds ?? ["base"];
      const added = [...new Set(requested)].filter(id => !before.includes(id));
      const next = copyStoredPlayerState(state);
      next.loadedPartIds = [...before, ...added];
      if (added.length) {
        if (source) {
          const loaded = await source.load(next.loadedPartIds);
          definitions = loaded.scenario;
          Object.assign(handlers, loaded.handlers);
        }
        for (const id of added) if (!(definitions.parts ?? ["base"]).includes(id)) throw new Error(`取得するpartが未定義です: ${id}`);
        select(next.loadedPartIds);
      }
      return { state: next, added };
    }
  };
}

export type PartSession = ReturnType<typeof createPartSession>;
