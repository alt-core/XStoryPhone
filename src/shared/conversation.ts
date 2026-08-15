import { evaluateCondition } from "./condition.ts";
import type { TalkRule } from "./scenario.ts";

export type RegexCriteria =
  | { kind: "none" }
  | { kind: "ready"; regex: RegExp }
  | { kind: "invalid"; error: string };

export type SemanticRuleSelector = (input: {
  playerInput: string;
  rules: readonly Pick<TalkRule, "id" | "criteria">[];
  defaultRuleId: string;
}) => Promise<
  | { ok: true; ruleId: string }
  | { ok: false; error: "provider_unavailable" | "provider_error" | "provider_invalid" }
>;

export type TalkRuleResolution =
  | { ok: true; rule: TalkRule; source: "regex" | "semantic" | "default" }
  | {
      ok: false;
      error: "missing_default" | "invalid_regex" | "provider_unavailable" | "provider_error" | "provider_invalid";
    };

export function parseRegexCriteria(criteria: string): RegexCriteria {
  const source = criteria.trim();
  if (!source.startsWith("/")) {
    return { kind: "none" };
  }

  let escaped = false;
  let inClass = false;
  let end = -1;
  for (let index = 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "]") {
      inClass = false;
    } else if (char === "/" && !inClass) {
      end = index;
    }
  }

  if (end < 1) {
    return { kind: "invalid", error: "正規表現を閉じる / がありません。" };
  }

  try {
    return {
      kind: "ready",
      regex: new RegExp(source.slice(1, end), source.slice(end + 1))
    };
  } catch (error) {
    return { kind: "invalid", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolveTalkRule(input: {
  rules: readonly TalkRule[];
  from: string;
  playerInput: string;
  semanticPlayerInput?: string;
  stateValues: Record<string, unknown>;
  semanticSelector?: SemanticRuleSelector;
}): Promise<TalkRuleResolution> {
  const activeRules = input.rules
    .filter((rule) => rule.from === "*" || rule.from === input.from)
    .filter((rule) => evaluateCondition(rule.cond, input.stateValues))
    .sort((left, right) => left.order - right.order);
  const defaultRule = activeRules.find((rule) => rule.from === input.from && rule.isDefault);
  if (!defaultRule) {
    return { ok: false, error: "missing_default" };
  }

  const normalizedInput = input.playerInput.normalize("NFC").trim();
  for (const rule of activeRules) {
    if (rule.isDefault) {
      continue;
    }
    const parsed = parseRegexCriteria(rule.criteria);
    if (parsed.kind === "invalid") {
      return { ok: false, error: "invalid_regex" };
    }
    if (parsed.kind === "ready") {
      parsed.regex.lastIndex = 0;
      if (parsed.regex.test(normalizedInput)) {
        return { ok: true, rule, source: "regex" };
      }
    }
  }

  const semanticRules = activeRules.filter(
    (rule) => !rule.isDefault && parseRegexCriteria(rule.criteria).kind === "none"
  );
  if (semanticRules.length === 0) {
    return { ok: true, rule: defaultRule, source: "default" };
  }
  if (!input.semanticSelector) {
    return { ok: false, error: "provider_unavailable" };
  }

  const selected = await input.semanticSelector({
    playerInput: input.semanticPlayerInput?.normalize("NFC").trim() || normalizedInput,
    rules: semanticRules.map(({ id, criteria }) => ({ id, criteria })),
    defaultRuleId: defaultRule.id
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
    source: selectedRule.isDefault ? "default" : "semantic"
  };
}
