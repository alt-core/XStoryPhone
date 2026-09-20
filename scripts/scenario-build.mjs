import fs from "node:fs";
import path from "node:path";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { buildScenarioHooksModule } from "./lib/scenario-hooks.mjs";

const rootDir = process.cwd();
const sharedGeneratedDir = path.join(rootDir, "src/generated");
const clientGeneratedDir = path.join(rootDir, "src/client/generated");

function writeIfChanged(filePath, content) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (current !== content) fs.writeFileSync(filePath, content);
}

function typeUnion(values) {
  return values.length ? values.map((value) => JSON.stringify(value)).join(" | ") : "never";
}

function stateType(definition) {
  if (definition.type === "boolean") return "boolean";
  if (definition.type === "integer") return "number";
  if (definition.type === "enum") return typeUnion(definition.values ?? []);
  return "string";
}

try {
  const scenario = loadAndValidateScenario();
  const hooksModule = buildScenarioHooksModule(scenario.hookScripts);
  fs.mkdirSync(sharedGeneratedDir, { recursive: true });
  fs.mkdirSync(clientGeneratedDir, { recursive: true });
  writeIfChanged(
    path.join(sharedGeneratedDir, "workerScenario.generated.ts"),
    `// scenario:build により生成されます。直接編集しないでください。\nimport type { WorkerScenario } from "../shared/scenario";\n\nexport const workerScenario: WorkerScenario = ${JSON.stringify(scenario.worker, null, 2)};\n`
  );
  writeIfChanged(
    path.join(sharedGeneratedDir, "hookIds.generated.ts"),
    `// scenario:build により生成されます。直接編集しないでください。\nexport type ScenarioHookId = ${scenario.hookIds.length ? scenario.hookIds.map((id) => JSON.stringify(id)).join(" | ") : "never"};\n`
  );
  const stateEntries = Object.entries(scenario.worker.stateVariableDefinitions)
    .map(([id, definition]) => `  ${JSON.stringify(id)}: ${stateType(definition)};`)
    .join("\n");
  const hookTalkBlocks = JSON.stringify(scenario.hookTalkBlocksByTalk);
  writeIfChanged(
    path.join(sharedGeneratedDir, "hookContext.generated.ts"),
    `// scenario:build により生成されます。直接編集しないでください.\nimport type { ScenarioHookContext } from "../shared/hooks";\n\nexport type ScenarioHookStateValues = {\n${stateEntries}\n};\nexport type ScenarioAppId = ${typeUnion(scenario.worker.apps.map((item) => item.id))};\nexport type ScenarioContentId = ${typeUnion([...scenario.worker.contents.map((item) => item.id), ...scenario.worker.talks.filter((item) => item.kind !== "search_agent" && item.initialState !== "normal").map((item) => item.id)])};\nexport type ScenarioIncomingCallId = ${typeUnion(scenario.worker.incomingCalls.map((item) => item.id))};\nexport type ScenarioTalkId = ${typeUnion(scenario.worker.talks.map((item) => item.id))};\nexport const SCENARIO_HOOK_TALK_BLOCKS = ${hookTalkBlocks} as const;\nexport type ScenarioTalkBlocksByTalk = {\n  [TalkId in keyof typeof SCENARIO_HOOK_TALK_BLOCKS]: (typeof SCENARIO_HOOK_TALK_BLOCKS)[TalkId][number];\n};\nexport type ScenarioTodoId = ${typeUnion(scenario.worker.todos.map((item) => item.id))};\nexport type ScenarioGenAudioId = ${typeUnion(scenario.worker.generatedAudio.map((item) => item.id))};\nexport type ProjectScenarioHookContext = ScenarioHookContext<\n  ScenarioHookStateValues,\n  ScenarioAppId,\n  ScenarioContentId,\n  ScenarioIncomingCallId,\n  ScenarioTalkId,\n  ScenarioTalkBlocksByTalk,\n  ScenarioTodoId,\n  ScenarioGenAudioId\n>;\n`
  );
  writeIfChanged(
    path.join(sharedGeneratedDir, "projectAppIds.generated.ts"),
    `// scenario:build により生成されます。直接編集しないでください。\nexport const PROJECT_APP_IDS = ${JSON.stringify(scenario.projectApps.map((app) => app.id))} as const;\nexport type ProjectAppId = (typeof PROJECT_APP_IDS)[number];\n`
  );
  const iconImports = [...new Set(scenario.projectApps.map((app) => app.icon))];
  writeIfChanged(
    path.join(clientGeneratedDir, "projectAppIcons.generated.ts"),
    `// scenario:build により生成されます。直接編集しないでください。\n${iconImports.length ? `import { ${iconImports.join(", ")} } from "@lucide/svelte";\n` : ""}export const projectAppIcons = { ${scenario.projectApps.map((app) => `${JSON.stringify(app.id)}: ${app.icon}`).join(", ")} } as const;\n`
  );
  writeIfChanged(
    path.join(sharedGeneratedDir, "scenarioHooks.generated.ts"),
    hooksModule
  );
  writeIfChanged(
    path.join(clientGeneratedDir, "demoDeviceState.generated.ts"),
    `// scenario:build により生成されます。直接編集しないでください。\nimport type { DeviceState } from "../scenario-runtime/types";\n\nexport const demoDeviceStateGenerated: DeviceState = ${JSON.stringify(scenario.deviceState, null, 2)};\n`
  );
  writeIfChanged(
    path.join(clientGeneratedDir, "demoProjectConstants.generated.ts"),
    `// scenario:build により生成されます。直接編集しないでください。\nexport const demoProjectConstantsGenerated = ${JSON.stringify(scenario.projectConstants, null, 2)} as const;\n`
  );
  console.log(`シナリオ生成OK: revision=${scenario.revision}`);
} catch (error) {
  console.error("シナリオ生成に失敗しました。");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
