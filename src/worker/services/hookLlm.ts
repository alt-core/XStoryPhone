import type {
  HookLlmMatchResult,
  HookLlmMatchTaskOptions,
  HookLlmResult,
  HookLlmTaskOptions,
  ScenarioEventPayload
} from "../../shared/hooks.ts";
import {
  buildTalkFlowMatchExtractionMessages,
  parseTalkFlowMatchOutput,
  parseTalkFlowMatchSpec,
  talkFlowMatchExtractionResponseSchema
} from "../product/talkFlowMatchExtraction.ts";
import { runTalkFlowMatchExtractionSamples } from "../product/llmMatchExtractionRunner.ts";
import { normalizeHookLlmProfile, resolveHookLlmProfile } from "../product/llmProfiles.ts";
import type { LlmProviderEnv, StructuredOutputProvider } from "../providers/structuredOutput.ts";

export type HookLlmRequest =
  | {
      kind: "extract" | "screen";
      taskId: string;
      input: string;
      instructions: string;
      schema: Record<string, string>;
      maxTokens: number;
      fallback?: HookLlmResult;
    }
  | {
      kind: "match";
      taskId: string;
      input: string;
      rawMatch: string;
      profile: "fast" | "super" | "ultra";
      mode: "stable" | "once";
      fallback?: HookLlmMatchResult;
    };

export type HookLlmResolved = {
  output: HookLlmResult;
  status: "ready" | "fallback";
  errorCode?: HookLlmUnavailableError["reason"];
};

