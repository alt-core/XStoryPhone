import { resolveTalkRule, type SemanticRuleSelector, type TalkReviewSelection } from "../../shared/conversation.ts";
import { renderTemplate, requireTemplateValues } from "../../shared/condition.ts";
import type { ScenarioTalk, TalkRule } from "../../shared/scenario.ts";
import { parseTalkExtraction, regexExtract } from "../../shared/talkCriteria.ts";
import { setExtractionIds } from "../../shared/setExpression.ts";
import { createStructuredOutputProvider, type LlmProviderEnv, type StructuredOutputProvider } from "../providers/structuredOutput.ts";
import { resolveTypesafeConfig } from "../providers/typesafe.ts";
import { extractTalkRuleMatch, semanticRuleSelector, typesafeRuleSelector, type TalkSelectorContext } from "./conversationLlm.ts";

// 制作試験も本番と同じ解決を使う。未知の値はnullで、既存LLMへ読み替えない。
export function talkRuleSelectorKind(env: LlmProviderEnv): "openai-compatible" | "typesafe" | null {
  const selector = env.LLM_TALK_SELECTOR?.trim() || "openai-compatible";
  return selector === "openai-compatible" || selector === "typesafe" ? selector : null;
}

const typesafeLowConfidenceReasons = new Set(["low_confidence", "low_advance_confidence", "low_game_over_confidence"]);

// Jevの閾値未満だけを既存のLLM判定へ回す。確信度の高いdefault選択や通信失敗は回さない。
function typesafeWithLlmFallback(env: LlmProviderEnv, provider: StructuredOutputProvider | null, context: TalkSelectorContext): SemanticRuleSelector {
  const typesafe = typesafeRuleSelector(env, context);
  if (!provider) {
    // 迷った入力の時だけ失敗する設定誤りにしない。最初のai判定で明示する。
    return async () => {
      console.error(JSON.stringify({ event: "llm_config_error", reason: "TYPESAFE_LOW_CONFIDENCE_FALLBACK=llmにはLLM_API_KEYとLLM_MODELが必要です。" }));
      return { ok: false, error: "provider_unavailable" };
    };
  }
  const llm = semanticRuleSelector(provider, context);
  return async (input) => {
    const first = await typesafe(input);
    const low = first.ok ? first.reviewSelection : undefined;
    if (!low?.fallbackReason || !typesafeLowConfidenceReasons.has(low.fallbackReason)) return first;
    const second = await llm(input);
    if (!second.ok) return second;
    return {
      ...second,
      reviewSelection: {
        ...(second.reviewSelection ?? { finalRuleId: second.ruleId }),
        escalatedFrom: {
          selector: "typesafe", fallbackReason: low.fallbackReason,
          ...(low.model ? { model: low.model } : {}),
          ...(low.decision ? { decision: low.decision } : {}),
          ...(low.probabilities ? { probabilities: low.probabilities } : {})
        }
      }
    };
  };
}

// 会話rule選択だけは、生成しない判定型providerへ明示的に切り替えられる。設定誤りは既存LLMへ戻さず503にする。
export function createTalkRuleSelector(
  env: LlmProviderEnv,
  provider: StructuredOutputProvider | null,
  context: TalkSelectorContext
): SemanticRuleSelector | undefined {
  const kind = talkRuleSelectorKind(env);
  if (kind === "typesafe") {
    const config = resolveTypesafeConfig(env);
    // 設定誤りはJev selector側で理由を記録して503にする。
    return config.ok && config.lowConfidenceFallback === "llm"
      ? typesafeWithLlmFallback(env, provider, context)
      : typesafeRuleSelector(env, context);
  }
  if (kind === null) {
    return async () => {
      console.error(JSON.stringify({ event: "llm_config_error", reason: `LLM_TALK_SELECTORが未対応です: ${env.LLM_TALK_SELECTOR?.trim()}` }));
      return { ok: false, error: "provider_unavailable" };
    };
  }
  return provider ? semanticRuleSelector(provider, context) : undefined;
}

export function renderTalkRuleCriteria<T extends { criteria: string; type?: string }>(rules: readonly T[], stateValues: Record<string, unknown>): T[] {
  const templateEnv = Object.fromEntries(Object.entries(stateValues).map(([key, value]) => [key, String(value)]));
  return rules.map((rule) => {
    if (rule.type === "secret" || (rule.type === "match" && !rule.criteria.startsWith("/"))) return { ...rule };
    requireTemplateValues(rule.criteria, templateEnv);
    return { ...rule, criteria: renderTemplate(rule.criteria, templateEnv) };
  });
}

