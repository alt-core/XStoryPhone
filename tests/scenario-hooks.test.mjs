import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildScenarioHooksModule } from "../scripts/lib/scenario-hooks.mjs";
import { loadScenarioAuthoring } from "../scripts/lib/scenario-authoring.mjs";

test("hook生成はセル本文をそのまま同期handlerへ包み、構文不正を拒否する", async () => {
  const module = buildScenarioHooksModule({ example: 'state.set("fixture", true);' });
  assert.match(module, /const \{ state, incoming/u);
  assert.match(module, /state\.set\("fixture", true\)/u);
  assert.throws(() => buildScenarioHooksModule({ broken: "if (" }), /構文が不正/u);
  const empty = buildScenarioHooksModule({});
  assert.match(empty, /scenarioHookHandlers.*= \{\s*\};/u);
});

test("scenario buildは選択したhooks.tsvから生成し、手書きhooks.tsを読まない", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-sheet-hooks-"));
  try {
    const dir = path.join(temporaryRoot, "scenario/story");
    fs.cpSync("scenario/demo", dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "hooks.ts"), "throw new Error('旧原本を実行してはいけません');\n");
    const script = path.resolve("scripts/scenario-build.mjs");
    const build = () => spawnSync(process.execPath, [script], {
      cwd: temporaryRoot, env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/story" }, encoding: "utf8"
    });
    const valid = build();
    assert.equal(valid.status, 0, valid.stderr);
    const generated = fs.readFileSync(path.join(temporaryRoot, "src/generated/scenarioHooks.generated.ts"), "utf8");
    assert.match(generated, /state\.set\("session_started", true\)/u);
    assert.doesNotMatch(generated, /export \{ scenarioHookHandlers \} from/u);
    const file = path.join(dir, "authoring/hooks.tsv");
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, original.replace("context.state.set", "await context.state.set"));
    const invalid = build();
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /同期script/u);
    assert.equal(fs.readFileSync(path.join(temporaryRoot, "src/generated/scenarioHooks.generated.ts"), "utf8"), generated);
  } finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
});

test("全hook原本は表のevent/target/cond/scriptで完結する", () => {
  const { source, hookScripts } = loadScenarioAuthoring("scenario/demo");
  assert.ok(source.hooks.length > 0);
  assert.deepEqual([...new Set(source.hooks.map(hook => hook.handler))].sort(), Object.keys(hookScripts).sort());
  assert.equal(fs.existsSync("scenario/demo/hooks.ts"), false);
  assert.equal(fs.existsSync("scenario/demo/scenario.json"), false);
});
