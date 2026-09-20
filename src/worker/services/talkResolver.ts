import { resolveTalkRule, type TalkReviewSelection } from "../../shared/conversation.ts";
import { renderTemplate } from "../../shared/condition.ts";
import type { ScenarioTalk } from "../../shared/scenario.ts";
import { createStructuredOutputProvider, type LlmProviderEnv, type StructuredOutputProvider } from "../providers/structuredOutput.ts";
import { extractTalkRuleMatch, semanticRuleSelector } from "./conversationLlm.ts";

export function renderTalkRuleCriteria<T extends { criteria: string }>(rules: readonly T[], stateValues: Record<string, unknown>): T[] {
  const templateEnv = Object.fromEntries(Object.entries(stateValues).map(([key, value]) => [key, String(value)]));
  return rules.map((rule) => ({ ...rule, criteria: renderTemplate(rule.criteria, templateEnv) }));
}

export async function resolveScenarioTalkRule(input: {
  env: LlmProviderEnv;
  llmEnabled: boolean;
  talk: ScenarioTalk;
  from: string;
  playerInput: string;
  semanticPlayerInput?: string;
  stateValues: Record<string, unknown>;
  recentMessages?: readonly { speaker: string; body: string }[];
  provider?: StructuredOutputProvider | null;
}) {
  const provider = input.llmEnabled ? (input.provider ?? createStructuredOutputProvider(input.env)) : null;
  const talk = {
    ...input.talk,
    rules: renderTalkRuleCriteria(input.talk.rules, input.stateValues)
  };
  const selection = await resolveTalkRule({
    rules: talk.rules,
    from: input.from,
    playerInput: input.playerInput,
    ...(input.semanticPlayerInput ? { semanticPlayerInput: input.semanticPlayerInput } : {}),
    stateValues: input.stateValues,
    recentMessages: input.recentMessages,
    ...(provider ? {
      semanticSelector: semanticRuleSelector(provider, {
        talkId: talk.id,
        kind: talk.kind,
        fromId: input.from
      })
    } : {})
  });
  if (!selection.ok) return selection;
  const reviewSelection: TalkReviewSelection = {
    selectedRuleId: selection.rule.id, ...selection.reviewSelection, finalRuleId: selection.rule.id
  };
  if (!selection.rule.match.trim()) return { ...selection, reviewSelection, matchGroups: {} };
  if (!provider) {
    return { ok: false as const, error: "provider_unavailable" as const };
  }
  const extracted = await extractTalkRuleMatch(provider, selection.rule, input.playerInput, input.recentMessages, {
    talkId: talk.id,
    fromId: input.from,
    onResult(result) { reviewSelection.extraction = result; }
  });
  if (extracted.ok) return { ...selection, reviewSelection, matchGroups: extracted.values };
  return extracted.error === "no_match"
    ? { ok: true as const, rule: selection.defaultRule, defaultRule: selection.defaultRule, source: "default" as const,
      reviewSelection: { ...reviewSelection, accepted: false, finalRuleId: selection.defaultRule.id, fallbackReason: "extraction_no_match" }, matchGroups: {} }
    : extracted;
}
