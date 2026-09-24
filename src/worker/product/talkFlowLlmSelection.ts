export type TalkFlowLlmMode = "" | "stay" | "game_over";

export type TalkFlowLlmRule = {
  id: string;
  from: string;
  isDefault: boolean;
  intent: string;
  criteria: string;
  mode: TalkFlowLlmMode;
};

export type TalkFlowLlmRecentMessage = {
  speaker: string;
  body: string;
};

export type TalkFlowLlmPromptInput = {
  talkId: string;
  kind: "sms" | "chat" | "search_agent";
  fromId: string;
  playerInput: string;
  recentMessages: readonly TalkFlowLlmRecentMessage[];
  rules: readonly TalkFlowLlmRule[];
  defaultRuleId: string;
};

export type TalkFlowLlmRuntimeRule = TalkFlowLlmRule & {
  type: "match" | "secret" | "ai" | "default";
  order: number;
  cond: string;
};

export type TalkFlowLlmDecision = {
  rule_id: string;
  confidence: number;
  reason_code:
    | "matched_intent"
    | "default_unclear"
    | "ambiguous_fallback";
};

export type TalkFlowLlmSelectionResult = {
  ruleId: string;
  accepted: boolean;
  fallbackReason?: string;
  decision?: TalkFlowLlmDecision;
};

export type TalkFlowRegexCriteriaParseResult =
  | { kind: "none" }
  | { kind: "ready"; regex: RegExp; source: string; flags: string }
  | { kind: "invalid"; error: string };

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type OpenAiCompatibleReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export type TalkFlowLlmChatCompletionOptions = {
  maxTokens?: number;
  reasoningEffort?: OpenAiCompatibleReasoningEffort;
};

export const talkFlowLlmRuleSelectionMaxTokens = 512;
const talkFlowLlmRecentMessageLimit = 4;
const talkFlowLlmRecentMessageBodyMaxLength = 500;
const talkFlowLlmRecentMessageSpeakerMaxLength = 40;

const reasonCodes: TalkFlowLlmDecision["reason_code"][] = [
  "matched_intent",
  "default_unclear",
  "ambiguous_fallback"
];

function defaultGeminiOpenAiReasoningEffort(model: string): OpenAiCompatibleReasoningEffort | undefined {
  const normalized = model.toLowerCase();
  if ((normalized.includes("gemini-2.5") || normalized.includes("flash-lite")) && !normalized.includes("pro")) {
    return "none";
  }
  if (normalized.includes("gemini-3")) {
    return "minimal";
  }
  return undefined;
}

function normalizeOpenAiMaxTokens(value: number | undefined, fallback: number, min: number, max: number) {
  const selected = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(selected)));
}

function talkFlowLlmRuleSelectionTokenBudget(reasoningEffort?: OpenAiCompatibleReasoningEffort) {
  if (reasoningEffort === "high") {
    return 4096;
  }
  if (reasoningEffort === "medium") {
    return 2048;
  }
  if (reasoningEffort === "minimal" || reasoningEffort === "low") {
    return 1024;
  }
  return talkFlowLlmRuleSelectionMaxTokens;
}

function compactPromptText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeTalkFlowRegexInput(value: string) {
  return value.normalize("NFC").trim();
}

function findRegexCriteriaEnd(source: string) {
  let escaped = false;
  let inCharClass = false;
  for (let index = 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (char === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (char === "/" && !inCharClass) {
      return index;
    }
  }
  return -1;
}

export function parseTalkFlowRegexCriteria(criteria: string): TalkFlowRegexCriteriaParseResult {
  const source = String(criteria ?? "").trim();
  if (!source.startsWith("/")) {
    return { kind: "none" };
  }

  const endIndex = findRegexCriteriaEnd(source);
  if (endIndex < 0) {
    return { kind: "invalid", error: "閉じる / がありません。" };
  }

  const pattern = source.slice(1, endIndex);
  const flags = source.slice(endIndex + 1);
  if (!/^[dgimsuvy]*$/u.test(flags)) {
    return { kind: "invalid", error: "flags は d/g/i/m/s/u/v/y だけを使ってください。" };
  }

  try {
    return { kind: "ready", regex: new RegExp(pattern, flags), source: pattern, flags };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "invalid", error: message };
  }
}

