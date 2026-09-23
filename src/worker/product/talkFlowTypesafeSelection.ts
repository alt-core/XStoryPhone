import { normalizeRecentMessages, type TalkFlowLlmDecision, type TalkFlowLlmPromptInput } from "./talkFlowLlmSelection.ts";

// 固定文は主な学習言語の英語で書き、制作者のintent・criteriaは日本語のまま渡す。
const typesafeTalkRuleInstructions = {
  question: "Which candidate best matches what `player_input` says or does, as the player's message to the NPC in this chat?",
  notes: [
    "`player_input` is the player's latest message. Second-person words such as あなた or 君 refer to the NPC, not to a system or AI.",
    "`recent_messages` come right before `player_input`. A short yes, no, or pointing word answers the last of them.",
    "`context` describes the current scene and what the NPC is waiting for.",
    "Pick a candidate only when `player_input` states or strongly implies its action, target, and intent. A matching name or scene word alone is not enough.",
    "If a candidate needs several facts together, pick it only when all of them are present.",
    "Conditions marked 必須条件 are required. Candidates hit by 禁止条件 or 選ばない must not be picked.",
    "A negated, quoted, or joking mention does not perform the action."
  ]
};

const typesafeDefaultOption = "None of the other candidates clearly matches `player_input`.";

export type TypesafeTalkRuleAnswer = {
  decision: TalkFlowLlmDecision;
  probabilities: Record<string, number>;
  model: string;
  inputTokens: number;
};

export function buildTypesafeTalkRuleRequest(input: TalkFlowLlmPromptInput, model: string) {
  const defaultRule = input.rules.find((rule) => rule.id === input.defaultRuleId);
  return {
    model,
    state: {
      context: defaultRule?.criteria ?? "",
      recent_messages: normalizeRecentMessages(input.recentMessages),
      player_input: input.playerInput
    },
    questions: {
      rule: {
        type: "choice",
        instructions: typesafeTalkRuleInstructions,
        criteria: Object.fromEntries(input.rules.map((rule) => [
          rule.id,
          rule.id === input.defaultRuleId ? typesafeDefaultOption : { intent: rule.intent, criteria: rule.criteria }
        ]))
      }
    }
  };
}

function validProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function typesafeTalkRuleDecision(payload: unknown, input: TalkFlowLlmPromptInput): TypesafeTalkRuleAnswer | null {
  const body = record(payload);
  const answer = record(record(body?.answers)?.rule);
  const probabilities = record(answer?.probabilities);
  const ruleIds = new Set(input.rules.map((rule) => rule.id));
  const choice = answer?.choice;
  const confidence = answer?.confidence;
  if (!answer || answer.type !== "choice" || !probabilities) return null;
  if (typeof choice !== "string" || !ruleIds.has(choice)) return null;
  if (!validProbability(confidence)) return null;
  // 壊れた分布でgame over候補などを採らないよう、全候補の確率と最大値のchoiceを確かめる。
  if (![...ruleIds].every((id) => validProbability(probabilities[id]))) return null;
  if ([...ruleIds].some((id) => (probabilities[id] as number) > (probabilities[choice] as number))) return null;
  const usage = record(body?.usage);
  return {
    decision: {
      rule_id: choice,
      confidence,
      // 閾値未満の退避は後段のfallbackReasonが記録するので、ここではdefaultかどうかだけを表す。
      reason_code: choice === input.defaultRuleId ? "default_unclear" : "matched_intent"
    },
    probabilities: Object.fromEntries([...ruleIds].map((id) => [id, probabilities[id] as number])),
    model: typeof body?.model === "string" ? body.model : "",
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0
  };
}
