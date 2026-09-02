import type { ScenarioHookHandlerRegistry } from "../shared/hooks";
import type { ScenarioHookId } from "../generated/hookIds.generated";
import type { ProjectScenarioHookContext } from "../generated/hookContext.generated";

// scenario/<dir>/hooks.tsを置かない単一シナリオ構成向けの互換fallbackです。
export const scenarioHookHandlers = {} as ScenarioHookHandlerRegistry<ScenarioHookId, ProjectScenarioHookContext>;
