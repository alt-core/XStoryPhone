export type TalkFlowMatchPick = "same" | "best";
export type TalkFlowMatchNull = "no" | "ok" | "weak";
export type TalkFlowMatchSelectionMode = "stable" | "once";

export type TalkFlowMatchItem = {
  id: string;
  rule: string;
  pick: TalkFlowMatchPick;
  nullMode: TalkFlowMatchNull;
};

export type TalkFlowMatchSpec = {
  items: TalkFlowMatchItem[];
};

export type TalkFlowMatchOutput = Record<string, string | null>;

export type TalkFlowMatchSelection =
  | {
      ok: true;
      values: TalkFlowMatchOutput;
      matchGroups: Record<string, string>;
      score: number;
      maxScore: number;
    }
  | {
      ok: false;
      reason: "invalid_spec" | "no_value" | "missing_set_value";
      error?: string;
    };

type TalkFlowMatchRecentMessage = {
  speaker: string;
  body: string;
};

type TalkFlowMatchPromptInput = {
  talkId: string;
  fromId: string;
  ruleId: string;
  playerInput: string;
  recentMessages: readonly TalkFlowMatchRecentMessage[];
  spec: TalkFlowMatchSpec;
};

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

const matchIdPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;
const maxRuleLength = 1000;
const maxOutputStringLength = 240;
const maxPromptPlayerInputLength = 1000;
const maxRecentMessageBodyLength = 500;
const maxRecentMessageSpeakerLength = 40;

function compactText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeTalkFlowMatchString(value: string) {
  return value.normalize("NFC").trim();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function normalizeRecentMessages(messages: readonly TalkFlowMatchRecentMessage[] = []) {
  return messages
    .map((message) => ({
      speaker: compactText(message.speaker || "other", maxRecentMessageSpeakerLength) || "other",
      body: compactText(message.body, maxRecentMessageBodyLength)
    }))
    .filter((message) => message.body)
    .slice(-4);
}

function parseMatchItem(id: string, value: unknown): TalkFlowMatchItem | string {
  if (!matchIdPattern.test(id)) {
    return `match の id が不正です: ${id}`;
  }

  if (typeof value === "string") {
    const rule = value.trim();
    if (!rule) {
      return `match.${id} の rule が空です。`;
    }
    if (rule.length > maxRuleLength) {
      return `match.${id} の rule は ${maxRuleLength} 文字以内にしてください。`;
    }
    return { id, rule, pick: "same", nullMode: "no" };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `match.${id} は文字列または object にしてください。`;
  }

  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !["rule", "pick", "null"].includes(key));
  if (unknownKeys.length > 0) {
    return `match.${id} に未対応の key があります: ${unknownKeys.join(", ")}`;
  }

  const rule = typeof record.rule === "string" ? record.rule.trim() : "";
  if (!rule) {
    return `match.${id}.rule が空です。`;
  }
  if (rule.length > maxRuleLength) {
    return `match.${id}.rule は ${maxRuleLength} 文字以内にしてください。`;
  }

  const pickValue = record.pick;
  const pick = pickValue === undefined || pickValue === "same" ? "same" : pickValue === "best" ? "best" : null;
  if (!pick) {
    return `match.${id}.pick は省略 / "same" / "best" のいずれかにしてください。`;
  }

  const nullValue = record.null;
  const nullMode =
    nullValue === undefined || nullValue === "no"
      ? "no"
      : nullValue === "ok"
        ? "ok"
        : nullValue === "weak"
          ? "weak"
          : null;
  if (!nullMode) {
    return `match.${id}.null は省略 / "no" / "ok" / "weak" のいずれかにしてください。`;
  }

  return { id, rule, pick, nullMode };
}

export function parseTalkFlowMatchSpec(rawMatch: string): { ok: true; spec: TalkFlowMatchSpec } | { ok: false; error: string } {
  const trimmed = String(rawMatch ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "match が空です。" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "match は JSON object にしてください。" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "match は JSON object にしてください。" };
  }

  const items: TalkFlowMatchItem[] = [];
  for (const [id, value] of Object.entries(parsed)) {
    const item = parseMatchItem(id, value);
    if (typeof item === "string") {
      return { ok: false, error: item };
    }
    items.push(item);
  }

  if (items.length === 0) {
    return { ok: false, error: "match には 1 つ以上の項目を書いてください。" };
  }

  return { ok: true, spec: { items } };
}

