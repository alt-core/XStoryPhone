import type { CompiledScenario } from "../scenario-lib.mjs";
import type { StaticManifest } from "../../src/static/definition.ts";

export function staticPartLocators(root: string, projectId: string, partIds: readonly string[], initialize?: boolean): Record<string, string>;
export function buildStaticScenario(options: { root: string; outputDir: string; scenario: CompiledScenario; releaseId?: string }): Promise<StaticManifest | null>;
