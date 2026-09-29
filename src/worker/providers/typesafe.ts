import type { LlmHashes, LlmProviderEnv } from "./structuredOutput.ts";
import { talkFlowLlmDefaultThresholds } from "../product/talkFlowLlmSelection.ts";
import { reportedTokenUsage, type ProviderUsageObserver } from "./providerUsage.ts";

// TypeSafeのSystem One modelは生成せず、型付きの質問へ確率付きで答える。会話rule選択だけで使う。
const typesafeDefaultModel = "jev-1.13.0";
const typesafeEndpoint = "https://api.typesafe.ai/v1/systemone";
const typesafeTimeoutMs = 10_000;

export type TypesafeConfig = {
  requestDeadlineMs?: number;
  apiKey: string;
  model: string;
  minConfidence: number;
  // 進むruleだけに課す閾値。未設定なら通常の閾値と同じ。
  minAdvanceConfidence: number;
  minGameOverConfidence: number;
  // 閾値未満の結果をdefaultへ戻すか、既存のLLM判定へ回すか。
  lowConfidenceFallback: "default" | "llm";
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
  const minConfidence = threshold(env.TYPESAFE_MIN_CONFIDENCE, talkFlowLlmDefaultThresholds.minConfidence);
  if (minConfidence === null) return { ok: false, reason: "TYPESAFE_MIN_CONFIDENCEは0〜1の数値にしてください。" };
  const minGameOverConfidence = threshold(env.TYPESAFE_GAME_OVER_MIN_CONFIDENCE, talkFlowLlmDefaultThresholds.minGameOverConfidence);
  if (minGameOverConfidence === null) return { ok: false, reason: "TYPESAFE_GAME_OVER_MIN_CONFIDENCEは0〜1の数値にしてください。" };
  if (minGameOverConfidence < minConfidence) {
    return { ok: false, reason: "TYPESAFE_GAME_OVER_MIN_CONFIDENCEはTYPESAFE_MIN_CONFIDENCE以上にしてください。" };
  }
  const minAdvanceConfidence = threshold(env.TYPESAFE_ADVANCE_MIN_CONFIDENCE, minConfidence);
  if (minAdvanceConfidence === null) return { ok: false, reason: "TYPESAFE_ADVANCE_MIN_CONFIDENCEは0〜1の数値にしてください。" };
  if (minAdvanceConfidence < minConfidence) {
    return { ok: false, reason: "TYPESAFE_ADVANCE_MIN_CONFIDENCEはTYPESAFE_MIN_CONFIDENCE以上にしてください。" };
  }
  const lowConfidenceFallback = cleanText(env.TYPESAFE_LOW_CONFIDENCE_FALLBACK) || "default";
  if (lowConfidenceFallback !== "default" && lowConfidenceFallback !== "llm") {
    return { ok: false, reason: "TYPESAFE_LOW_CONFIDENCE_FALLBACKはdefaultまたはllmにしてください。" };
  }
  return {
    ok: true,
    apiKey,
    model: cleanText(env.TYPESAFE_MODEL) || typesafeDefaultModel,
    minConfidence,
    minAdvanceConfidence,
    minGameOverConfidence,
    lowConfidenceFallback,
    ...(env.requestDeadlineMs !== undefined ? { requestDeadlineMs: env.requestDeadlineMs } : {}),
    analytics: env.LLM_ANALYTICS_ENABLED === "true",
    debugLogs: env.LLM_DEBUG_LOGS === "true"
  };
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

// 不正応答は最大2回、通信例外と408・429・5xxは初回失敗時だけ、250ms後に再試行する。
// 同じループで扱い、混在しても合計3試行と要求共通締切を超えない。
export async function requestTypesafeSystemOne(
  config: TypesafeConfig,
  body: Record<string, unknown>,
  observation: Partial<LlmHashes> & Record<string, unknown> = {},
  onUsage?: ProviderUsageObserver,
  // 呼び出し元は本文ではなく、固定の検証失敗コードだけを返す。
  validatePayload?: (payload: unknown) => string | undefined
): Promise<TypesafeRequestResult> {
  const startedAt = Date.now();
  const attempts: Array<{ attempt: number; httpStatus?: number; error?: string; durationMs: number; usage?: ReturnType<typeof reportedTokenUsage> }> = [];
  const remainingMs = () => Number.isFinite(config.requestDeadlineMs) ? config.requestDeadlineMs! - Date.now() : Infinity;
  let failureReason: string | undefined;
  const finish = (result: TypesafeRequestResult, payload?: unknown) => {
    const summary = {
      provider: "typesafe",
      ...observation,
      model: config.model,
      outcome: result.ok ? "ready" : result.error,
      attempts: attempts.length,
      retries: Math.max(0, attempts.length - 1),
      attemptDetails: attempts.map(({ attempt, httpStatus, error, durationMs }) => ({ attempt, httpStatus, error, durationMs })),
      ...(!result.ok ? { failureReason: failureReason ?? attempts[attempts.length - 1]?.error ?? result.error } : {}),
      durationMs: Date.now() - startedAt,
      usage: { inputTokens: attempts.reduce((total, attempt) => total + (attempt.usage?.inputTokens ?? 0), 0) }
    };
    if (config.analytics) console.log(JSON.stringify({ event: "llm_usage", ...summary }));
    if (config.debugLogs) console.log(JSON.stringify({ event: "llm_debug", ...summary, request: body, attempts, providerPayload: payload }));
    const model = payload && typeof payload === "object" ? (payload as { model?: unknown }).model : undefined;
    onUsage?.({
      provider: "typesafe", model: cleanText(model) || config.model, attempts: attempts.length,
      httpStatus: attempts[attempts.length - 1]?.httpStatus,
      usage: reportedTokenUsage(payload, "typesafe"),
      attemptUsages: attempts.map(attempt => attempt.usage ?? reportedTokenUsage(undefined, "typesafe"))
    });
    return result;
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const availableMs = Math.min(typesafeTimeoutMs, remainingMs());
    if (availableMs <= 0) {
      failureReason = "request_deadline";
      return finish({ ok: false, error: "provider_error" });
    }
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), availableMs);
    const retry = () => new Promise((resolve) => setTimeout(resolve, 250));
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
      attempts.push({ attempt: attempt + 1, error: controller.signal.aborted ? "timeout" : "network_error", durationMs: Date.now() - attemptStartedAt });
      if (attempt === 0 && remainingMs() > 250) { await retry(); continue; }
      return finish({ ok: false, error: "provider_error" });
    }
    if (!response.ok) {
      clearTimeout(timeoutId);
      attempts.push({ attempt: attempt + 1, httpStatus: response.status, error: "http_error", durationMs: Date.now() - attemptStartedAt });
      if (attempt === 0 && retryableStatus(response.status) && remainingMs() > 250) { await retry(); continue; }
      return finish({ ok: false, error: "provider_error", httpStatus: response.status });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      const invalid = error instanceof SyntaxError;
      attempts.push({ attempt: attempt + 1, httpStatus: response.status, error: controller.signal.aborted ? "timeout" : invalid ? "invalid_json" : "response_error", durationMs: Date.now() - attemptStartedAt });
      if (attempt < (invalid ? 2 : 1) && remainingMs() > 250) { await retry(); continue; }
      return finish({ ok: false, error: invalid ? "provider_invalid" : "provider_error" });
    }
    clearTimeout(timeoutId);
    const usage = reportedTokenUsage(payload, "typesafe");
    const validationFailureReason = validatePayload?.(payload);
    if (validationFailureReason) {
      attempts.push({ attempt: attempt + 1, httpStatus: response.status, error: validationFailureReason, durationMs: Date.now() - attemptStartedAt, usage });
      if (attempt < 2 && remainingMs() > 250) { await retry(); continue; }
      return finish({ ok: false, error: "provider_invalid" }, payload);
    }
    attempts.push({ attempt: attempt + 1, httpStatus: response.status, durationMs: Date.now() - attemptStartedAt, usage });
    return finish({ ok: true, payload }, payload);
  }
  return finish({ ok: false, error: "provider_error" });
}
