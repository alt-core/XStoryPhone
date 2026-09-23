import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const run = args => spawnSync(process.execPath, ["scripts/scenario-llm-talk-flow-examples-test.mjs", "--dry-run", ...args], {
  env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/demo" }, encoding: "utf8"
});
test("制作テストのcond上限は正の整数だけを受け付ける", () => {
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "1e2", "9007199254740992"]) {
    const result = run([`--cond-pattern-limit=${value}`]);
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /cond-pattern-limit/u);
  }
  assert.notEqual(run(["--cond-pattern-limit"]).status, 0);
  const accepted = run(["--cond-pattern-limit=40"]);
  assert.equal(accepted.status, 0, accepted.stderr);
});
