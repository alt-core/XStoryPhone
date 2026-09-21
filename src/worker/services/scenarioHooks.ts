import { defaultScenarioRuntime } from "../scenario.ts";
import { scenarioHookHandlers } from "../../generated/scenarioHooks.generated.ts";
import { SCENARIO_HOOK_TALK_BLOCKS } from "../../generated/hookContext.generated.ts";
import { createScenarioHooksRuntime } from "./scenarioHooksRuntime.ts";
export type { ScenarioPresentationEffect, ScenarioPresentationSequence, ScenarioHookResult } from "./scenarioHooksRuntime.ts";
export const { runScenarioHooks } = createScenarioHooksRuntime(defaultScenarioRuntime, scenarioHookHandlers, SCENARIO_HOOK_TALK_BLOCKS);
