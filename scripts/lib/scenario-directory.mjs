import fs from "node:fs";
import path from "node:path";

// build、制作ツール、Sheets同期が必ず同じ作品を選ぶ。明示設定の誤りでdemoへ戻さない。
export function selectedScenarioDir(rootDir = process.cwd(), environment = process.env) {
  const override = environment.XSTORYPHONE_SCENARIO_DIR?.trim();
  if (override) return path.resolve(rootDir, override);
  const packagePath = path.join(rootDir, "package.json");
  const configured = fs.existsSync(packagePath)
    ? JSON.parse(fs.readFileSync(packagePath, "utf8")).xstoryphone?.scenarioDir
    : undefined;
  if (configured !== undefined && (typeof configured !== "string" || !configured.trim())) {
    throw new Error("package.jsonのxstoryphone.scenarioDirは空でないパス文字列にしてください。");
  }
  return path.resolve(rootDir, configured?.trim() ?? "scenario/demo");
}