export function talkFlowMatchExtractionResponseSchema(spec: TalkFlowMatchSpec) {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      spec.items.map((item) => [
        item.id,
        {
          type: ["string", "null"],
          maxLength: maxOutputStringLength
        }
      ])
    ),
    required: spec.items.map((item) => item.id)
  };
}

function talkFlowMatchMaxTokens(
  spec: TalkFlowMatchSpec,
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high"
) {
  const visibleBudget = Math.max(512, Math.min(2048, 256 + spec.items.length * 256));
  if (reasoningEffort === "high") {
    return Math.max(visibleBudget, 8192);
  }
  if (reasoningEffort === "medium") {
    return Math.max(visibleBudget, 4096);
  }
  if (reasoningEffort === "minimal" || reasoningEffort === "low") {
    return Math.max(visibleBudget, 2048);
  }
  return visibleBudget;
}

export function buildTalkFlowMatchExtractionMessages(input: TalkFlowMatchPromptInput): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "あなたは対話ゲームのSMS/チャット会話エンジン用の構造化抽出器です。",
        "会話NPCの返信本文、説明文、未定義の値を勝手に生成してはいけません。",
        "必ず指定JSON schemaに一致するJSON objectだけを返してください。",
        "各項目は、rule が生成を明示しない限り、player_inputから値を取り出せる場合だけ短い文字列を返してください。",
        "rule が生成を明示する項目だけ、player_inputに基づく短い原稿要素を生成してよいです。",
        "取り出せない、判断できない、推測が必要、項目のruleに当たらない場合はJSONのnullを返してください。",
        "文字列の\"null\"、\"なし\"、\"不明\"、\"わからない\"は返さず、必ずJSONのnullを使ってください。",
        "複数項目は同じplayer_input解釈に基づいて整合させてください。読み変換などの派生項目は、同じ入力から抽出した値に対する結果だけを返してください。",
        "recent_messagesはplayer_input直前の文脈です。値はplayer_inputから抽出し、文脈だけから推測して補完しないでください。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "extract_talk_flow_match",
        items: input.spec.items.map((item) => ({
          id: item.id,
          rule: item.rule
        })),
        recent_messages: normalizeRecentMessages(input.recentMessages),
        player_input: compactText(input.playerInput, maxPromptPlayerInputLength)
      })
    }
  ];
}

export function buildTalkFlowMatchExtractionChatCompletionBody(
  model: string,
  input: TalkFlowMatchPromptInput,
  options: { reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" } = {}
) {
  return {
    model,
    temperature: 0,
    max_tokens: talkFlowMatchMaxTokens(input.spec, options.reasoningEffort),
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "talk_flow_match_extraction",
        strict: true,
        schema: talkFlowMatchExtractionResponseSchema(input.spec)
      }
    },
    messages: buildTalkFlowMatchExtractionMessages(input)
  };
}

export function parseTalkFlowMatchOutput(
  raw: unknown,
  spec: TalkFlowMatchSpec
): { ok: true; output: TalkFlowMatchOutput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid_shape" };
  }

  const record = raw as Record<string, unknown>;
  const output: TalkFlowMatchOutput = {};
  for (const item of spec.items) {
    const value = record[item.id];
    if (value === null) {
      output[item.id] = null;
      continue;
    }
    if (typeof value !== "string") {
      return { ok: false, error: `invalid_value:${item.id}` };
    }
    const normalized = normalizeTalkFlowMatchString(value);
    if (normalized.length > maxOutputStringLength) {
      return { ok: false, error: `too_long:${item.id}` };
    }
    output[item.id] = normalized || null;
  }

  return { ok: true, output };
}