type ScenarioTalkRuleInput = {
  env: LlmProviderEnv;
  llmEnabled: boolean;
  talk: ScenarioTalk;
  from: string;
  playerInput: string;
  semanticPlayerInput?: string;
  stateValues: Record<string, unknown>;
  recentMessages?: readonly { speaker: string; body: string }[];
  provider?: StructuredOutputProvider | null;
  semanticSelector?: SemanticRuleSelector;
  secretSelector?: (rule: TalkRule, input: string) => Promise<TalkRule | null>;
};

// 閾値適用後・抽出前の選択。本番と選択だけの評価で同じ処理を呼ぶ。
export async function resolveScenarioTalkSelection(input: ScenarioTalkRuleInput) {
  const provider = input.llmEnabled ? (input.provider ?? createStructuredOutputProvider(input.env)) : null;
  return selectScenarioTalkRule(input, provider);
}

async function selectScenarioTalkRule(input: ScenarioTalkRuleInput, provider: StructuredOutputProvider | null) {
  const talk = {
    ...input.talk,
    rules: renderTalkRuleCriteria(input.talk.rules.filter(rule => rule.from === "*" || rule.from === input.from), input.stateValues)
  };
  const selection = await resolveTalkRule({
    rules: talk.rules,
    from: input.from,
    playerInput: input.playerInput,
    ...(input.semanticPlayerInput ? { semanticPlayerInput: input.semanticPlayerInput } : {}),
    stateValues: input.stateValues,
    recentMessages: input.recentMessages,
    secretSelector: input.secretSelector,
    semanticSelector: input.semanticSelector
      ?? (input.llmEnabled ? createTalkRuleSelector(input.env, provider, { talkId: talk.id, kind: talk.kind, fromId: input.from }) : undefined)
  });
  if (!selection.ok) return selection;
  const reviewSelection: TalkReviewSelection = {
    selectedRuleId: selection.rule.id, ...selection.reviewSelection, finalRuleId: selection.rule.id
  };
  return { ...selection, reviewSelection };
}

export async function resolveScenarioTalkRule(input: ScenarioTalkRuleInput & {
  onSelection?: (selection: Awaited<ReturnType<typeof resolveScenarioTalkSelection>>) => void;
}) {
  const provider = input.llmEnabled ? (input.provider ?? createStructuredOutputProvider(input.env)) : null;
  const selection = await selectScenarioTalkRule(input, provider);
  input.onSelection?.(selection);
  if (!selection.ok) return selection;
  const reviewSelection = { ...selection.reviewSelection };
  if (!selection.rule.match.trim()) return { ...selection, reviewSelection, matchGroups: {} };
  const extraction = parseTalkExtraction(selection.rule.match);
  if (extraction.kind === "regex") {
    const values = regexExtract(selection.rule.match, input.playerInput);
    const required = setExtractionIds(selection.rule.set);
    if (values && required.every(id => typeof values[id] === "string")) return { ...selection, reviewSelection, matchGroups: values };
    return { ok: true as const, rule: selection.defaultRule, defaultRule: selection.defaultRule, source: "default" as const,
      reviewSelection: { ...reviewSelection, accepted: false, finalRuleId: selection.defaultRule.id, fallbackReason: "extraction_no_match" }, matchGroups: {} };
  }
  if (!provider) {
    return { ok: false as const, error: "provider_unavailable" as const };
  }
  const extracted = await extractTalkRuleMatch(provider, selection.rule, input.playerInput, input.recentMessages, {
    talkId: input.talk.id,
    fromId: input.from,
    onResult(result) { reviewSelection.extraction = result; }
  });
  if (extracted.ok) return { ...selection, reviewSelection, matchGroups: extracted.values };
  return extracted.error === "no_match"
    ? { ok: true as const, rule: selection.defaultRule, defaultRule: selection.defaultRule, source: "default" as const,
      reviewSelection: { ...reviewSelection, accepted: false, finalRuleId: selection.defaultRule.id, fallbackReason: "extraction_no_match" }, matchGroups: {} }
    : extracted;
}
