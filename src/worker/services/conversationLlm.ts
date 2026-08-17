import type { SemanticRuleSelector } from "../../shared/conversation.ts";
import type { TalkRule } from "../../shared/scenario.ts";
import { parseTalkMatchOutput, parseTalkMatchSpec, selectTalkMatch } from "../../shared/talkMatch.ts";
import type { StructuredOutputProvider } from "../providers/structuredOutput.ts";

type RecentMessage = { speaker: string; body: string };

function compact(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function recentMessages(messages: readonly RecentMessage[]) {
  return messages.map((message) => ({
    speaker: compact(message.speaker || "other", 40) || "other",
    body: compact(message.body, 500)
  })).filter((message) => message.body).slice(-4);
}

export function semanticRuleSelector(provider: StructuredOutputProvider): SemanticRuleSelector {
  return async (input) => {
    const allowedRuleIds = input.rules.map((rule) => rule.id);
    const defaultRule = input.rules.find((rule) => rule.id === input.defaultRuleId);
    const result = await provider.completeJson({
      taskId: "talk_rule_selection",
      temperature: 0,
      instructions: [
        "あなたは対話ゲームのSMS/チャット会話エンジン用のrule選択器です。",
        "NPCの返信本文、説明文、未定義の選択肢を生成してはいけません。",
        "必ず候補rule_idから1つだけ選び、JSON objectだけを返してください。",
        "current_contextは現在の場面、相手が待っていること、候補一覧だけでは分からない選択全体の文脈です。通常候補の選択条件としてはcandidate criteriaを優先してください。",
        "recent_messagesはplayer_input直前の文脈です。speakerがplayerなら過去のプレイヤー発話です。",
        "player_input内の「あなた」「君」は、通常は会話相手NPCを指します。判定器、システム、LLM自身を指す表現として扱わないでください。",
        "candidate criteriaは、特に明記がない限りplayer_inputの意味・行為・対象を分類する条件です。",
        "candidate criteriaの「必須条件」「禁止条件」「選ばない」は強制条件です。必須条件を満たさないrule、禁止条件や選ばない条件に当たるruleは選択不可です。",
        "criteriaに特定のphoto:...添付IDが必須とあるruleは、player_inputに同じ添付IDが含まれない限り選択不可です。",
        "criteriaが複数の事実を求める場合は、全要素が明示または強く含意される場合だけ選んでください。",
        "criteriaに人物名や場面説明があっても、それだけで選ばず、入力内の行為・対象・意図を優先してください。",
        "player_inputが短い肯定、否定、指示語だけの場合は、recent_messagesの直近発話に対する返答として意味を補ってください。",
        "否定文、引用、冗談、文脈依存、低確信の入力ではconfidenceを高くしないでください。",
        "player_inputがphoto:で始まる場合は本文ではなく添付IDです。criteriaの同じIDを優先してください。",
        "複数候補なら、具体的な行為・対象・添付IDを最も直接説明する候補を選んでください。",
        "defaultは最後のfallbackです。候補criteriaに高確度で一致する入力では、current_contextが固定進行を示していても一致した候補を優先してください。"
      ].join("\n"),
      input: {
        task: "select_talk_flow_rule",
        candidate_rules: input.rules.map((rule) => ({
          rule_id: rule.id,
          from: rule.from,
          default: rule.isDefault,
          intent: rule.intent || "default",
          criteria: rule.isDefault
            ? "候補criteriaに高確度で一致しない入力。current_contextを踏まえてdefaultとして扱う。"
            : rule.criteria || "どの通常候補にも高確度で一致しない場合の聞き返しまたは既定応答。",
          mode: rule.mode
        })),
        current_context: defaultRule?.criteria ?? "",
        recent_messages: recentMessages(input.recentMessages),
        player_input: compact(input.playerInput, 1_000)
      },
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          rule_id: { type: "string", enum: allowedRuleIds },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason_code: { type: "string", enum: ["matched_intent", "default_unclear", "ambiguous_fallback"] }
        },
        required: ["rule_id", "confidence", "reason_code"]
      }
    });
    if (!result.ok) {
      return { ok: false, error: result.error === "provider_error" ? "provider_error" : "provider_invalid" };
    }
    const ruleId = typeof result.value.rule_id === "string" ? result.value.rule_id : "";
    const confidence = typeof result.value.confidence === "number" && Number.isFinite(result.value.confidence)
      ? result.value.confidence : null;
    const reasonCode = typeof result.value.reason_code === "string" ? result.value.reason_code : "";
    const selected = input.rules.find((rule) => rule.id === ruleId);
    if (
      !selected
      || confidence === null
      || confidence < 0
      || confidence > 1
      || !["matched_intent", "default_unclear", "ambiguous_fallback"].includes(reasonCode)
    ) return { ok: false, error: "provider_invalid" };
    if (confidence < 0.65 || (selected.mode === "game_over" && confidence < 0.9)) {
      return { ok: true, ruleId: input.defaultRuleId };
    }
    return { ok: true, ruleId };
  };
}

