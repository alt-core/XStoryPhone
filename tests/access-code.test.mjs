import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { accessCodeCheckDigits } from "../src/server/accessCode.ts";

const script = fileURLToPath(new URL("../scripts/generate-access-code.mjs", import.meta.url));
const secret = "access-code-test-secret";

function generate(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ACCESS_CODE_SECRET: secret }
  });
}

test("アクセスコード発行は1〜4桁の連番を4桁へ補完する", async () => {
  const result = generate(["7"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `${await accessCodeCheckDigits("0007", secret)}0007`);
});

test("アクセスコード発行は範囲を指定して連続出力できる", async () => {
  const result = generate(["--from", "9998", "--count", "2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    `${await accessCodeCheckDigits("9998", secret)}9998`,
    `${await accessCodeCheckDigits("9999", secret)}9999`
  ]);

  const overflow = generate(["--from", "9999", "--count", "2"]);
  assert.equal(overflow.status, 1);
  assert.match(overflow.stderr, /9999を超えない/u);
});
