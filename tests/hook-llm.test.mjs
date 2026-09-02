import assert from "node:assert/strict";
import test from "node:test";
import { scenarioHookHandlers } from "../src/project/hooks.ts";
import { createInitialPlayerState, workerScenario } from "../src/worker/scenario.ts";
import { createFakeStructuredOutputProvider } from "../src/worker/providers/structuredOutput.ts";
import { resolveHookLlmProfile } from "../src/worker/product/llmProfiles.ts";
import { runScenarioHooks } from "../src/worker/services/scenarioHooks.ts";

function withHook(id, handler, run) {
  const hook = { event: id, target: "", handler: id, cond: "", llm: true };
  workerScenario.hooks.push(hook);
  scenarioHookHandlers[id] = handler;
  return Promise.resolve(run()).finally(() => {
    workerScenario.hooks.splice(workerScenario.hooks.indexOf(hook), 1);
    delete scenarioHookHandlers[id];
  });
}

test("hook LLM profileはfastだけ通常modelへfallbackする", () => {
  assert.equal(resolveHookLlmProfile({ LLM_MODEL: "default-model" }, "fast").config.model, "default-model");
  assert.equal(resolveHookLlmProfile({ LLM_MODEL: "default-model" }, "super").ok, false);
  const ultra = resolveHookLlmProfile({ LLM_PROFILE_ULTRA_MODEL: "ultra-model" }, "ultra");
  assert.equal(ultra.ok && ultra.config.modelVersion, "ultra:ultra-model:medium");
});

test("hook LLM extractはschemaを検証して同じhookを再評価する", async () => {
  workerScenario.stateVariables.test_llm_value = "";
  workerScenario.stateVariableDefinitions.test_llm_value = { type: "string" };
  let calls = 0;
  try {
    await withHook("test_llm_extract", (context) => {
      const result = context.llm.extract("extract_name", {
        input: "田中",
        instructions: "名前を返す",
        schema: { name: "string" }
      });
      context.state.set("test_llm_value", result.name);
    }, async () => {
      const result = await runScenarioHooks(createInitialPlayerState(), { eventId: "test_llm_extract" }, {
        llmProvider: createFakeStructuredOutputProvider(() => {
          calls += 1;
          return { name: "田中" };
        }),
        llmEnv: { LLM_MODEL: "fake" }
      });
      assert.equal(result.state.stateValues.test_llm_value, "田中");
      assert.equal(calls, 1);
    });
  } finally {
    delete workerScenario.stateVariables.test_llm_value;
    delete workerScenario.stateVariableDefinitions.test_llm_value;
  }
});

test("hook LLMの壊れた応答はfallbackがあればfallbackを使う", async () => {
  workerScenario.stateVariables.test_llm_fallback = "";
  workerScenario.stateVariableDefinitions.test_llm_fallback = { type: "string" };
  try {
    await withHook("test_llm_fallback", (context) => {
      const result = context.llm.screen("screen", {
        input: "入力",
        instructions: "判定",
        schema: { result: "string" },
        fallback: { result: "fallback" }
      });
      context.state.set("test_llm_fallback", result.result);
    }, async () => {
      const result = await runScenarioHooks(createInitialPlayerState(), { eventId: "test_llm_fallback" }, {
        llmProvider: createFakeStructuredOutputProvider(() => ({ result: 1 })),
        llmEnv: { LLM_MODEL: "fake" }
      });
      assert.equal(result.state.stateValues.test_llm_fallback, "fallback");
    });
  } finally {
    delete workerScenario.stateVariables.test_llm_fallback;
    delete workerScenario.stateVariableDefinitions.test_llm_fallback;
  }
});

test("hook LLM matchはonceとstableの正本選択を使う", async () => {
  workerScenario.stateVariables.test_llm_match = "";
  workerScenario.stateVariableDefinitions.test_llm_match = { type: "string" };
  try {
    await withHook("test_llm_match", (context) => {
      const result = context.llm.match("match", {
        input: "黄色",
        mode: "once",
        match: { color: { rule: "色", pick: "same" } }
      });
      context.state.set("test_llm_match", result.color ?? "");
    }, async () => {
      let requestOperation;
      const result = await runScenarioHooks(createInitialPlayerState(), { eventId: "test_llm_match" }, {
        llmProvider: createFakeStructuredOutputProvider((request) => {
          requestOperation = request.operation;
          return { color: "黄色" };
        }),
        llmEnv: { LLM_MODEL: "fake", LLM_PROFILE_FAST_MODEL: "fake" }
      });
      assert.equal(result.state.stateValues.test_llm_match, "黄色");
      assert.equal(requestOperation, "match_extraction");
    });
  } finally {
    delete workerScenario.stateVariables.test_llm_match;
    delete workerScenario.stateVariableDefinitions.test_llm_match;
  }
});

test("hook LLM matchは正常候補が合意しない場合だけno_match fallbackを使う", async () => {
  workerScenario.stateVariables.test_llm_no_match = "";
  workerScenario.stateVariableDefinitions.test_llm_no_match = { type: "string" };
  let calls = 0;
  try {
    await withHook("test_llm_no_match", (context) => {
      const result = context.llm.match("no_match", {
        input: "色",
        match: { color: { rule: "色", pick: "same" } },
        fallback: { color: "fallback" }
      });
      context.state.set("test_llm_no_match", result.color ?? "");
    }, async () => {
      const values = ["赤", "青", "黄", "緑", "紫"];
      const result = await runScenarioHooks(createInitialPlayerState(), { eventId: "test_llm_no_match" }, {
        llmProvider: createFakeStructuredOutputProvider(() => ({ color: values[calls++] })),
        llmEnv: { LLM_MODEL: "fake", LLM_PROFILE_FAST_MODEL: "fake" }
      });
      assert.equal(result.state.stateValues.test_llm_no_match, "fallback");
      assert.equal(calls, 5);
    });
  } finally {
    delete workerScenario.stateVariables.test_llm_no_match;
    delete workerScenario.stateVariableDefinitions.test_llm_no_match;
  }
});
