import assert from "node:assert/strict";
import { compileScenarioHooks } from "./scenario-hooks.mjs";
import { matchesExpectedValue, expectedValuesForReport } from "./case-expectations.mjs";
import { createScenarioRuntime } from "../../src/worker/scenarioRuntime.ts";
import { scenarioForParts } from "../../src/worker/scenarioParts.ts";
import { createScenarioHooksRuntime } from "../../src/worker/services/scenarioHooksRuntime.ts";
import { resolveHookLlmRequest, HookLlmUnavailableError } from "../../src/worker/services/hookLlm.ts";
import { resolveStructuredOutputConfig } from "../../src/worker/providers/structuredOutput.ts";
import { effectiveStateValues, setStateValue } from "../../src/worker/stateValues.ts";

const fields = new Set([
  "id", "event", "stateValues", "loadedParts", "repairedAppIds", "repairedContentIds", "unlockedContentIds",
  "expectedOutcome", "expectedState", "expectedAudio", "mockLlm"
]);
const outcomes = ["completed", "rejected", "game_over", "all_clear", "skipped"];
const record = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function prepareCase(catalog, fixture) {
  assert.ok(record(fixture), "caseはobjectにしてください。");
  for (const key of Object.keys(fixture)) assert.ok(fields.has(key), `未対応のcase項目です: ${key}`);
  assert.ok(typeof fixture.id === "string" && fixture.id.trim(), "case.idが必要です。");
  assert.ok(record(fixture.event) && typeof fixture.event.eventId === "string" && fixture.event.eventId.trim(), "case.event.eventIdが必要です。");
  if (fixture.event.fields !== undefined) {
    assert.ok(record(fixture.event.fields) && Object.values(fixture.event.fields).every(value => typeof value === "string"), "event.fieldsは文字列のobjectにしてください。");
  }
  const expected = Array.isArray(fixture.expectedOutcome) ? fixture.expectedOutcome : [fixture.expectedOutcome];
  assert.ok(expected.length && expected.every(value => outcomes.includes(value)), `expectedOutcomeは${outcomes.join(" / ")}またはその配列です。`);
  const parts = fixture.loadedParts ?? [];
  assert.ok(Array.isArray(parts) && parts.every(id => (catalog.parts ?? ["base"]).includes(id)), "loadedPartsに未定義のpartがあります。");
  const loadedParts = [...new Set(["base", ...parts])];
  const scenario = scenarioForParts(catalog, loadedParts);
  for (const field of ["stateValues", "expectedState", "expectedAudio", "mockLlm"]) {
    if (fixture[field] !== undefined) assert.ok(record(fixture[field]), `case.${field}はobjectにしてください。`);
  }
  for (const [key, value] of Object.entries(fixture.expectedState ?? {})) {
    assert.ok(Object.hasOwn(scenario.stateVariables, key), `expectedStateに未取得または未定義のstateがあります: ${key}`);
    assert.ok(value instanceof RegExp || ["string", "number", "boolean"].includes(typeof value), `expectedStateの値が不正です: ${key}`);
  }
  for (const [key, value] of Object.entries(fixture.expectedAudio ?? {})) {
    assert.ok(scenario.generatedAudio.some(item => item.id === key), `expectedAudioに未取得または未定義の音声があります: ${key}`);
    assert.ok(typeof value === "string" || value instanceof RegExp, `expectedAudioは文字列またはRegExpにしてください: ${key}`);
  }
  const runtime = createScenarioRuntime(scenario);
  const state = runtime.createInitialPlayerState();
  state.loadedPartIds = loadedParts;
  for (const [key, value] of Object.entries(fixture.stateValues ?? {})) {
    assert.ok(Object.hasOwn(scenario.stateVariables, key), `stateValuesに未取得または未定義のstateがあります: ${key}`);
    state.stateValues = setStateValue(scenario.stateVariables, state.stateValues, key, value, scenario.stateVariableDefinitions);
  }
  for (const field of ["repairedAppIds", "repairedContentIds", "unlockedContentIds"]) {
    const ids = fixture[field] ?? [];
    const definitions = field === "repairedAppIds" ? scenario.apps : [...scenario.contents, ...scenario.talks];
    assert.ok(Array.isArray(ids) && ids.every(id => definitions.some(item => item.id === id && !item.unavailable)), `${field}に未取得または未定義のIDがあります。`);
    state[field] = [...new Set(ids)];
  }
  return { runtime, state, expected };
}

