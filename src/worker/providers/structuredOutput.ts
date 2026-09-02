import { defaultGeminiOpenAiReasoningEffort } from "../product/llmProfiles.ts";

export type StructuredOutputRequest = {
  taskId: string;
  operation?: "match_extraction";
  instructions: string;
  input: Record<string, unknown>;
  schema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  model?: string;
  timeoutMs?: number;
};

export type StructuredOutputResult =
  | { ok: true; value: Record<string, unknown>; raw: string }
  | { ok: false; error: "provider_error" | "invalid_response" };

export type StructuredOutputProvider = {
  id: string;
  completeJson(request: StructuredOutputRequest): Promise<StructuredOutputResult>;
};

export type LlmProviderEnv = {
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  LLM_TIMEOUT_MS?: string;
  LLM_REASONING_EFFORT?: string;
  LLM_PROFILE_FAST_MODEL?: string;
  LLM_PROFILE_FAST_REASONING_EFFORT?: string;
  LLM_PROFILE_FAST_TIMEOUT_MS?: string;
  LLM_PROFILE_SUPER_MODEL?: string;
  LLM_PROFILE_SUPER_REASONING_EFFORT?: string;
  LLM_PROFILE_SUPER_TIMEOUT_MS?: string;
  LLM_PROFILE_ULTRA_MODEL?: string;
  LLM_PROFILE_ULTRA_REASONING_EFFORT?: string;
  LLM_PROFILE_ULTRA_TIMEOUT_MS?: string;
  LLM_ANALYTICS_ENABLED?: string;
  LLM_DEBUG_LOGS?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function timeoutMs(value: unknown) {
  const parsed = Number(cleanText(value));
  return Number.isFinite(parsed) && parsed >= 500 && parsed <= 120_000 ? Math.round(parsed) : 15_000;
}

function completionUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function completionTokenBudget(request: StructuredOutputRequest, reasoningEffort: StructuredOutputRequest["reasoningEffort"]) {
  const base = request.maxTokens ?? 512;
  if (!reasoningEffort || reasoningEffort === "none") return base;
  const extraction = request.operation === "match_extraction";
  const minimum = reasoningEffort === "high" ? (extraction ? 8_192 : 4_096)
    : reasoningEffort === "medium" ? (extraction ? 4_096 : 2_048)
      : extraction ? 2_048 : 1_024;
  return Math.max(base, minimum);
}

function messageContent(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return "";
  }
  const first = choices[0];
  if (!first || typeof first !== "object") {
    return "";
  }
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return "";
  }
  return cleanText((message as { content?: unknown }).content);
}

