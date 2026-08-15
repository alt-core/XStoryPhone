export type StructuredOutputRequest = {
  taskId: string;
  instructions: string;
  input: Record<string, unknown>;
  schema: Record<string, unknown>;
  maxTokens?: number;
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

export function createStructuredOutputProvider(env: LlmProviderEnv): StructuredOutputProvider | null {
  const apiKey = cleanText(env.LLM_API_KEY);
  const model = cleanText(env.LLM_MODEL);
  if (!apiKey || !model) {
    return null;
  }
  const baseUrl = cleanText(env.LLM_BASE_URL) || "https://api.openai.com/v1";
  const requestTimeoutMs = timeoutMs(env.LLM_TIMEOUT_MS);

  return {
    id: "openai-compatible",
    async completeJson(request) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
        let response: Response;
        try {
          response = await fetch(completionUrl(baseUrl), {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model,
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
              max_completion_tokens: request.maxTokens ?? 512
            }),
            signal: controller.signal
          });
        } catch {
          clearTimeout(timeoutId);
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          return { ok: false, error: "provider_error" };
        }
        if (!response.ok) {
          clearTimeout(timeoutId);
          if (attempt === 0 && retryableStatus(response.status)) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          return { ok: false, error: "provider_error" };
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          clearTimeout(timeoutId);
          if (!(error instanceof SyntaxError) && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          return { ok: false, error: error instanceof SyntaxError ? "invalid_response" : "provider_error" };
        }
        clearTimeout(timeoutId);
        const raw = messageContent(payload);
        const value = parseJsonObject(raw);
        return value
          ? { ok: true, value, raw }
          : { ok: false, error: "invalid_response" };
      }
      return { ok: false, error: "provider_error" };
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
