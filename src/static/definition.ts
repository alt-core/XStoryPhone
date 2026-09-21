import type { ScenarioHookHandlerRegistry } from "../shared/hooks.ts";
import type { TalkRule, WorkerScenario } from "../shared/scenario.ts";
import type { StaticAnswerSettings } from "../shared/staticAnswer.ts";
import type { LoadedPart } from "./playerStore.ts";
import { partCollectionKeys } from "../worker/scenarioParts.ts";

export type StaticManifest = StaticAnswerSettings & {
  projectId: string;
  releaseId: string;
  clientRevision: string;
  base: string;
};
export type StaticPart = {
  projectId: string;
  releaseId: string;
  id: string;
  definition: Partial<WorkerScenario>;
  rules: Array<TalkRule & { talkId: string }>;
  hookModule?: string;
};
export type StaticAnswer = {
  projectId: string;
  releaseId: string;
  entryId: string;
  kind: "talk" | "password" | "pin";
  parts: LoadedPart[];
  rule?: TalkRule;
};
export type FetchedStaticPart = StaticPart & { handlers: ScenarioHookHandlerRegistry };

// 原本順で一度だけ結合する。talk本体とruleを別に持ち、後partで同じtalkへ追加できる。
export function combineStaticParts(base: WorkerScenario, parts: readonly FetchedStaticPart[]) {
  const result = { ...base };
  const ordered = <T extends { order?: number }>(items: T[]) => items.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  for (const key of partCollectionKeys) {
    const items = new Map<string, unknown>();
    for (const part of parts) for (const item of part.definition[key] ?? []) {
      const id = "id" in item ? item.id : "contentId" in item ? item.contentId : `hook:${item.order}`;
      const previous = items.get(id) as { unavailable?: boolean } | undefined;
      if (!previous || previous.unavailable) items.set(id, item);
      else if (!item.unavailable && previous !== item) throw new Error(`partの定義が重複しています: ${key}/${id}`);
    }
    (result as unknown as Record<string, unknown>)[key] = ordered([...items.values()] as { order?: number }[]);
  }
  for (const key of ["stateVariables", "stateVariableDefinitions", "stateVariableParts", "photoDescriptions", "repeatTalkBlocks"] as const) {
    (result as unknown as Record<string, unknown>)[key] = Object.assign({}, ...parts.map(part => part.definition[key] ?? {}));
  }
  result.publicStateVariables = [...new Set(parts.flatMap(part => part.definition.publicStateVariables ?? []))];
  result.hookTalkBlocks = Object.fromEntries(result.talks.map(talk => [talk.id,
    [...new Set(parts.flatMap(part => part.definition.hookTalkBlocks?.[talk.id] ?? []))]
  ]));
  result.albumMediaAttachmentLinks = parts.flatMap(part => part.definition.albumMediaAttachmentLinks ?? []);
  result.publicIds = Object.fromEntries(Object.keys(base.publicIds).map(key => [key,
    Object.assign({}, ...parts.map(part => part.definition.publicIds?.[key as keyof WorkerScenario["publicIds"]] ?? {}))
  ])) as WorkerScenario["publicIds"];
  const rules = parts.flatMap(part => part.rules);
  result.talks = result.talks.map(talk => ({ ...talk, rules: ordered(rules.filter(rule => rule.talkId === talk.id)) }));
  result.parts = parts.map(part => part.id);
  return { scenario: result, handlers: Object.assign({}, ...parts.map(part => part.handlers)) as ScenarioHookHandlerRegistry };
}
