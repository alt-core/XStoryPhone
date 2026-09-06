import fs from "node:fs";
import path from "node:path";

export function scenarioHookModulePath(scenarioDir) {
  const localHooks = path.join(scenarioDir, "hooks.ts");
  return fs.existsSync(localHooks) ? localHooks : null;
}

export function generatedHookImportPath(generatedDir, hookModulePath) {
  const relative = path.relative(generatedDir, hookModulePath).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
