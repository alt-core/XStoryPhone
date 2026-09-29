export type ReportedTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
};

// 制作試験の集計用。本文・資格情報や永続化する状態は渡さない。
export type ProviderUsage = {
  provider: "typesafe" | "openai-compatible";
  model: string;
  attempts: number;
  httpStatus?: number;
  // 最終応答の報告値。再試行前に報告された分もattemptUsagesへ残す。
  usage: ReportedTokenUsage;
  attemptUsages: ReportedTokenUsage[];
};
export type ProviderUsageObserver = (usage: ProviderUsage) => void;

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function reportedTokenUsage(payload: unknown, provider: ProviderUsage["provider"]): ReportedTokenUsage {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  const details = usage?.prompt_tokens_details as { cached_tokens?: unknown } | undefined;
  return {
    inputTokens: tokenCount(provider === "typesafe" ? usage?.input_tokens : usage?.prompt_tokens),
    outputTokens: tokenCount(provider === "typesafe" ? usage?.output_tokens : usage?.completion_tokens),
    totalTokens: tokenCount(usage?.total_tokens),
    cachedTokens: tokenCount(provider === "typesafe" ? usage?.cached_tokens : details?.cached_tokens)
  };
}
