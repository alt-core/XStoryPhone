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
import { buildTypesafeTalkRuleRequest, typesafeTalkRuleDecision } from "../product/talkFlowTypesafeSelection.ts";
import { canonicalLlmJson, llmRequestHashes, type LlmProviderEnv, type StructuredOutputProvider } from "../providers/structuredOutput.ts";
import { requestTypesafeSystemOne, resolveTypesafeConfig } from "../providers/typesafe.ts";

type RecentMessage = { speaker: string; body: string };
export type TalkSelectorContext = { talkId: string; kind: "sms" | "chat" | "search_agent"; fromId: string };

function talkFlowPromptInput(input: Parameters<SemanticRuleSelector>[0], context: TalkSelectorContext): TalkFlowLlmPromptInput {
  return {
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
}

export function semanticRuleSelector(
  provider: StructuredOutputProvider,
  context: TalkSelectorContext = { talkId: "", kind: "sms", fromId: "" }
): SemanticRuleSelector {
  return async (input) => {
    const promptInput = talkFlowPromptInput(input, context);
    const messages = buildTalkFlowLlmMessages(promptInput);
    const schema = talkFlowLlmResponseSchema(promptInput.rules.map((rule) => rule.id));
    const hashes = await llmRequestHashes(input.playerInput, canonicalLlmJson(messages), schema);
    const observation = { source: "talk_flow" as const, talkId: context.talkId, fromId: context.fromId, ...hashes };
    const result = await provider.completeJson({
      taskId: "talk_rule_selection",
      temperature: 0,
      maxTokens: talkFlowLlmRuleSelectionMaxTokens,
      instructions: messages[0]?.content ?? "",
      input: JSON.parse(messages[1]?.content ?? "{}") as Record<string, unknown>,
      schema,
      observation
    });
    if (!result.ok) {
      return { ok: false, error: result.error === "provider_error" ? "provider_error" : "provider_invalid" };
    }
    const confidence = result.value.confidence;
    const decision = typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? parseTalkFlowLlmDecision(result.value) : null;
    if (!decision || !promptInput.rules.some((rule) => rule.id === decision.rule_id)) {
      provider.observeResult?.({ ...observation, taskId: "talk_rule_selection", status: "invalid_response" });
      return { ok: false, error: "provider_invalid" };
    }
    const selected = selectTalkFlowRuleFromLlmDecision(decision, promptInput);
    const reviewSelection = {
      decision, accepted: selected.accepted, selectedRuleId: decision.rule_id,
      finalRuleId: selected.ruleId, ...(selected.fallbackReason ? { fallbackReason: selected.fallbackReason } : {}), ...hashes
    };
    provider.observeResult?.({ ...observation, taskId: "talk_rule_selection", status: selected.accepted ? "accepted" : "fallback",
      accepted: selected.accepted, selectedRuleId: decision.rule_id, finalRuleId: selected.ruleId,
      confidence: decision.confidence, reasonCode: decision.reason_code, fallbackReason: selected.fallbackReason });
    return { ok: true, ruleId: selected.ruleId, reviewSelection };
  };
}

// 生成しない判定型provider。候補からの1択をChoiceで問い、閾値判定は既存のLLM経路と同じ関数で行う。
export function typesafeRuleSelector(
  env: LlmProviderEnv,
  context: TalkSelectorContext = { talkId: "", kind: "sms", fromId: "" }
): SemanticRuleSelector {
  return async (input) => {
    const config = resolveTypesafeConfig(env);
    if (!config.ok) {
      console.error(JSON.stringify({ event: "llm_config_error", provider: "typesafe", reason: config.reason }));
      return { ok: false, error: "provider_unavailable" };
    }
    const promptInput = talkFlowPromptInput(input, context);
    const request = buildTypesafeTalkRuleRequest(promptInput, config.model);
    // schemaは既存経路の応答enumと同じく、選べるrule IDの一覧で表す。
    const hashes = await llmRequestHashes(
      input.playerInput,
      canonicalLlmJson({ state: request.state, questions: request.questions }),
      promptInput.rules.map((rule) => rule.id)
    );
    const observation = {
      source: "talk_flow", taskId: "talk_rule_selection", talkId: context.talkId, fromId: context.fromId,
      inputHash: hashes.inputHash.slice(0, 12), promptHash: hashes.promptHash.slice(0, 12), schemaHash: hashes.schemaHash.slice(0, 12)
    };
    const response = await requestTypesafeSystemOne(config, request, observation);
    if (!response.ok) return { ok: false, error: response.error };
    const answer = typesafeTalkRuleDecision(response.payload, promptInput);
    if (!answer) {
      if (config.analytics) console.log(JSON.stringify({ event: "llm_result", provider: "typesafe", ...observation, status: "invalid_response" }));
      return { ok: false, error: "provider_invalid" };
    }
    const selected = selectTalkFlowRuleFromLlmDecision(answer.decision, promptInput, {
      minConfidence: config.minConfidence,
      minGameOverConfidence: config.minGameOverConfidence
    });
    if (config.analytics) {
      console.log(JSON.stringify({
        event: "llm_result", provider: "typesafe", ...observation, model: answer.model, status: selected.accepted ? "accepted" : "fallback",
        accepted: selected.accepted, selectedRuleId: answer.decision.rule_id, finalRuleId: selected.ruleId,
        confidence: answer.decision.confidence, reasonCode: answer.decision.reason_code, fallbackReason: selected.fallbackReason
      }));
    }
    return {
      ok: true,
      ruleId: selected.ruleId,
      reviewSelection: {
        decision: answer.decision, accepted: selected.accepted, selectedRuleId: answer.decision.rule_id,
        finalRuleId: selected.ruleId, ...(selected.fallbackReason ? { fallbackReason: selected.fallbackReason } : {}), ...hashes,
        selector: "typesafe", model: answer.model, probabilities: answer.probabilities
      }
    };
  };
}

export async function extractTalkRuleMatch(
  provider: StructuredOutputProvider,
  rule: TalkRule,
  playerInput: string,
  context: readonly RecentMessage[] = [],
  talkContext: { talkId?: string; fromId?: string; onResult?: (result: { status: string; sampleCount: number; inputHash: string; promptHash: string; schemaHash: string }) => void } = {}
) {
  const parsedSpec = parseTalkFlowMatchSpec(rule.match);
  if (!parsedSpec.ok) return { ok: false as const, error: "provider_invalid" as const };
  const { spec } = parsedSpec;
  const messages = buildTalkFlowMatchExtractionMessages({
      talkId: talkContext.talkId ?? "",
      fromId: talkContext.fromId ?? rule.from,
      ruleId: rule.id,
      playerInput,
      recentMessages: context,
      spec
  });
  const schema = talkFlowMatchExtractionResponseSchema(spec);
  const hashes = await llmRequestHashes(playerInput, canonicalLlmJson(messages), schema);

  async function sample(sampleIndex: number) {
    const observation = { source: "talk_flow" as const, talkId: talkContext.talkId, fromId: talkContext.fromId, ruleId: rule.id, sampleIndex, ...hashes };
    const result = await provider.completeJson({
      taskId: "talk_match_extraction",
      operation: "match_extraction",
      temperature: 0,
      maxTokens: Math.max(512, Math.min(2_048, 256 + spec.items.length * 256)),
      instructions: messages[0]?.content ?? "",
      input: JSON.parse(messages[1]?.content ?? "{}") as Record<string, unknown>,
      schema,
      observation
    });
    if (!result.ok) return { status: result.error } as const;
    const output = parseTalkFlowMatchOutput(result.value, spec);
    provider.observeResult?.({ ...observation, taskId: "talk_match_extraction", status: output.ok ? "sample_ready" : "invalid_response" }, { output: output.ok ? output.output : null });
    return output.ok
      ? { status: "ready" as const, output: output.output }
      : { status: "invalid_response" as const };
  }

  const result = await runTalkFlowMatchExtractionSamples(spec, rule.set, sample);
  const status = result.ok ? "ready" : result.reason;
  talkContext.onResult?.({ status, sampleCount: result.sampleCount, ...hashes });
  provider.observeResult?.({ source: "talk_flow", taskId: "talk_match_extraction", talkId: talkContext.talkId,
    fromId: talkContext.fromId, ruleId: rule.id, status, sampleCount: result.sampleCount,
    ...hashes
  }, { outputs: result.outputs, selected: result.ok ? result.matchGroups : null });
  if (result.ok) return { ok: true as const, values: result.matchGroups };
  return result.reason === "invalid_response"
    ? { ok: false as const, error: "provider_invalid" as const }
    : { ok: false as const, error: result.reason };
}
