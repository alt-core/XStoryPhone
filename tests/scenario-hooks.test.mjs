import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { generatedHookImportPath, scenarioHookModulePath } from "../scripts/lib/scenario-hooks.mjs";

test("シナリオ固有hookを優先し、無い場合だけproject hookへ戻る", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-scenario-hooks-"));
  try {
    const scenarioDir = path.join(temporaryRoot, "scenario/story");
    const generatedDir = path.join(temporaryRoot, "src/generated");
    fs.mkdirSync(scenarioDir, { recursive: true });
    fs.mkdirSync(generatedDir, { recursive: true });

    const fallback = path.join(temporaryRoot, "src/project/hooks.ts");
    assert.equal(scenarioHookModulePath(temporaryRoot, scenarioDir), fallback);

    const local = path.join(scenarioDir, "hooks.ts");
    fs.writeFileSync(local, "export const scenarioHookHandlers = {};\n");
    assert.equal(scenarioHookModulePath(temporaryRoot, scenarioDir), local);
    assert.equal(generatedHookImportPath(generatedDir, local), "../../scenario/story/hooks.ts");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("scenario buildは選択シナリオと同じhook moduleを生成する", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-scenario-hook-build-"));
  try {
    fs.cpSync("scenario", path.join(temporaryRoot, "scenario"), { recursive: true });
    const scenarioDir = path.join(temporaryRoot, "scenario/demo");
    const projectHookUrl = pathToFileURL(path.resolve("scenario/demo/hooks.ts")).href;
    const localHooks = path.join(scenarioDir, "hooks.ts");
    fs.writeFileSync(localHooks, `export { scenarioHookHandlers } from ${JSON.stringify(projectHookUrl)};\n`);

    const buildScript = path.resolve("scripts/scenario-build.mjs");
    const localResult = spawnSync(process.execPath, [buildScript], {
      cwd: temporaryRoot,
      env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/demo" },
      encoding: "utf8"
    });
    assert.equal(localResult.status, 0, localResult.stderr);
    assert.match(
      fs.readFileSync(path.join(temporaryRoot, "src/generated/scenarioHooks.generated.ts"), "utf8"),
      /\.\.\/\.\.\/scenario\/demo\/hooks\.ts/u
    );

    fs.rmSync(localHooks);
    const fallbackHooks = path.join(temporaryRoot, "src/project/hooks.ts");
    fs.mkdirSync(path.dirname(fallbackHooks), { recursive: true });
    fs.writeFileSync(fallbackHooks, `export { scenarioHookHandlers } from ${JSON.stringify(projectHookUrl)};\n`);
    const fallbackResult = spawnSync(process.execPath, [buildScript], {
      cwd: temporaryRoot,
      env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/demo" },
      encoding: "utf8"
    });
    assert.equal(fallbackResult.status, 0, fallbackResult.stderr);
    assert.match(
      fs.readFileSync(path.join(temporaryRoot, "src/generated/scenarioHooks.generated.ts"), "utf8"),
      /\.\.\/project\/hooks\.ts/u
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
