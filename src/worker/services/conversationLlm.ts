import type { SemanticRuleSelector } from "../../shared/conversation";
import type { StructuredOutputProvider } from "../providers/structuredOutput";
import type { TalkRule } from "../../shared/scenario";

export function semanticRuleSelector(provider: StructuredOutputProvider): SemanticRuleSelector {
  return async (input) => {
    const allowedRuleIds = [...input.rules.map((rule) => rule.id), input.defaultRuleId];
    const result = await provider.completeJson({
      taskId: "talk_rule_selection",
      instructions: [
        "あなたは対話ゲームの分岐選択器です。",
        "プレイヤー入力に最も合うcriteriaのruleIdを1つ選んでください。",
        "明確に合うruleがない場合はdefaultRuleIdを返してください。",
        "指定されたruleId以外を作ってはいけません。"
      ].join("\n"),
      input: {
        playerInput: input.playerInput,
        rules: input.rules,
        defaultRuleId: input.defaultRuleId
      },
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ruleId: { type: "string", enum: allowedRuleIds }
        },
        required: ["ruleId"]
      }
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error === "provider_error" ? "provider_error" : "provider_invalid"
      };
    }
    const ruleId = typeof result.value.ruleId === "string" ? result.value.ruleId : "";
    return allowedRuleIds.includes(ruleId)
      ? { ok: true, ruleId }
      : { ok: false, error: "provider_invalid" };
  };
}

export async function extractTalkRuleMatch(
  provider: StructuredOutputProvider,
  rule: TalkRule,
  playerInput: string
) {
  let instructions: Record<string, string>;
  try {
    const value = JSON.parse(rule.match);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false as const, error: "provider_invalid" as const };
    }
    instructions = value as Record<string, string>;
  } catch {
    return { ok: false as const, error: "provider_invalid" as const };
  }
  const ids = Object.keys(instructions);
  const result = await provider.completeJson({
    taskId: "talk_match_extraction",
    instructions: [
      "あなたは対話ゲームの入力抽出器です。",
      "各項目の指示に従い、プレイヤー入力から短い値を抽出してください。",
      "推測が必要、または抽出できない項目はnullにしてください。"
    ].join("\n"),
    input: { playerInput, fields: instructions },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(ids.map((id) => [id, { type: ["string", "null"], maxLength: 300 }])),
      required: ids
    }
  });
  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error === "provider_error" ? "provider_error" as const : "provider_invalid" as const
    };
  }
  const values: Record<string, string> = {};
  for (const id of ids) {
    const value = result.value[id];
    if (typeof value === "string") {
      values[id] = value.normalize("NFC").trim().slice(0, 300);
    } else if (value !== null) {
      return { ok: false as const, error: "provider_invalid" as const };
    }
  }
  return { ok: true as const, values };
}
