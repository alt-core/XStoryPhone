import { loadAndValidateScenario } from "./scenario-lib.mjs";

try {
  const scenario = loadAndValidateScenario();
  console.log(`シナリオ検証OK: revision=${scenario.revision}`);
} catch (error) {
  console.error("シナリオ検証に失敗しました。");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
