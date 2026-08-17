import { resolveTalkRule } from "../../shared/conversation.ts";
import type { ScenarioTalk } from "../../shared/scenario.ts";
import { createStructuredOutputProvider, type LlmProviderEnv, type StructuredOutputProvider } from "../providers/structuredOutput.ts";
import { extractTalkRuleMatch, semanticRuleSelector } from "./conversationLlm.ts";

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
  const selection = await resolveTalkRule({
    rules: input.talk.rules,
    from: input.from,
    playerInput: input.playerInput,
    ...(input.semanticPlayerInput ? { semanticPlayerInput: input.semanticPlayerInput } : {}),
    stateValues: input.stateValues,
    recentMessages: input.recentMessages,
    ...(provider ? { semanticSelector: semanticRuleSelector(provider) } : {})
  });
  if (!selection.ok || !selection.rule.match.trim()) {
    return selection.ok ? { ...selection, matchGroups: {} } : selection;
  }
  if (!provider) {
    return { ok: false as const, error: "provider_unavailable" as const };
  }
  const extracted = await extractTalkRuleMatch(provider, selection.rule, input.playerInput, input.recentMessages);
  if (extracted.ok) return { ...selection, matchGroups: extracted.values };
  return extracted.error === "no_match"
    ? { ok: true as const, rule: selection.defaultRule, defaultRule: selection.defaultRule, source: "default" as const, matchGroups: {} }
    : extracted;
}
