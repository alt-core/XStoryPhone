import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseAllowedOrigins } from "../src/server/cors.ts";

const scriptUrl = new URL("../scripts/deploy-aws.mjs", import.meta.url).href;
const source = readFileSync(new URL(scriptUrl), "utf8")
  .replace(/^import .+;\n/gmu, "")
  .replaceAll("import.meta.url", "scriptUrl");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction("spawnSync", "fileURLToPath", "loadAndValidateScenario", "parseAllowedOrigins",
  "process", "console", "fetch", "AbortSignal", "scriptUrl", source);

// すべての外部実行とhealth通信をstubし、配備スクリプトの実分岐だけを確認する。
async function deployment(arguments_, options = {}) {
  const calls = [];
  const health = [];
  const logs = [];
  let exitCode = 0;
  let error;
  class Exit extends Error { constructor(code) { super("モックプロセス終了"); this.code = code; } }
  const outputs = options.outputs ?? {
    StaticBucketName: "mock-static-bucket", DistributionId: "mock-distribution",
    SiteUrl: "https://site.example", ApiEndpoint: "https://api.example/"
  };
  try {
    await execute((command, args, settings) => {
      calls.push({ command, args, settings });
      return {
        status: options.failCommand?.(command, args) ? 1 : 0,
        stdout: JSON.stringify(Object.entries(outputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })))
      };
    }, fileURLToPath, () => ({ worker: { playerMode: options.playerMode ?? "server", project: { accessCode: options.accessCode ?? "none" } } }), parseAllowedOrigins, {
      argv: ["node", fileURLToPath(scriptUrl), ...arguments_],
      env: { ADMIN_REVIEW_SECRET: "mock-admin-secret", ...options.env },
      exit(code) { throw new Exit(code); }
    }, {
      error: (...values) => logs.push(values.join(" ")), log: (...values) => logs.push(values.join(" "))
    }, async (url) => {
      health.push(url);
      return { ok: options.healthOk !== false, status: options.healthOk === false ? 503 : 200 };
    }, { timeout: () => undefined }, scriptUrl);
  } catch (caught) {
    if (caught instanceof Exit) exitCode = caught.code;
    else { error = caught; exitCode = 1; }
  }
  return { calls, health, logs, exitCode, error };
}

test("AWS API-onlyは静的公開を実行せず、シナリオ監査・source境界・SAM・API healthを維持する", async () => {
  const result = await deployment(["prod", "--api-only"], {
    outputs: { ApiEndpoint: "https://api.example/" },
    env: { ALLOWED_ORIGINS: "https://one.example/, https://two.example,https://one.example" }
  });
  assert.equal(result.exitCode, 0, result.error?.stack);
  assert.deepEqual(result.calls.map(({ command, args }) => [command, ...args.slice(0, 2)]), [
    ["npm", "run", "audit:public"], ["npm", "run", "scenario:build"],
    ["npm", "run", "audit:aws:scenario"], ["npm", "run", "audit:client"],
    ["sam", "build", "--template-file"], ["sam", "deploy", "--no-confirm-changeset"],
    ["aws", "cloudformation", "describe-stacks"]
  ]);
  const parameters = result.calls.find(({ command, args }) => command === "sam" && args[0] === "deploy").args;
  assert.ok(parameters.includes('AllowedOrigins="https://one.example,https://two.example"'));
  assert.ok(parameters.includes("EnvironmentName=prod"));
  assert.ok(!result.calls.some(({ args }) => args.includes("build:aws") || args.includes("sync") || args.includes("create-invalidation")));
  assert.deepEqual(result.health, ["https://api.example/api/health"]);
});