function parseJsonObject(source: string): Record<string, unknown> | null {
  const normalized = source.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    const value = JSON.parse(normalized);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function hashText(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function usageFromPayload(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  const number = (key: string) => typeof usage?.[key] === "number" ? usage[key] as number : 0;
  return {
    promptTokens: number("prompt_tokens"),
    completionTokens: number("completion_tokens"),
    totalTokens: number("total_tokens"),
    cachedTokens: typeof usage?.prompt_tokens_details === "object" && usage.prompt_tokens_details
      ? Number((usage.prompt_tokens_details as Record<string, unknown>).cached_tokens ?? 0)
      : 0
  };
}

export function createStructuredOutputProvider(env: LlmProviderEnv): StructuredOutputProvider | null {
  const apiKey = cleanText(env.LLM_API_KEY);
  const model = cleanText(env.LLM_MODEL)
    || cleanText(env.LLM_PROFILE_FAST_MODEL)
    || cleanText(env.LLM_PROFILE_SUPER_MODEL)
    || cleanText(env.LLM_PROFILE_ULTRA_MODEL);
  if (!apiKey || !model) {
    return null;
  }
  const baseUrl = cleanText(env.LLM_BASE_URL) || "https://api.openai.com/v1";
  const requestTimeoutMs = timeoutMs(env.LLM_TIMEOUT_MS);
  const configuredReasoningEffort = new Set(["none", "minimal", "low", "medium", "high"]).has(cleanText(env.LLM_REASONING_EFFORT))
    ? cleanText(env.LLM_REASONING_EFFORT) as StructuredOutputRequest["reasoningEffort"]
    : undefined;

  return {
    id: "openai-compatible",
    async completeJson(request) {
      const requestModel = cleanText(request.model) || model;
      const reasoningEffort = request.reasoningEffort
        ?? configuredReasoningEffort
        ?? defaultGeminiOpenAiReasoningEffort(requestModel);
      const timeoutForRequest = request.timeoutMs && request.timeoutMs >= 500 && request.timeoutMs <= 120_000
        ? request.timeoutMs
        : requestTimeoutMs;
      const startedAt = Date.now();
      const attempts: Array<{ attempt: number; httpStatus?: number; error?: string; durationMs: number; usage?: ReturnType<typeof usageFromPayload> }> = [];
      const [inputHash, promptHash, schemaHash] = await Promise.all([
        hashText(JSON.stringify(request.input)),
        hashText(request.instructions),
        hashText(JSON.stringify(request.schema))
      ]);
      const finish = async (result: StructuredOutputResult, payload?: unknown) => {
        const summary = {
          source: "structured_output",
          model: requestModel,
          taskId: request.taskId,
          outcome: result.ok ? "ready" : result.error,
          attempts: attempts.length,
          retries: Math.max(0, attempts.length - 1),
          durationMs: Date.now() - startedAt,
          usage: attempts.reduce((sum, attempt) => ({
            promptTokens: sum.promptTokens + (attempt.usage?.promptTokens ?? 0),
            completionTokens: sum.completionTokens + (attempt.usage?.completionTokens ?? 0),
            totalTokens: sum.totalTokens + (attempt.usage?.totalTokens ?? 0),
            cachedTokens: sum.cachedTokens + (attempt.usage?.cachedTokens ?? 0)
          }), { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 }),
          inputHash: inputHash.slice(0, 12),
          promptHash: promptHash.slice(0, 12),
          schemaHash: schemaHash.slice(0, 12)
        };
        if (env.LLM_ANALYTICS_ENABLED === "true") console.log(JSON.stringify({ event: "llm_usage", ...summary }));
        if (env.LLM_DEBUG_LOGS === "true") {
          console.log(JSON.stringify({
            event: "llm_debug",
            ...summary,
            request: { instructions: request.instructions, input: request.input, schema: request.schema },
            attempts,
            providerPayload: payload,
            parsedOutput: result.ok ? result.value : null
          }));
        }
        return result;
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const attemptStartedAt = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutForRequest);
        let response: Response;
        try {
          response = await fetch(completionUrl(baseUrl), {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: requestModel,
              messages: [
                { role: "system", content: request.instructions },
                { role: "user", content: JSON.stringify(request.input) }
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: request.taskId.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 60),
                  strict: true,
                  schema: request.schema
                }
              },
              ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
              ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
              max_completion_tokens: completionTokenBudget(request, reasoningEffort)
            }),
            signal: controller.signal
          });
        } catch {
          clearTimeout(timeoutId);
          attempts.push({ attempt: attempt + 1, error: "network_error", durationMs: Date.now() - attemptStartedAt });
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          return finish({ ok: false, error: "provider_error" });
        }
        if (!response.ok) {
          clearTimeout(timeoutId);
          attempts.push({ attempt: attempt + 1, httpStatus: response.status, error: "http_error", durationMs: Date.now() - attemptStartedAt });
          if (attempt === 0 && retryableStatus(response.status)) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          return finish({ ok: false, error: "provider_error" });
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          clearTimeout(timeoutId);
          attempts.push({ attempt: attempt + 1, httpStatus: response.status, error: error instanceof SyntaxError ? "invalid_json" : "response_error", durationMs: Date.now() - attemptStartedAt });
          if (!(error instanceof SyntaxError) && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          return finish({ ok: false, error: error instanceof SyntaxError ? "invalid_response" : "provider_error" });
        }
        clearTimeout(timeoutId);
        attempts.push({ attempt: attempt + 1, httpStatus: response.status, durationMs: Date.now() - attemptStartedAt, usage: usageFromPayload(payload) });
        const raw = messageContent(payload);
        const value = parseJsonObject(raw);
        return finish(value
          ? { ok: true, value, raw }
          : { ok: false, error: "invalid_response" }, payload);
      }
      return finish({ ok: false, error: "provider_error" });
    }
  };
}

export function createFakeStructuredOutputProvider(
  resolver: (request: StructuredOutputRequest) => Record<string, unknown>
): StructuredOutputProvider {
  return {
    id: "fake",
    async completeJson(request) {
      const value = resolver(request);
      return { ok: true, value, raw: JSON.stringify(value) };
    }
  };
}
