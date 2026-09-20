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
import {
  canonicalLlmJson, llmRequestHashes, resolveStructuredOutputConfig,
  type LlmProviderEnv, type StructuredOutputProvider
} from "../providers/structuredOutput.ts";

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

export function hookLlmRequestKey(request: HookLlmRequest, modelVersion: string) {
  return canonicalLlmJson({ version: 2, modelVersion, ...request });
}

function sourceInput(options: { input?: string; source?: string }, event: ScenarioEventPayload) {
  if (typeof options.input === "string" && options.input.trim()) return options.input.trim();
  const source = options.source?.trim() ?? "";
  if (!source) return "";
  if (source === "player_message") return event.playerInput?.trim() ?? "";
  const top = event as unknown as Record<string, unknown>;
  const value = Object.prototype.hasOwnProperty.call(event.fields ?? {}, source) ? event.fields?.[source]
    : Object.prototype.hasOwnProperty.call(top, source) ? top[source] : undefined;
  if (typeof value === "string") return value.trim();
  throw new Error(`hook LLMのsourceが未定義です: ${source}`);
}

type SchemaField = { kind: "string" | "boolean" | "integer" | "number" | "null"; maxLength?: number; pattern?: string };

function schemaFields(rule: string): SchemaField[] {
  if (typeof rule !== "string" || !rule.trim()) throw new Error("hook LLM schemaが空です。");
  return rule.split("|").map((raw): SchemaField => {
    const spec = raw.trim();
    if (["string", "boolean", "integer", "number", "null"].includes(spec)) return { kind: spec as SchemaField["kind"] };
    if (spec === "hiragana_1_5") return { kind: "string", maxLength: 5, pattern: "^[ぁ-ゖー]{1,5}$" };
    if (spec === "safe_reading_text") return { kind: "string", maxLength: 240 };
    const length = /^string_max_(\d+)$/u.exec(spec);
    if (length && Number.isSafeInteger(Number(length[1]))) return { kind: "string", maxLength: Number(length[1]) };
    throw new Error(`hook LLM schemaが不正です: ${spec}`);
  });
}

function schemaFieldBudget(spec: string) {
  const field = schemaFields(spec)[0];
  if (field.kind !== "string") return 12;
  if (field.pattern) return 18;
  if (spec.trim() === "safe_reading_text") return 384;
  return field.maxLength === undefined ? 96 : 18 + Math.ceil(Math.min(field.maxLength, 500) * 1.5);
}

function schemaTokenBudget(schema: Record<string, string>, explicit?: number) {
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit)) throw new Error("hook LLM maxTokensは有限の数値にしてください。");
    return Math.max(1, Math.min(8_192, Math.round(explicit)));
  }
  const estimated = 48 + Object.values(schema).reduce((sum, rule) => sum + Math.max(...rule.split("|").map(schemaFieldBudget)), 0);
  return Math.max(512, Math.min(4_096, estimated));
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
  simpleSchema(options.schema);
  if (options.fallback !== undefined && !validateSimpleOutput(options.fallback, options.schema)) {
    throw new Error(`hook LLM fallbackがschemaと一致しません: ${taskId}`);
  }
  return {
    kind,
    taskId: taskId.trim(),
    input: sourceInput(options, event),
    instructions: options.instructions.trim(),
    schema: options.schema,
    maxTokens: schemaTokenBudget(options.schema, options.maxTokens),
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {})
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
  if (options.mode !== undefined && options.mode !== "stable" && options.mode !== "once") throw new Error("hook LLM modeはstable/onceにしてください。");
  let fallback: HookLlmMatchResult | undefined;
  if (options.fallback !== undefined) {
    const checked = parseTalkFlowMatchOutput(options.fallback, parsed.spec);
    if (!checked.ok || parsed.spec.items.some((item) => item.nullMode === "no" && checked.output[item.id] === null)) {
      throw new Error(`hook LLM matchのfallbackが不正です: ${taskId}`);
    }
    fallback = checked.output;
  }
  return {
    kind: "match",
    taskId: taskId.trim(),
    input: sourceInput(options, event),
    rawMatch,
    profile: profile.profile,
    mode: options.mode ?? "stable",
    ...(fallback !== undefined ? { fallback } : {})
  };
}