test("AWSの任意接頭辞は全環境のstackとparameterへ渡り、未指定なら標準名を保つ", async () => {
  for (const environment of ["dev", "stg", "prod"]) for (const prefix of [undefined, "my-story", "a".repeat(24)]) {
    const env = prefix === undefined ? {} : { XSTORYPHONE_PROJECT_NAME: prefix };
    const result = await deployment([environment, "--api-only"], { env });
    assert.equal(result.exitCode, 0, result.logs.join("\n"));
    const deploy = result.calls.find(call => call.command === "sam" && call.args[0] === "deploy").args;
    assert.equal(deploy[deploy.indexOf("--stack-name") + 1], `${prefix ?? "xstoryphone"}-${environment}`);
    assert.ok(deploy.includes(`ProjectName=${prefix ?? "xstoryphone"}`));
    assert.ok(`${prefix ?? "xstoryphone"}-${environment}-123456789012-ap-northeast-1`.length <= 63);
  }
  for (const value of ["", "UPPER", "bad_name", "a".repeat(25), "xn--reserved"]) {
    const result = await deployment(["dev"], { env: { XSTORYPHONE_PROJECT_NAME: value } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, 0);
  }
});

test("WAFは未指定ならparameterを省き、空文字では明示解除する", async () => {
  const arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/example/11111111-2222-3333-4444-555555555555";
  for (const value of [undefined, "", arn]) {
    const result = await deployment(["dev", "--api-only"], { env: value === undefined ? {} : { WEB_ACL_ARN: value } });
    assert.equal(result.exitCode, 0);
    const parameters = result.calls.find(call => call.command === "sam" && call.args[0] === "deploy").args.filter(arg => arg.startsWith("WebAclArn="));
    assert.deepEqual(parameters, value === undefined ? [] : [`WebAclArn="${value}"`]);
  }
  const invalid = await deployment(["dev"], { env: { WEB_ACL_ARN: arn.replace("us-east-1", "ap-northeast-1") } });
  assert.equal(invalid.exitCode, 1);
  assert.equal(invalid.calls.length, 0);
});

test("browserのコード必須設定では署名鍵に加えてコード秘密値も配備前に要求する", async () => {
  const missing = await deployment(["dev", "--api-only"], { playerMode: "browser", accessCode: "required", env: { BROWSER_STATE_SECRET: "fixture" } });
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.calls.length, 0);
  assert.ok(missing.logs.some(line => line.includes("ACCESS_CODE_SECRET")));
  const accepted = await deployment(["dev", "--api-only"], { playerMode: "browser", accessCode: "required", env: { BROWSER_STATE_SECRET: "fixture", ACCESS_CODE_SECRET: "fixture-code" } });
  assert.equal(accepted.exitCode, 0);
});

test("既存AWS公開はclient build・監査・S3同期・invalidation・SiteUrl healthを維持する", async () => {
  for (const environment of ["dev", "stg", "prod"]) {
    const result = await deployment([environment]);
    assert.equal(result.exitCode, 0, result.error?.stack);
    const build = result.calls.find(({ args }) => args.includes("build:aws"));
    assert.equal(build.settings.env.VITE_XSTORYPHONE_RESET_FOR_TESTING, environment === "prod" ? "false" : "true");
    assert.ok(result.calls.some(({ args }) => args.includes("audit:client:aws")));
    assert.equal(result.calls.filter(({ command, args }) => command === "aws" && args[0] === "s3" && args[1] === "sync").length, 2);
    assert.ok(result.calls.some(({ args }) => args.includes("create-invalidation")));
    const parameters = result.calls.find(({ command, args }) => command === "sam" && args[0] === "deploy").args;
    assert.ok(parameters.includes('AllowedOrigins=""'));
    assert.deepEqual(result.health, ["https://site.example/api/health"]);
  }
});

test("AWS配備は未知引数と無効originを処理開始前に拒否する", async () => {
  for (const arguments_ of [[], ["unknown"], ["constructor"], ["prod", "--api-onyl"], ["dev", "--api-only", "--api-only"], ["prod", "extra"]]) {
    const result = await deployment(arguments_);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.health, []);
  }
  for (const origin of ["*", "null", "https://host.example/game/", "https://host.example,,https://other.example"]) {
    const result = await deployment(["dev", "--api-only"], { env: { ALLOWED_ORIGINS: origin } });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.health, []);
  }
});

test("AWS API-onlyでも署名鍵不足・監査失敗・SAM失敗・health失敗を成功扱いしない", async () => {
  const missingSecret = await deployment(["dev", "--api-only"], { playerMode: "browser" });
  assert.equal(missingSecret.exitCode, 1);
  assert.deepEqual(missingSecret.calls, []);
  for (const failing of ["audit:aws:scenario", "audit:client", "build", "deploy"]) {
    const result = await deployment(["dev", "--api-only"], {
      failCommand: (command, args) => args.includes(failing) && (failing.startsWith("audit:") || command === "sam")
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.health, []);
    assert.ok(!result.calls.some(({ command }) => command === "aws"));
  }
  const unhealthy = await deployment(["dev", "--api-only"], { healthOk: false });
  assert.equal(unhealthy.exitCode, 1);
  const missingEndpoint = await deployment(["dev", "--api-only"], { outputs: { SiteUrl: "https://site.example" } });
  assert.equal(missingEndpoint.exitCode, 1);
  assert.deepEqual(missingEndpoint.health, []);
});
