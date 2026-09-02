import type { SemanticRuleSelector } from "../../shared/conversation.ts";
import type { TalkRule } from "../../shared/scenario.ts";
import {
  buildTalkFlowLlmMessages,
  parseTalkFlowLlmDecision,
  selectTalkFlowRuleFromLlmDecision,
  talkFlowLlmResponseSchema,
  talkFlowLlmRuleSelectionMaxTokens,
  type TalkFlowLlmPromptInput
} from "../product/talkFlowLlmSelection.ts";
import {
  buildTalkFlowMatchExtractionMessages,
  parseTalkFlowMatchOutput,
  parseTalkFlowMatchSpec,
  talkFlowMatchExtractionResponseSchema
} from "../product/talkFlowMatchExtraction.ts";
import { runTalkFlowMatchExtractionSamples } from "../product/llmMatchExtractionRunner.ts";
import type { StructuredOutputProvider } from "../providers/structuredOutput.ts";

type RecentMessage = { speaker: string; body: string };

export function semanticRuleSelector(
  provider: StructuredOutputProvider,
  context: { talkId: string; kind: "sms" | "chat" | "search_agent"; fromId: string } = { talkId: "", kind: "sms", fromId: "" }
): SemanticRuleSelector {
  return async (input) => {
    const promptInput: TalkFlowLlmPromptInput = {
      talkId: context.talkId,
      kind: context.kind,
      fromId: context.fromId,
      playerInput: input.playerInput,
      recentMessages: input.recentMessages,
      rules: input.rules.map((rule) => ({
        id: rule.id,
        from: rule.from,
        isDefault: rule.isDefault,
        intent: rule.intent,
        criteria: rule.criteria,
        mode: rule.mode
      })),
      defaultRuleId: input.defaultRuleId
    };
    const messages = buildTalkFlowLlmMessages(promptInput);
    const result = await provider.completeJson({
      taskId: "talk_rule_selection",
      temperature: 0,
      maxTokens: talkFlowLlmRuleSelectionMaxTokens,
      instructions: messages[0]?.content ?? "",
      input: JSON.parse(messages[1]?.content ?? "{}") as Record<string, unknown>,
      schema: talkFlowLlmResponseSchema(promptInput.rules.map((rule) => rule.id))
    });
    if (!result.ok) {
      return { ok: false, error: result.error === "provider_error" ? "provider_error" : "provider_invalid" };
    }
    if (!parseTalkFlowLlmDecision(result.value)) {
      return { ok: false, error: "provider_invalid" };
    }
    const selected = selectTalkFlowRuleFromLlmDecision(result.value, promptInput);
    return { ok: true, ruleId: selected.ruleId };
  };
}

export async function extractTalkRuleMatch(
  provider: StructuredOutputProvider,
  rule: TalkRule,
  playerInput: string,
  context: readonly RecentMessage[] = [],
  talkContext: { talkId?: string; fromId?: string } = {}
) {
  const parsedSpec = parseTalkFlowMatchSpec(rule.match);
  if (!parsedSpec.ok) return { ok: false as const, error: "provider_invalid" as const };
  const { spec } = parsedSpec;

  async function sample() {
    const messages = buildTalkFlowMatchExtractionMessages({
      talkId: talkContext.talkId ?? "",
      fromId: talkContext.fromId ?? rule.from,
      ruleId: rule.id,
      playerInput,
      recentMessages: context,
      spec
    });
    const result = await provider.completeJson({
      taskId: "talk_match_extraction",
      operation: "match_extraction",
      temperature: 0,
      maxTokens: Math.max(512, Math.min(2_048, 256 + spec.items.length * 256)),
      instructions: messages[0]?.content ?? "",
      input: JSON.parse(messages[1]?.content ?? "{}") as Record<string, unknown>,
      schema: talkFlowMatchExtractionResponseSchema(spec)
    });
    if (!result.ok) return { status: result.error } as const;
    const output = parseTalkFlowMatchOutput(result.value, spec);
    return output.ok
      ? { status: "ready" as const, output: output.output }
      : { status: "invalid_response" as const };
  }

  const result = await runTalkFlowMatchExtractionSamples(spec, rule.set, sample);
  if (result.ok) return { ok: true as const, values: result.matchGroups };
  return result.reason === "invalid_response"
    ? { ok: false as const, error: "provider_invalid" as const }
    : { ok: false as const, error: result.reason };
}
