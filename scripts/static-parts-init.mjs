import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { staticPartLocators } from "./lib/static-scenario.mjs";

try {
  if (process.argv.length > 2) throw new Error("引数はありません。XSTORYPHONE_SCENARIO_DIR、またはpackage.jsonのxstoryphone.scenarioDirで作品を選択してください。");
  const { worker } = loadAndValidateScenario();
  staticPartLocators(process.cwd(), worker.project.id, worker.parts ?? ["base"], true);
  console.log("staticの取得先を初期化しました。.secrets/static-parts.jsonを非公開でバックアップしてください。");
} catch (error) { console.error(error.message); process.exitCode = 1; }