async function runHookCase(catalog, handlers, fixture, { live = false, provider = null, env = {} } = {}) {
  const startedAt = Date.now();
  const report = { id: fixture?.id, expectedOutcome: fixture?.expectedOutcome, tasks: [], checks: {}, executedHandlers: [] };
  let stage = "configuration";
  try {
    const { runtime, state, expected } = prepareCase(catalog, fixture);
    const scenario = runtime.workerScenario;
    Object.assign(report, {
      event: fixture.event, loadedParts: state.loadedPartIds,
      expectedState: expectedValuesForReport(fixture.expectedState), expectedAudio: expectedValuesForReport(fixture.expectedAudio)
    });
    // mockは実環境の接続先・秘密鍵・profileに依存させない。
    const llmEnv = live ? env : { LLM_MODEL: "fixture", LLM_PROFILE_SUPER_MODEL: "fixture", LLM_PROFILE_ULTRA_MODEL: "fixture" };
    const sampleIndices = new Map();
    const mock = {
      id: "hook-case-fixture",
      async completeJson(request) {
        if (!Object.hasOwn(fixture.mockLlm ?? {}, request.taskId)) {
          stage = "configuration";
          throw new Error(`mockLlmにtaskの応答がありません: ${request.taskId}`);
        }
        const configured = fixture.mockLlm[request.taskId];
        const samples = Array.isArray(configured) ? configured : [configured];
        if (!samples.length || !samples.every(record)) {
          stage = "configuration";
          throw new Error(`mockLlmは応答objectまたは1件以上の配列にしてください: ${request.taskId}`);
        }
        const index = sampleIndices.get(request.taskId) ?? 0;
        sampleIndices.set(request.taskId, index + 1);
        const value = samples[Math.min(index, samples.length - 1)];
        return { ok: true, value, raw: JSON.stringify(value) };
      }
    };
    const backend = scenario.features.llm ? (live ? provider : mock) : null;
    const observedHandlers = Object.fromEntries(Object.entries(handlers).map(([id, handler]) => [id, (context, event) => {
      if (!report.executedHandlers.includes(id)) report.executedHandlers.push(id);
      return handler(context, event);
    }]));
    const hooks = createScenarioHooksRuntime(runtime, observedHandlers, scenario.hookTalkBlocks ?? {});
    stage = "hook";
    const result = await hooks.runScenarioHooks(state, structuredClone(fixture.event), {
      llmEnv,
      async resolveLlm(_key, request) {
        stage = "llm";
        const taskStartedAt = Date.now();
        const task = { taskId: request.taskId, kind: request.kind, profile: request.profile, status: "unavailable", calls: 0 };
        report.tasks.push(task);
        const observedProvider = backend && {
          id: backend.id,
          async completeJson(input) {
            task.calls += 1;
            const config = resolveStructuredOutputConfig(llmEnv, input);
            Object.assign(task, { model: config.model, reasoningEffort: config.reasoningEffort, timeoutMs: config.timeoutMs });
            const response = await backend.completeJson(input);
            if (response.httpStatus) {
              task.httpStatus = response.httpStatus;
              report.httpStatus = response.httpStatus;
              // 認証失敗はfallbackや追加標本で隠さず、後続caseも停止させる。
              if ([401, 403].includes(response.httpStatus)) throw new Error(`hook_llm_http_${response.httpStatus}`);
            }
            if (response.ok && response.model) task.model = response.model;
            if (response.ok && response.usage) {
              task.usage = Object.fromEntries(Object.entries(response.usage).map(([key, value]) => [key, (task.usage?.[key] ?? 0) + value]));
            }
            return response;
          },
          observeResult(result, debug) { backend.observeResult?.(result, debug); }
        };
        try {
          const resolved = await resolveHookLlmRequest(observedProvider, llmEnv, request);
          if (resolved instanceof HookLlmUnavailableError) {
            task.errorCode = resolved.reason;
            throw resolved;
          }
          Object.assign(task, { status: resolved.status, errorCode: resolved.errorCode });
          stage = "hook";
          return resolved.output;
        } finally {
          task.durationMs = Date.now() - taskStartedAt;
        }
      }
    });
    const values = effectiveStateValues(scenario.stateVariables, result.state.stateValues);
    Object.assign(report, {
      outcome: result.rejection ? "rejected" : result.presentationSequence?.type ?? (report.executedHandlers.length ? "completed" : "skipped"),
      rejection: result.rejection, presentationSequence: result.presentationSequence,
      audio: Object.fromEntries(result.generatedAudioEffects.map(effect => [effect.id, effect.inputText])),
      state: Object.fromEntries(Object.keys(fixture.expectedState ?? {}).map(key => [key, values[key]]))
    });
    stage = "expectation";
    report.checks.outcome = expected.includes(report.outcome);
    report.checks.llm = report.tasks.every(task => task.status === "ready");
    if (fixture.expectedState !== undefined) report.checks.state = Object.entries(fixture.expectedState).every(([key, value]) => matchesExpectedValue(report.state[key], value));
    if (fixture.expectedAudio !== undefined) report.checks.audio = Object.entries(fixture.expectedAudio).every(([key, value]) => matchesExpectedValue(report.audio[key], value));
    const unusedMocks = live ? [] : Object.keys(fixture.mockLlm ?? {}).filter(taskId => !sampleIndices.has(taskId));
    if (unusedMocks.length) {
      stage = "configuration";
      throw new Error(`未使用のmockLlmがあります: ${unusedMocks.join(", ")}。このcaseで到達するtaskだけを指定してください。`);
    }
    const failed = Object.entries(report.checks).filter(([, ok]) => !ok).map(([key]) => key);
    assert.equal(failed.length, 0, `hook caseの期待と一致しません: ${failed.join(", ")}`);
    return { ...report, durationMs: Date.now() - startedAt };
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      caseResult: { ...report, failureStage: stage, durationMs: Date.now() - startedAt }
    });
  }
}

