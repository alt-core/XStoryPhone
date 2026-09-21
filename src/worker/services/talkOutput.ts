import { definedConditionState, evaluateCondition, renderTemplate, requireTemplateValues } from "../../shared/condition.ts";
import type { TalkOutputStep } from "../../shared/scenario.ts";
import { MAX_SEARCH_AGENT_QUERY_LENGTH } from "../../shared/searchAgent.ts";
import { parseTalkExtraction } from "../../shared/talkCriteria.ts";

export type ResolvedTalkOutputStep<Result> =
  | { kind: "block"; blockId: string }
  | { kind: "search"; query: string; results: Result[] }
  | { kind: "input"; action: "show" | "hide" | "enable" | "disable" };

export function talkOutputMatchEnv(matchSpec: string, matchGroups: Readonly<Record<string, string>>) {
  if (!matchSpec.trim()) return { ...matchGroups };
  const parsed = parseTalkExtraction(matchSpec);
  return Object.fromEntries(parsed.ids.map(id => [id, matchGroups[id] ?? ""]));
}

export function evaluateTalkOutputSteps<Result>(input: {
  steps: readonly TalkOutputStep[];
  env: Readonly<Record<string, string | number | boolean>>;
  search: (query: string) => Result[];
}) {
  const searchStep = input.steps.find((step) => step.kind === "search");
  const templateEnv = Object.fromEntries(Object.entries(input.env).map(([key, value]) => [key, String(value)]));
  if (searchStep?.kind === "search") requireTemplateValues(searchStep.queryTemplate, templateEnv);
  const searchQuery = searchStep?.kind === "search"
    ? renderTemplate(searchStep.queryTemplate, templateEnv).normalize("NFC").trim().slice(0, MAX_SEARCH_AGENT_QUERY_LENGTH)
    : "";
  const searchResults = searchStep ? input.search(searchQuery) : [];
  const outputEnv = {
    ...input.env,
    search_found: searchResults.length > 0,
    search_result_count: searchResults.length
  };
  const outputs: ResolvedTalkOutputStep<Result>[] = [];
  for (const step of input.steps) {
    if (step.kind === "block") {
      outputs.push(step);
      continue;
    }
    if (step.kind === "if") {
      if (evaluateCondition(step.cond, definedConditionState(outputEnv))) outputs.push({ kind: "block", blockId: step.blockId });
      continue;
    }
    if (step.kind === "search") {
      outputs.push({ kind: "search", query: searchQuery, results: searchResults });
      continue;
    }
    outputs.push(step);
  }
  return { outputs, env: outputEnv, searchQuery, searchResults };
}
