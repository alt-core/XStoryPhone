import { definedConditionState, evaluateCondition } from "./condition.ts";
import type { TalkRule } from "./scenario.ts";
import { orderedTalkFlowRules } from "../worker/product/talkFlowSelection.ts";
import { parseTalkFlowRegexCriteria } from "../worker/product/talkFlowLlmSelection.ts";
import { criteriaMatches } from "./talkCriteria.ts";

export type RegexCriteria =
  | { kind: "none" }
  | { kind: "ready"; regex: RegExp }
  | { kind: "invalid"; error: string };

export type TalkReviewSelection = {
  decision?: { rule_id: string; confidence: number; reason_code: string };
  accepted?: boolean;
  selectedRuleId?: string;
  finalRuleId: string;
  fallbackReason?: string;
  inputHash?: string;
  promptHash?: string;
  schemaHash?: string;
  extraction?: { status: string; sampleCount: number; inputHash: string; promptHash: string; schemaHash: string };
  selector?: "typesafe";
  model?: string;
  probabilities?: Record<string, number>;
};

export type SemanticRuleSelector = (input: {
  playerInput: string;
  rules: readonly Pick<TalkRule, "id" | "from" | "criteria" | "intent" | "mode" | "isDefault">[];
  defaultRuleId: string;
  recentMessages: readonly { speaker: string; body: string }[];
}) => Promise<
  | { ok: true; ruleId: string; reviewSelection?: TalkReviewSelection }
  | { ok: false; error: "provider_unavailable" | "provider_error" | "provider_invalid"; httpStatus?: number }
>;

export type TalkRuleResolution =
  | { ok: true; rule: TalkRule; defaultRule: TalkRule; source: "regex" | "match" | "secret" | "semantic" | "default"; reviewSelection?: TalkReviewSelection }
  | {
      ok: false;
      error: "missing_default" | "invalid_regex" | "provider_unavailable" | "provider_error" | "provider_invalid";
      httpStatus?: number;
    };

export function parseRegexCriteria(criteria: string): RegexCriteria {
  const parsed = parseTalkFlowRegexCriteria(criteria);
  return parsed.kind === "ready" ? { kind: "ready", regex: parsed.regex } : parsed;
}

// 本番の選択と制作試験の期待値解決で、入力の正規化・候補の順序・条件評価をそろえる。
export function activeTalkRules(input: {
  rules: readonly TalkRule[];
  from: string;
  playerInput: string;
  stateValues: Record<string, unknown>;
}) {
  const conditionState = definedConditionState({
    ...input.stateValues, player_input: input.playerInput.normalize("NFC").trim()
  });
  return orderedTalkFlowRules(
    input.rules.filter((rule) => rule.from === "*"),
    input.rules.filter((rule) => rule.from === input.from)
  ).filter((rule) => evaluateCondition(rule.cond, conditionState));
}

export async function resolveTalkRule(input: {
  rules: readonly TalkRule[];
  from: string;
  playerInput: string;
  semanticPlayerInput?: string;
  stateValues: Record<string, unknown>;
  recentMessages?: readonly { speaker: string; body: string }[];
  semanticSelector?: SemanticRuleSelector;
  secretSelector?: (rule: TalkRule, input: string) => Promise<TalkRule | null>;
}): Promise<TalkRuleResolution> {
  const normalizedInput = input.playerInput.normalize("NFC").trim();
  const activeRules = activeTalkRules(input);
  const defaultRule = activeRules.find((rule) => rule.from === input.from && rule.isDefault);
  if (!defaultRule) {
    return { ok: false, error: "missing_default" };
  }

  for (const rule of activeRules) {
    if (rule.type !== "match" && rule.type !== "secret") {
      continue;
    }
    try {
      const selected = rule.type === "secret" && input.secretSelector
        ? await input.secretSelector(rule, normalizedInput)
        : criteriaMatches(rule.criteria, normalizedInput, rule.type === "secret") ? rule : null;
      if (selected) return { ok: true, rule: selected, defaultRule, source: rule.type === "secret" ? "secret" : rule.criteria.startsWith("/") ? "regex" : "match" };
    } catch (error) {
      if (rule.type === "secret" && input.secretSelector) throw error;
      return { ok: false, error: "invalid_regex" };
    }
  }

  const semanticRules = activeRules.filter(
    (rule) => rule.type === "ai"
  );
  if (semanticRules.length === 0) {
    return { ok: true, rule: defaultRule, defaultRule, source: "default" };
  }
  if (!input.semanticSelector) {
    return { ok: false, error: "provider_unavailable" };
  }

  const selected = await input.semanticSelector({
    playerInput: input.semanticPlayerInput?.normalize("NFC").trim() || normalizedInput,
    rules: [
      ...semanticRules.map(({ id, from, criteria, intent, mode, isDefault }) => ({ id, from, criteria, intent, mode, isDefault })),
      {
        id: defaultRule.id,
        from: defaultRule.from,
        criteria: defaultRule.criteria,
        intent: defaultRule.intent,
        mode: defaultRule.mode,
        isDefault: true
      }
    ],
    defaultRuleId: defaultRule.id,
    recentMessages: input.recentMessages ?? []
  });
  if (!selected.ok) {
    return selected;
  }
  const selectedRule = activeRules.find((rule) => rule.id === selected.ruleId);
  if (!selectedRule) {
    return { ok: false, error: "provider_invalid" };
  }
  return {
    ok: true,
    rule: selectedRule,
    defaultRule,
    source: selectedRule.isDefault ? "default" : "semantic",
    ...(selected.reviewSelection ? { reviewSelection: selected.reviewSelection } : {})
  };
}