// 本番の生成・実行系を使う。試験対象のeventだけを実行し、DBや外部音声生成へは接続しない。
export async function runHookCases(build, cases, options = {}) {
  assert.ok(Array.isArray(cases) && cases.length, "casesには1件以上のcaseが必要です。");
  const ids = new Set();
  for (const item of cases) {
    assert.ok(typeof item?.id === "string" && item.id.trim() && !ids.has(item.id), "case.idが空または重複しています。");
    ids.add(item.id);
  }
  const source = compileScenarioHooks(build.hookScripts);
  const { scenarioHookHandlers } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const results = [];
  const failures = [];
  for (const fixture of cases) {
    try {
      results.push(await runHookCase(build.worker, scenarioHookHandlers, fixture, options));
    } catch (error) {
      failures.push({ id: fixture.id, ...error.caseResult, error: error.message });
      if (options.live && [401, 403].includes(error.caseResult?.httpStatus)) break;
    }
  }
  return { results, failures, summary: {
    planned: cases.length, attempted: results.length + failures.length, passed: results.length, failed: failures.length,
    fallback: failures.filter(row => row.tasks.some(task => task.status === "fallback")).length,
    failuresByStage: Object.fromEntries(["configuration", "hook", "llm", "expectation"].map(stage => [stage, failures.filter(row => row.failureStage === stage).length]))
  } };
}
