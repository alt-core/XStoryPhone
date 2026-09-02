export type OpenAiCompatibleReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export type HookLlmProfile = "fast" | "super" | "ultra";
export type LlmProfileConfig = {
  profile: HookLlmProfile;
  model: string;
  reasoningEffort?: OpenAiCompatibleReasoningEffort;
  timeoutMs?: number;
  modelVersion: string;
};
export type LlmProfileEnv = {
  LLM_MODEL?: string;
  LLM_PROFILE_FAST_MODEL?: string;
  LLM_PROFILE_FAST_REASONING_EFFORT?: string;
  LLM_PROFILE_FAST_TIMEOUT_MS?: string;
  LLM_PROFILE_SUPER_MODEL?: string;
  LLM_PROFILE_SUPER_REASONING_EFFORT?: string;
  LLM_PROFILE_SUPER_TIMEOUT_MS?: string;
  LLM_PROFILE_ULTRA_MODEL?: string;
  LLM_PROFILE_ULTRA_REASONING_EFFORT?: string;
  LLM_PROFILE_ULTRA_TIMEOUT_MS?: string;
};

export const hookLlmProfiles: readonly HookLlmProfile[] = ["fast", "super", "ultra"];
const reasoningEfforts = new Set<OpenAiCompatibleReasoningEffort>(["none", "minimal", "low", "medium", "high"]);

export function defaultGeminiOpenAiReasoningEffort(model: string): OpenAiCompatibleReasoningEffort | undefined {
  const normalized = model.toLowerCase();
  if ((normalized.includes("gemini-2.5") || normalized.includes("flash-lite")) && !normalized.includes("pro")) return "none";
  if (normalized.includes("gemini-3")) return "minimal";
  return undefined;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseReasoningEffort(value: unknown) {
  const normalized = cleanText(value).toLowerCase();
  return reasoningEfforts.has(normalized as OpenAiCompatibleReasoningEffort)
    ? normalized as OpenAiCompatibleReasoningEffort
    : undefined;
}

function parseTimeoutMs(value: unknown) {
  const parsed = Number(cleanText(value));
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.round(parsed);
  return rounded >= 500 && rounded <= 120_000 ? rounded : undefined;
}

export function normalizeHookLlmProfile(value: unknown): { ok: true; profile: HookLlmProfile } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, profile: "fast" };
  return hookLlmProfiles.includes(value as HookLlmProfile)
    ? { ok: true, profile: value as HookLlmProfile }
    : { ok: false, error: `profile は ${hookLlmProfiles.join(" / ")} のいずれかにしてください。` };
}

function profileValues(env: LlmProfileEnv, profile: HookLlmProfile) {
  if (profile === "super") return {
    model: cleanText(env.LLM_PROFILE_SUPER_MODEL),
    reasoningEffort: parseReasoningEffort(env.LLM_PROFILE_SUPER_REASONING_EFFORT),
    timeoutMs: parseTimeoutMs(env.LLM_PROFILE_SUPER_TIMEOUT_MS)
  };
  if (profile === "ultra") return {
    model: cleanText(env.LLM_PROFILE_ULTRA_MODEL),
    reasoningEffort: parseReasoningEffort(env.LLM_PROFILE_ULTRA_REASONING_EFFORT),
    timeoutMs: parseTimeoutMs(env.LLM_PROFILE_ULTRA_TIMEOUT_MS)
  };
  return {
    model: cleanText(env.LLM_PROFILE_FAST_MODEL) || cleanText(env.LLM_MODEL),
    reasoningEffort: parseReasoningEffort(env.LLM_PROFILE_FAST_REASONING_EFFORT),
    timeoutMs: parseTimeoutMs(env.LLM_PROFILE_FAST_TIMEOUT_MS)
  };
}

export function resolveHookLlmProfile(env: LlmProfileEnv, profile: HookLlmProfile) {
  const values = profileValues(env, profile);
  if (!values.model) return { ok: false as const, reason: "unavailable" as const, profile };
  const reasoningEffort = values.reasoningEffort
    ?? (profile === "fast" ? defaultGeminiOpenAiReasoningEffort(values.model) : "medium");
  const timeoutMs = values.timeoutMs ?? (profile === "fast" ? undefined : 60_000);
  return {
    ok: true as const,
    config: {
      profile,
      model: values.model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      modelVersion: `${profile}:${values.model}:${reasoningEffort ?? "default"}`
    } satisfies LlmProfileConfig
  };
}
