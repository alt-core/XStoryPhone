import type { WorkerScenario } from "../src/shared/scenario.ts";

export type CompiledScenario = {
  partWarnings: string[];
  worker: WorkerScenario;
  hookScripts: Record<string, string>;
};

export function loadAndValidateScenario(options?: { source?: unknown }): CompiledScenario;
