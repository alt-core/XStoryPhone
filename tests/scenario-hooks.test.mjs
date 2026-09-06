import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { generatedHookImportPath, scenarioHookModulePath } from "../scripts/lib/scenario-hooks.mjs";

test("選択シナリオのhookだけを使い、旧配置のhookへ戻らない", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-scenario-hooks-"));
  try {
    const scenarioDir = path.join(temporaryRoot, "scenario/story");
    const generatedDir = path.join(temporaryRoot, "src/generated");
    fs.mkdirSync(scenarioDir, { recursive: true });
    fs.mkdirSync(generatedDir, { recursive: true });

    const fallback = path.join(temporaryRoot, "src/project/hooks.ts");
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.writeFileSync(fallback, "throw new Error('旧配置を読み込んではいけません');\n");
    assert.equal(scenarioHookModulePath(scenarioDir), null);

    const local = path.join(scenarioDir, "hooks.ts");
    fs.writeFileSync(local, "export const scenarioHookHandlers = {};\n");
    assert.equal(scenarioHookModulePath(scenarioDir), local);
    assert.equal(generatedHookImportPath(generatedDir, local), "../../scenario/story/hooks.ts");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("scenario buildは選択シナリオのhookを生成し、宣言の不足・余剰を拒否する", () => {
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
    assert.equal(fallbackResult.status, 1, "旧配置に実装があっても不足エラーになる");
    assert.match(fallbackResult.stderr, /registryがscenarioと一致しません。不足=/u);

    fs.writeFileSync(localHooks, `import { scenarioHookHandlers as handlers } from ${JSON.stringify(projectHookUrl)};\nexport const scenarioHookHandlers = { ...handlers, unexpected_hook() {} };\n`);
    const extraResult = spawnSync(process.execPath, [buildScript], {
      cwd: temporaryRoot,
      env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/demo" },
      encoding: "utf8"
    });
    assert.equal(extraResult.status, 1);
    assert.match(extraResult.stderr, /余分=unexpected_hook/u);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("hook未使用のシナリオはhooks.tsを省略でき、旧配置を読まない", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-without-hooks-"));
  try {
    const scenarioDir = path.join(temporaryRoot, "scenario/story");
    const authoringDir = path.join(scenarioDir, "authoring");
    fs.mkdirSync(authoringDir, { recursive: true });
    const { project } = JSON.parse(fs.readFileSync("scenario/demo/scenario.json", "utf8"));
    fs.writeFileSync(path.join(scenarioDir, "scenario.json"), JSON.stringify({
      schemaVersion: 1,
      playerMode: "browser",
      project,
      apps: [],
      notifications: [],
      talks: [{ id: "search_agent", kind: "search_agent", startSteps: ["intro"] }]
    }));
    fs.writeFileSync(path.join(authoringDir, "talk_blocks.tsv"), [
      "comment\tsender\tbody\tattachment\ttime\tdelay_ms\tnotes\tupdated_at\tsource\tquick_replies",
      "*search_agent",
      "intro",
      "\tsearch_agent\thookなしの検証用メッセージです。",
      ""
    ].join("\n"));
    fs.writeFileSync(path.join(authoringDir, "talk_flow.tsv"), [
      "comment\ttalk\tfrom\tcond\tintent\tcriteria\texample\tmatch\tnext\tmode\tset\tnotes",
      "\tsearch_agent\tintro\t\t\t\t\t\tintro\tstay",
      ""
    ].join("\n"));
    const oldHooks = path.join(temporaryRoot, "src/project/hooks.ts");
    fs.mkdirSync(path.dirname(oldHooks), { recursive: true });
    fs.writeFileSync(oldHooks, "throw new Error('旧配置を読み込んではいけません');\n");
    const result = spawnSync(process.execPath, [path.resolve("scripts/scenario-build.mjs")], {
      cwd: temporaryRoot,
      env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/story" },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const generated = await import(pathToFileURL(path.join(temporaryRoot, "src/generated/scenarioHooks.generated.ts")).href);
    assert.deepEqual(generated.scenarioHookHandlers, {});
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