export function selectTalkFlowRuleByRegexCriteria<T extends TalkFlowLlmRule>(
  rules: readonly T[],
  playerInput: string
): T | null {
  const normalizedInput = normalizeTalkFlowRegexInput(playerInput);
  for (const rule of rules) {
    if (rule.isDefault) {
      continue;
    }

    const parsed = parseTalkFlowRegexCriteria(rule.criteria);
    if (parsed.kind !== "ready") {
      continue;
    }
    parsed.regex.lastIndex = 0;
    if (parsed.regex.test(normalizedInput)) {
      return rule;
    }
  }
  return null;
}

export function normalizeRecentMessages(messages: readonly TalkFlowLlmRecentMessage[] = []) {
  return messages
    .map((message) => ({
      speaker: compactPromptText(message.speaker || "other", talkFlowLlmRecentMessageSpeakerMaxLength) || "other",
      body: compactPromptText(message.body, talkFlowLlmRecentMessageBodyMaxLength)
    }))
    .filter((message) => message.body)
    .slice(-talkFlowLlmRecentMessageLimit);
}

export function buildTalkFlowLlmPromptInputForTurn<T extends TalkFlowLlmRuntimeRule>(params: {
  talkId: string;
  kind: "sms" | "chat" | "search_agent";
  fromId: string;
  playerInput: string;
  recentMessages?: readonly TalkFlowLlmRecentMessage[];
  commonRules: readonly T[];
  nodeRules: readonly T[];
  stateValues: Record<string, unknown>;
  evaluateCond: (cond: string, stateValues: Record<string, unknown>) => boolean;
}): { input: TalkFlowLlmPromptInput; activeRules: T[]; defaultRule: T } | null {
  const conditionStateValues = {
    ...params.stateValues,
    player_input: normalizeTalkFlowRegexInput(params.playerInput)
  };
  const activeRules = [...params.commonRules, ...params.nodeRules]
    .sort((a, b) => a.order - b.order)
    .filter((rule) => params.evaluateCond(rule.cond, conditionStateValues));
  const defaultRule = activeRules.find((rule) => rule.isDefault && rule.from !== "*") ?? null;
  if (!defaultRule) {
    return null;
  }
  const llmRules = activeRules.filter(rule => rule.type === "ai" || rule.isDefault);

  return {
    input: {
      talkId: params.talkId,
      kind: params.kind,
      fromId: params.fromId,
      playerInput: params.playerInput,
      recentMessages: normalizeRecentMessages(params.recentMessages),
      defaultRuleId: defaultRule.id,
      rules: llmRules.map((rule) => ({
        id: rule.id,
        from: rule.from,
        isDefault: rule.isDefault,
        intent: rule.intent,
        criteria: rule.criteria,
        mode: rule.mode
      }))
    },
    activeRules,
    defaultRule
  };
}

export function talkFlowLlmResponseSchema(ruleIds: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rule_id: {
        type: "string",
        enum: ruleIds
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1
      },
      reason_code: {
        type: "string",
        enum: reasonCodes
      }
    },
    required: ["rule_id", "confidence", "reason_code"]
  };
}

export function buildTalkFlowLlmMessages(input: TalkFlowLlmPromptInput): ChatMessage[] {
  const defaultRule = input.rules.find((rule) => rule.id === input.defaultRuleId);
  const ruleChoices = input.rules.map((rule) => ({
    rule_id: rule.id,
    default: rule.isDefault,
    intent: rule.intent || "default",
    criteria: rule.isDefault
      ? "候補criteriaに高確度で一致しない入力。current_contextを踏まえてdefaultとして扱う。"
      : rule.criteria || "どの通常候補にも高確度で一致しない場合の聞き返しまたは既定応答。"
  }));

  return [
    {
      role: "system",
      content: [
        "あなたは対話ゲームの端末内会話エンジン用のrule選択器です。",
        "NPCの返信本文、説明文、未定義の選択肢を生成してはいけません。",
        "必ず候補rule_idから1つだけ選び、指定JSON schemaに一致するJSON objectだけを返してください。",
        "current_contextは現在の場面、相手が待っていること、候補一覧だけでは分からない選択全体の文脈です。通常候補の選択条件としてはcandidate criteriaを優先してください。",
        "recent_messagesはplayer_input直前の文脈です。speakerがplayerなら過去のプレイヤー発話です。",
        "player_input内の「あなた」「君」は、通常は会話相手NPCを指します。判定器、システム、LLM自身を指す表現として扱わないでください。",
        "candidate criteriaは、特に明記がない限りplayer_inputの意味・行為・対象を分類する条件です。",
        "candidate criteriaの「必須条件」「禁止条件」「選ばない」は強制条件です。必須条件を満たさないrule、禁止条件や選ばない条件に当たるruleは選択不可です。",
        "criteriaに特定の `photo:...` 添付IDが必須とあるruleは、player_inputに同じ添付IDが含まれない限り選択不可です。",
        "criteriaが複数の事実をまとめて説明することを求める場合、player_inputに全要素が明示または強く含意されている場合だけ選んでください。一部だけなら先出し・不足・stay系の候補を選んでください。",
        "candidate criteriaに人物名や場面説明が含まれていても、それだけで選ばず、player_inputに明示または強く含意された行為・対象・意図で選んでください。",
        "player_inputが短い肯定、否定、指示語だけの場合は、recent_messagesの直近発話に対する返答として意味を補ってください。",
        "confidenceは候補criteriaに対する確信度です。否定文、引用、冗談、文脈依存、低確信の入力では高くしないでください。",
        "player_inputがphoto:で始まる場合、それは本文ではなく添付IDです。candidate criteriaに同じphoto IDがあるruleを最優先してください。",
        "複数候補に見える場合は、推測が広い候補ではなく、player_input内の具体的な行為・対象・添付IDを最も直接説明する候補を選んでください。",
        "defaultは最後のfallbackです。候補criteriaに高確度で一致する入力では、current_contextが固定進行を示していても一致した候補を優先してください。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "select_talk_flow_rule",
        current_context: defaultRule?.criteria ?? "",
        candidate_rules: ruleChoices,
        recent_messages: normalizeRecentMessages(input.recentMessages),
        player_input: input.playerInput
      })
    }
  ];
}

