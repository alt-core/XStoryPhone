import type { LlmHashes, LlmProviderEnv } from "./structuredOutput.ts";

// TypeSafeのSystem One modelは生成せず、型付きの質問へ確率付きで答える。会話rule選択だけで使う。
const typesafeDefaultModel = "jev-1.13.0";
const typesafeEndpoint = "https://api.typesafe.ai/v1/systemone";
const typesafeTimeoutMs = 10_000;

export type TypesafeConfig = {
  apiKey: string;
  model: string;
  minConfidence: number;
  minGameOverConfidence: number;
  analytics: boolean;
  debugLogs: boolean;
};

export type TypesafeConfigResult = ({ ok: true } & TypesafeConfig) | { ok: false; reason: string };

export type TypesafeRequestResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: "provider_error" | "provider_invalid"; httpStatus?: number };

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function threshold(value: unknown, fallback: number) {
  const text = cleanText(value);
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export function resolveTypesafeConfig(env: LlmProviderEnv): TypesafeConfigResult {
  const apiKey = cleanText(env.TYPESAFE_API_KEY);
  if (!apiKey) return { ok: false, reason: "TYPESAFE_API_KEYが未設定です。" };
  const minConfidence = threshold(env.TYPESAFE_MIN_CONFIDENCE, 0.65);
  if (minConfidence === null) return { ok: false, reason: "TYPESAFE_MIN_CONFIDENCEは0〜1の数値にしてください。" };
  const minGameOverConfidence = threshold(env.TYPESAFE_GAME_OVER_MIN_CONFIDENCE, 0.9);
  if (minGameOverConfidence === null) return { ok: false, reason: "TYPESAFE_GAME_OVER_MIN_CONFIDENCEは0〜1の数値にしてください。" };
  if (minGameOverConfidence < minConfidence) {
    return { ok: false, reason: "TYPESAFE_GAME_OVER_MIN_CONFIDENCEはTYPESAFE_MIN_CONFIDENCE以上にしてください。" };
  }
  return {
    ok: true,
    apiKey,
    model: cleanText(env.TYPESAFE_MODEL) || typesafeDefaultModel,
    minConfidence,
    minGameOverConfidence,
    analytics: env.LLM_ANALYTICS_ENABLED === "true",
    debugLogs: env.LLM_DEBUG_LOGS === "true"
  };
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function inputTokens(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  return typeof usage?.input_tokens === "number" ? usage.input_tokens : 0;
}

// 通信例外と408・429・5xxだけを、既存LLMと同じく250ms後に1回再試行する。
export async function requestTypesafeSystemOne(
  config: TypesafeConfig,
  body: Record<string, unknown>,
  observation: Partial<LlmHashes> & Record<string, unknown> = {}
): Promise<TypesafeRequestResult> {
  const startedAt = Date.now();
  const attempts: Array<{ attempt: number; httpStatus?: number; error?: string; durationMs: number }> = [];
  const finish = (result: TypesafeRequestResult, payload?: unknown) => {
    const summary = {
      provider: "typesafe",
      ...observation,
      model: config.model,
      outcome: result.ok ? "ready" : result.error,
      attempts: attempts.length,
      retries: Math.max(0, attempts.length - 1),
      durationMs: Date.now() - startedAt,
      usage: { inputTokens: inputTokens(payload) }
    };
    if (config.analytics) console.log(JSON.stringify({ event: "llm_usage", ...summary }));
    if (config.debugLogs) console.log(JSON.stringify({ event: "llm_debug", ...summary, request: body, attempts, providerPayload: payload }));
    return result;
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), typesafeTimeoutMs);
    const retry = attempt === 0 ? () => new Promise((resolve) => setTimeout(resolve, 250)) : null;
    let response: Response;
    try {
      response = await fetch(typesafeEndpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch {
      clearTimeout(timeoutId);
      attempts.push({ attempt: attempt + 1, error: "network_error", durationMs: Date.now() - attemptStartedAt });
      if (retry) { await retry(); continue; }
      return finish({ ok: false, error: "provider_error" });
    }
    if (!response.ok) {
      clearTimeout(timeoutId);
      attempts.push({ attempt: attempt + 1, httpStatus: response.status, error: "http_error", durationMs: Date.now() - attemptStartedAt });
      if (retry && retryableStatus(response.status)) { await retry(); continue; }
      return finish({ ok: false, error: "provider_error", httpStatus: response.status });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      const invalid = error instanceof SyntaxError;
      attempts.push({ attempt: attempt + 1, httpStatus: response.status, error: invalid ? "invalid_json" : "response_error", durationMs: Date.now() - attemptStartedAt });
      if (!invalid && retry) { await retry(); continue; }
      return finish({ ok: false, error: invalid ? "provider_invalid" : "provider_error" });
    }
    clearTimeout(timeoutId);
    attempts.push({ attempt: attempt + 1, httpStatus: response.status, durationMs: Date.now() - attemptStartedAt });
    return finish({ ok: true, payload }, payload);
  }
  return finish({ ok: false, error: "provider_error" });
}