export class HookLlmUnavailableError extends Error {
  readonly reason: "provider_unavailable" | "provider_error" | "invalid_response" | "no_match";
  constructor(reason: "provider_unavailable" | "provider_error" | "invalid_response" | "no_match") {
    super(`hook_llm_${reason}`);
    this.reason = reason;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hookLlmRequestKey(request: HookLlmRequest, modelVersion: string) {
  return canonical({ version: 2, modelVersion, ...request });
}

function sourceInput(options: { input?: string; source?: string }, event: ScenarioEventPayload) {
  if (typeof options.input === "string") return options.input;
  const source = options.source?.trim() ?? "";
  if (source) {
    const top = event as unknown as Record<string, unknown>;
    const value = event.fields?.[source] ?? top[source];
    if (typeof value === "string") return value;
  }
  return event.playerInput ?? event.fields?.input ?? JSON.stringify(event.fields ?? {});
}

export function normalizeHookLlmRequest(
  kind: "extract" | "screen",
  taskId: string,
  options: HookLlmTaskOptions<HookLlmResult>,
  event: ScenarioEventPayload
): HookLlmRequest {
  if (!taskId.trim() || !options.instructions?.trim() || !options.schema || !Object.keys(options.schema).length) {
    throw new Error(`hook LLM taskが不正です: ${taskId}`);
  }
  return {
    kind,
    taskId: taskId.trim(),
    input: sourceInput(options, event),
    instructions: options.instructions.trim(),
    schema: options.schema,
    maxTokens: Math.max(1, Math.min(8_192, Math.round(options.maxTokens ?? 512))),
    ...(options.fallback ? { fallback: options.fallback } : {})
  };
}

export function normalizeHookLlmMatchRequest(
  taskId: string,
  options: HookLlmMatchTaskOptions<HookLlmMatchResult>,
  event: ScenarioEventPayload
): HookLlmRequest {
  const profile = normalizeHookLlmProfile(options.profile);
  if (!profile.ok) throw new Error(profile.error);
  const rawMatch = typeof options.match === "string" ? options.match : JSON.stringify(options.match);
  const parsed = parseTalkFlowMatchSpec(rawMatch);
  if (!taskId.trim() || !parsed.ok) throw new Error(`hook LLM matchが不正です: ${taskId}`);
  return {
    kind: "match",
    taskId: taskId.trim(),
    input: sourceInput(options, event),
    rawMatch,
    profile: profile.profile,
    mode: options.mode ?? "stable",
    ...(options.fallback ? { fallback: options.fallback } : {})
  };
}

function simpleSchema(schema: Record<string, string>) {
  const properties = Object.fromEntries(Object.entries(schema).map(([key, rule]) => {
    const types = rule.split("|").map((item) => item.trim()).flatMap((item) => (
      item === "string" ? ["string"] : item === "boolean" ? ["boolean"] : item === "integer" ? ["integer"]
        : item === "number" ? ["number"] : item === "null" ? ["null"] : []
    ));
    if (!types.length) throw new Error(`hook LLM schemaが不正です: ${key}=${rule}`);
    return [key, types.length === 1 ? { type: types[0] } : { type: types }];
  }));
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

function validateSimpleOutput(value: Record<string, unknown>, schema: Record<string, string>): HookLlmResult | null {
  if (Object.keys(value).some((key) => !(key in schema))) return null;
  const result: HookLlmResult = {};
  for (const [key, rule] of Object.entries(schema)) {
    const item = value[key];
    const allowed = new Set(rule.split("|").map((part) => part.trim()));
    const valid = item === null ? allowed.has("null")
      : typeof item === "string" ? allowed.has("string")
        : typeof item === "boolean" ? allowed.has("boolean")
          : typeof item === "number" && Number.isInteger(item) ? allowed.has("integer") || allowed.has("number")
            : typeof item === "number" ? allowed.has("number") : false;
    if (!valid) return null;
    result[key] = item as HookLlmResult[string];
  }
  return result;
}

async function resolveSchemaRequest(provider: StructuredOutputProvider, request: Extract<HookLlmRequest, { kind: "extract" | "screen" }>) {
  const result = await provider.completeJson({
    taskId: request.taskId,
    instructions: request.instructions,
    input: { input: request.input },
    schema: simpleSchema(request.schema),
    maxTokens: request.maxTokens,
    temperature: 0
  });
  if (!result.ok) return request.fallback
    ? { output: request.fallback, status: "fallback" as const, errorCode: result.error }
    : new HookLlmUnavailableError(result.error);
  const output = validateSimpleOutput(result.value, request.schema);
  return output
    ? { output, status: "ready" as const }
    : request.fallback
      ? { output: request.fallback, status: "fallback" as const, errorCode: "invalid_response" as const }
      : new HookLlmUnavailableError("invalid_response");
}

async function resolveMatchRequest(provider: StructuredOutputProvider, env: LlmProviderEnv, request: Extract<HookLlmRequest, { kind: "match" }>) {
  const profile = resolveHookLlmProfile(env, request.profile);
  if (!profile.ok) return request.fallback
    ? { output: request.fallback, status: "fallback" as const, errorCode: "provider_unavailable" as const }
    : new HookLlmUnavailableError("provider_unavailable");
  const parsed = parseTalkFlowMatchSpec(request.rawMatch);
  if (!parsed.ok) throw new Error(parsed.error);
  const result = await runTalkFlowMatchExtractionSamples(parsed.spec, [], async () => {
      const messages = buildTalkFlowMatchExtractionMessages({
        talkId: "",
        fromId: request.taskId,
        ruleId: request.taskId,
        playerInput: request.input,
        recentMessages: [],
        spec: parsed.spec
      });
      const response = await provider.completeJson({
        taskId: request.taskId,
        operation: "match_extraction",
        instructions: messages[0]?.content ?? "",
        input: JSON.parse(messages[1]?.content ?? "{}") as Record<string, unknown>,
        schema: talkFlowMatchExtractionResponseSchema(parsed.spec),
        maxTokens: Math.max(512, Math.min(2_048, 256 + parsed.spec.items.length * 256)),
        temperature: 0,
        model: profile.config.model,
        reasoningEffort: profile.config.reasoningEffort,
        timeoutMs: profile.config.timeoutMs
      });
      if (!response.ok) return { status: response.error } as const;
      const output = parseTalkFlowMatchOutput(response.value, parsed.spec);
      return output.ok
        ? { status: "ready" as const, output: output.output }
        : { status: "invalid_response" as const };
    }, { maxSamples: 5, selectionMode: request.mode });
  if (result.ok) return { output: result.values, status: "ready" as const };
  const reason = result.reason;
  return request.fallback
    ? { output: request.fallback, status: "fallback" as const, errorCode: reason }
    : new HookLlmUnavailableError(reason);
}

export async function resolveHookLlmRequest(provider: StructuredOutputProvider | null, env: LlmProviderEnv, request: HookLlmRequest) {
  if (!provider) return request.fallback
    ? { output: request.fallback, status: "fallback" as const, errorCode: "provider_unavailable" as const }
    : new HookLlmUnavailableError("provider_unavailable");
  return request.kind === "match"
    ? resolveMatchRequest(provider, env, request)
    : resolveSchemaRequest(provider, request);
}

export function hookLlmModelVersion(env: LlmProviderEnv, request: HookLlmRequest) {
  if (request.kind === "match") {
    const resolved = resolveHookLlmProfile(env, request.profile);
    return resolved.ok ? resolved.config.modelVersion : `unavailable:${request.profile}`;
  }
  return env.LLM_MODEL?.trim() || "unavailable";
}