function simpleSchema(schema: Record<string, string>) {
  const properties = Object.fromEntries(Object.entries(schema).map(([key, rule]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(key)) throw new Error(`hook LLM schemaのkeyが不正です: ${key}`);
    const fields = schemaFields(rule).map(({ kind, ...constraints }) => ({ type: kind, ...constraints }));
    return [key, fields.length === 1 ? fields[0] : { anyOf: fields }];
  }));
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

function validateSimpleOutput(value: Record<string, unknown>, schema: Record<string, string>): HookLlmResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !(key in schema))) return null;
  const result: HookLlmResult = {};
  for (const [key, rule] of Object.entries(schema)) {
    const item = value[key];
    const valid = schemaFields(rule).some((field) => {
      if (field.kind === "null") return item === null;
      if (field.kind === "string") return typeof item === "string"
        && (field.maxLength === undefined || item.length <= field.maxLength)
        && (!field.pattern || new RegExp(field.pattern, "u").test(item));
      if (field.kind === "boolean") return typeof item === "boolean";
      return typeof item === "number" && Number.isFinite(item) && (field.kind === "number" || Number.isInteger(item));
    });
    if (!valid) return null;
    result[key] = item as HookLlmResult[string];
  }
  return result;
}

async function resolveSchemaRequest(provider: StructuredOutputProvider, request: Extract<HookLlmRequest, { kind: "extract" | "screen" }>) {
  const hashes = await hookLlmRequestHashes(request);
  const result = await provider.completeJson({
    taskId: request.taskId,
    instructions: [
      "あなたはARGシナリオ用の入力フィルタです。出力はJSON objectだけにしてください。",
      "表示用の本文やNPC返信を自由生成してはいけません。",
      `種別: ${request.kind}`, `指示: ${request.instructions}`
    ].join("\n"),
    input: { input: request.input },
    schema: simpleSchema(request.schema),
    maxTokens: request.maxTokens,
    temperature: 0,
    observation: { source: "hook_llm", ...hashes }
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
  const hashes = await hookLlmRequestHashes(request);
  const result = await runTalkFlowMatchExtractionSamples(parsed.spec, [], async (sampleIndex) => {
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
        timeoutMs: profile.config.timeoutMs,
        observation: { source: "hook_llm", sampleIndex, ...hashes }
      });
      if (!response.ok) return { status: response.error } as const;
      const output = parseTalkFlowMatchOutput(response.value, parsed.spec);
      provider.observeResult?.({ source: "hook_llm", taskId: request.taskId, sampleIndex, status: output.ok ? "sample_ready" : "invalid_response", ...hashes }, { output: output.ok ? output.output : null });
      return output.ok
        ? { status: "ready" as const, output: output.output }
        : { status: "invalid_response" as const };
    }, { maxSamples: 5, selectionMode: request.mode });
  provider.observeResult?.({ source: "hook_llm", taskId: request.taskId, status: result.ok ? "ready" : result.reason, sampleCount: result.sampleCount, ...hashes }, { outputs: result.outputs, selected: result.ok ? result.values : null });
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
  const result = request.kind === "match"
    ? await resolveMatchRequest(provider, env, request)
    : await resolveSchemaRequest(provider, request);
  provider.observeResult?.({ source: "hook_llm", taskId: request.taskId, status: result instanceof HookLlmUnavailableError ? result.reason : result.status, ...await hookLlmRequestHashes(request) });
  return result;
}

export function hookLlmModelVersion(env: LlmProviderEnv, request: HookLlmRequest) {
  let overrides = {};
  if (request.kind === "match") {
    const resolved = resolveHookLlmProfile(env, request.profile);
    if (!resolved.ok) return `unavailable:${request.profile}`;
    overrides = resolved.config;
  }
  return canonicalLlmJson(resolveStructuredOutputConfig(env, overrides));
}

export function hookLlmRequestHashes(request: HookLlmRequest) {
  return llmRequestHashes(request.input, request.kind === "match" ? request.rawMatch : request.instructions,
    request.kind === "match" ? JSON.parse(request.rawMatch) : request.schema);
}
