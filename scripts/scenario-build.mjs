import fs from "node:fs";
import path from "node:path";
import { loadAndValidateScenario } from "./scenario-lib.mjs";

const rootDir = process.cwd();
const sharedGeneratedDir = path.join(rootDir, "src/generated");
const clientGeneratedDir = path.join(rootDir, "src/client/generated");

function writeIfChanged(filePath, content) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (current !== content) fs.writeFileSync(filePath, content);
}

try {
  const scenario = loadAndValidateScenario();
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