function collectMatchGroups(values: TalkFlowMatchOutput) {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function matchGroupsForStateUpdates(values: TalkFlowMatchOutput, setUpdates: readonly string[]) {
  const matchGroups = collectMatchGroups(values);
  for (const update of setUpdates) {
    for (const reference of String(update).matchAll(/\$match\.([a-zA-Z_][a-zA-Z0-9_]*)/gu)) {
      if (typeof matchGroups[reference[1]] !== "string") {
        return null;
      }
    }
  }
  return matchGroups;
}

function outputValue(output: TalkFlowMatchOutput, item: TalkFlowMatchItem) {
  return output[item.id] ?? null;
}

function outputAllowsNulls(output: TalkFlowMatchOutput, items: readonly TalkFlowMatchItem[]) {
  return items.every((item) => outputValue(output, item) !== null || item.nullMode !== "no");
}

function sameTupleKey(output: TalkFlowMatchOutput, sameItems: readonly TalkFlowMatchItem[]) {
  return canonicalJson(sameItems.map((item) => outputValue(output, item)));
}

function repeatedSameTupleCandidates(
  outputs: readonly TalkFlowMatchOutput[],
  sameItems: readonly TalkFlowMatchItem[]
) {
  const counts = new Map<string, number>();
  for (const output of outputs) {
    const key = sameTupleKey(output, sameItems);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return outputs.filter((output) => (counts.get(sameTupleKey(output, sameItems)) ?? 0) >= 2);
}

function bestItemScore(
  candidate: TalkFlowMatchOutput,
  candidates: readonly TalkFlowMatchOutput[],
  item: TalkFlowMatchItem
) {
  const value = outputValue(candidate, item);
  if (value === null) {
    if (item.nullMode === "weak") {
      return -1;
    }
    const key = canonicalJson(value);
    return candidates.some((other) => other !== candidate && canonicalJson(outputValue(other, item)) === key) ? 1 : 0;
  }

  const key = canonicalJson(value);
  return candidates.some((other) => other !== candidate && canonicalJson(outputValue(other, item)) === key) ? 1 : 0;
}

function candidateScore(
  candidate: TalkFlowMatchOutput,
  candidates: readonly TalkFlowMatchOutput[],
  bestItems: readonly TalkFlowMatchItem[]
) {
  return bestItems.reduce((score, item) => score + bestItemScore(candidate, candidates, item), 0);
}

export function selectTalkFlowMatchGroupsFromAttempts(
  spec: TalkFlowMatchSpec,
  outputs: readonly TalkFlowMatchOutput[],
  setUpdates: readonly string[] = [],
  options: { acceptPartial?: boolean; mode?: TalkFlowMatchSelectionMode } = {}
): TalkFlowMatchSelection {
  if (options.mode === "once") {
    let hadMissingSetValue = false;
    for (const output of outputs) {
      if (!outputAllowsNulls(output, spec.items)) {
        continue;
      }

      const matchGroups = matchGroupsForStateUpdates(output, setUpdates);
      if (!matchGroups) {
        hadMissingSetValue = true;
        continue;
      }

      return { ok: true, values: output, matchGroups, score: 0, maxScore: 0 };
    }

    return { ok: false, reason: hadMissingSetValue ? "missing_set_value" : "no_value" };
  }

  const filteredOutputs = outputs.filter((output) => outputAllowsNulls(output, spec.items));
  const sameItems = spec.items.filter((item) => item.pick === "same");
  const bestItems = spec.items.filter((item) => item.pick === "best");
  const candidates = repeatedSameTupleCandidates(filteredOutputs, sameItems);

  if (candidates.length === 0) {
    return { ok: false, reason: "no_value" };
  }

  let selected = candidates[0];
  let selectedScore = candidateScore(selected, candidates, bestItems);
  for (const candidate of candidates.slice(1)) {
    const score = candidateScore(candidate, candidates, bestItems);
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }

  const maxScore = bestItems.length;
  if (selectedScore < maxScore && options.acceptPartial !== true) {
    return { ok: false, reason: "no_value" };
  }

  const matchGroups = matchGroupsForStateUpdates(selected, setUpdates);
  if (!matchGroups) {
    return { ok: false, reason: "missing_set_value" };
  }

  return { ok: true, values: selected, matchGroups, score: selectedScore, maxScore };
}