export function buildTalkFlowLlmChatCompletionBody(
  model: string,
  input: TalkFlowLlmPromptInput,
  options: TalkFlowLlmChatCompletionOptions = {}
) {
  const ruleIds = input.rules.map((rule) => rule.id);
  const reasoningEffort = options.reasoningEffort ?? defaultGeminiOpenAiReasoningEffort(model);
  return {
    model,
    temperature: 0,
    max_tokens: normalizeOpenAiMaxTokens(
      options.maxTokens,
      talkFlowLlmRuleSelectionTokenBudget(reasoningEffort),
      256,
      8192
    ),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "talk_flow_rule_selection",
        strict: true,
        schema: talkFlowLlmResponseSchema(ruleIds)
      }
    },
    messages: buildTalkFlowLlmMessages(input)
  };
}

export function parseTalkFlowLlmDecision(raw: unknown): TalkFlowLlmDecision | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<TalkFlowLlmDecision>;
  if (typeof value.rule_id !== "string") {
    return null;
  }
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)) {
    return null;
  }
  if (!reasonCodes.includes(value.reason_code as TalkFlowLlmDecision["reason_code"])) {
    return null;
  }
  return {
    rule_id: value.rule_id,
    confidence: Math.max(0, Math.min(1, value.confidence)),
    reason_code: value.reason_code as TalkFlowLlmDecision["reason_code"]
  };
}

export const talkFlowLlmDefaultThresholds = {
  minConfidence: 0.65,
  minGameOverConfidence: 0.9
} as const;

export function selectTalkFlowRuleFromLlmDecision(
  rawDecision: unknown,
  input: TalkFlowLlmPromptInput,
  options: {
    minConfidence?: number;
    minGameOverConfidence?: number;
  } = {}
): TalkFlowLlmSelectionResult {
  const minConfidence = options.minConfidence ?? talkFlowLlmDefaultThresholds.minConfidence;
  const minGameOverConfidence = options.minGameOverConfidence ?? talkFlowLlmDefaultThresholds.minGameOverConfidence;
  const decision = parseTalkFlowLlmDecision(rawDecision);
  if (!decision) {
    return { ruleId: input.defaultRuleId, accepted: false, fallbackReason: "invalid_shape" };
  }

  const selectedRule = input.rules.find((rule) => rule.id === decision.rule_id);
  if (!selectedRule) {
    return { ruleId: input.defaultRuleId, accepted: false, fallbackReason: "unknown_rule_id", decision };
  }

  if (decision.confidence < minConfidence) {
    return { ruleId: input.defaultRuleId, accepted: false, fallbackReason: "low_confidence", decision };
  }

  if (selectedRule.mode === "game_over" && decision.confidence < minGameOverConfidence) {
    return { ruleId: input.defaultRuleId, accepted: false, fallbackReason: "low_game_over_confidence", decision };
  }

  return { ruleId: selectedRule.id, accepted: true, decision };
}