export async function extractTalkRuleMatch(
  provider: StructuredOutputProvider,
  rule: TalkRule,
  playerInput: string,
  context: readonly RecentMessage[] = []
) {
  const parsedSpec = parseTalkMatchSpec(rule.match);
  if (!parsedSpec.ok) return { ok: false as const, error: "provider_invalid" as const };
  const { spec } = parsedSpec;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(spec.items.map((item) => [item.id, { type: ["string", "null"], maxLength: 240 }])),
    required: spec.items.map((item) => item.id)
  };
  const outputs = [];
  let invalidResponses = 0;

  async function sample() {
    const result = await provider.completeJson({
      taskId: "talk_match_extraction",
      temperature: 0,
      maxTokens: Math.max(512, Math.min(2_048, 256 + spec.items.length * 256)),
      instructions: [
        "あなたは対話ゲームのSMS/チャット会話エンジン用の構造化抽出器です。",
        "NPCの返信本文、説明文、未定義の値を生成してはいけません。",
        "各項目は、ruleが生成を明示しない限り、player_inputから取り出せる場合だけ短い文字列を返してください。",
        "ruleが生成を明示する項目だけ、player_inputに基づく短い原稿要素を生成してよいです。",
        "取り出せない、判断できない、推測が必要、ruleに当たらない場合は文字列ではなくJSONのnullを返してください。",
        "文字列のnull、なし、不明、わからないは返さず、必ずJSONのnullを使ってください。",
        "複数項目は同じplayer_input解釈に基づいて整合させてください。読み変換などの派生項目は、同じ入力から抽出した値に対する結果だけを返してください。",
        "recent_messagesはplayer_input直前の文脈です。値はplayer_inputから抽出し、文脈だけから推測して補完しないでください。"
      ].join("\n"),
      input: {
        task: "extract_talk_flow_match",
        items: spec.items.map((item) => ({ id: item.id, rule: item.rule })),
        recent_messages: recentMessages(context),
        player_input: compact(playerInput, 1_000)
      },
      schema
    });
    if (!result.ok) return result;
    const output = parseTalkMatchOutput(result.value, spec);
    return output ? { ok: true as const, output } : { ok: false as const, error: "invalid_response" as const };
  }

  for (let sampleIndex = 0; sampleIndex < 5;) {
    const batchSize = sampleIndex === 0 ? 2 : 1;
    const results = await Promise.all(Array.from({ length: batchSize }, () => sample()));
    sampleIndex += batchSize;
    for (const result of results) {
      if (!result.ok) {
        if (result.error === "provider_error") return { ok: false as const, error: "provider_error" as const };
        invalidResponses += 1;
      } else {
        outputs.push(result.output);
      }
    }
    const selected = selectTalkMatch(spec, outputs, rule.set, sampleIndex >= 5);
    if (selected.ok) return { ok: true as const, values: selected.matchGroups };
  }

  return outputs.length === 0 && invalidResponses > 0
    ? { ok: false as const, error: "provider_invalid" as const }
    : { ok: false as const, error: "no_match" as const };
}
