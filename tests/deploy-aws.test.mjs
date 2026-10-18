import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseAllowedOrigins } from "../src/server/cors.ts";

const scriptUrl = new URL("../scripts/deploy-aws.mjs", import.meta.url).href;
const source = readFileSync(new URL(scriptUrl), "utf8")
  .replace(/^import .+;\n/gmu, "")
  .replaceAll("import.meta.url", "scriptUrl");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction("spawnSync", "readFileSync", "createHash", "isDeepStrictEqual", "setTimeout",
  "fileURLToPath", "loadAndValidateScenario", "parseAllowedOrigins", "process", "console", "fetch", "AbortSignal", "scriptUrl", source);

const functionArn = "arn:aws:lambda:ap-northeast-1:123456789012:web-function/mock-api";
const endpointArn = `${functionArn}/endpoint/dev`;
const revision = "mock-client-revision";
const archiveBytes = Buffer.from("mock-private-api-archive");
const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
const ownStatement = {
  Sid: "AllowXStoryPhoneCloudFront", Effect: "Allow", Principal: { Service: "cloudfront.amazonaws.com" },
  Action: "lambda:InvokeWebFunctionEndpoint", Resource: endpointArn,
  Condition: { StringEquals: {
    "aws:SourceArn": "arn:aws:cloudfront::123456789012:distribution/mock-distribution", "aws:SourceAccount": "123456789012"
  } }
};

// すべての外部実行とhealth通信をstubし、配備スクリプトの実分岐だけを確認する。
async function deployment(arguments_, options = {}) {
  const calls = [];
  const health = [];
  const events = [];
  const sleeps = [];
  const logs = [];
  let exitCode = 0;
  let error;
  class Exit extends Error { constructor(code) { super("モックプロセス終了"); this.code = code; } }
  const outputs = options.outputs ?? {
    StaticBucketName: "mock-static-bucket", DistributionId: "mock-distribution",
    SiteUrl: "https://site.example", ApiEndpoint: "https://site.example/",
    FunctionArn: functionArn, EndpointArn: endpointArn
  };
  try {
    await execute((command, args, settings) => {
      calls.push({ command, args, settings });
      events.push({ command, args });
      if (options.failCommand?.(command, args)) return { status: 1, stderr: "モックコマンド失敗" };
      const custom = options.commandResult?.(command, args);
      if (custom) return custom;
      if (command !== "aws") return { status: 0, stdout: "" };
      const json = (body) => ({ status: 0, stdout: JSON.stringify(body) });
      if (args[0] === "cloudformation" && args[1] === "describe-stacks") {
        const name = args[args.indexOf("--stack-name") + 1];
        const values = name.endsWith("-artifacts") ? (options.artifactOutputs ?? { CodeBucketName: "mock-code-bucket" }) : outputs;
        return json(Object.entries(values).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })));
      }
      if (args[0] === "lambda-web") {
        if (args[1] === "get-web-account-settings" || args[1] === "put-resource-policy") return json({});
        if (args[1] === "get-resource-policy") return options.currentPolicy
          ? json({ policy: JSON.stringify(options.currentPolicy), revisionId: "mock-policy-revision" })
          : { status: 254, stderr: "An error occurred (ResourceNotFoundException) when calling the GetResourcePolicy operation: This function does not have a policy" };
      }
      if (args[0] === "s3api") {
        if (args[1] === "head-object") return options.existingCode
          ? json(options.existingCode)
          : { status: 254, stderr: "An error occurred (404) when calling the HeadObject operation: Not Found" };
        if (args[1] === "put-object") return json(options.uploadedCode ?? { VersionId: "mock-code-version" });
      }
      if (["cloudfront", "s3"].includes(args[0]) || (args[0] === "cloudformation" && args[1] === "deploy")) return json({});
      throw new Error(`想定外のAWS操作: ${args.slice(0, 2).join(" ")}`);
    }, (path) => {
      const filename = path instanceof URL ? fileURLToPath(path) : path;
      if (filename.endsWith("/manifest.json")) return JSON.stringify(options.manifest ?? { sha256: archiveSha256 });
      if (filename.endsWith("/api.zip")) return options.archiveBytes ?? archiveBytes;
      throw new Error(`想定外のファイル読取: ${filename}`);
    }, createHash, isDeepStrictEqual, async (ms) => { sleeps.push(ms); }, fileURLToPath, () => ({ worker: {
      playerMode: options.playerMode ?? "server", clientRevision: revision,
      project: { accessCode: options.accessCode ?? "none" }
    } }), parseAllowedOrigins, {
      argv: ["node", fileURLToPath(scriptUrl), ...arguments_],
      env: { ADMIN_REVIEW_SECRET: "mock-admin-secret", ...options.env },
      exit(code) { throw new Exit(code); }
    }, {
      error: (...values) => logs.push(values.join(" ")), log: (...values) => logs.push(values.join(" "))
    }, async (url) => {
      health.push(url);
      events.push({ health: url });
      const configured = options.healthResponses?.[health.length - 1];
      if (configured instanceof Error) throw configured;
      const response = configured ?? { ok: options.healthOk !== false, status: options.healthOk === false ? 503 : 200 };
      return { ...response, json: async () => response.body ?? { ok: true, clientRevision: revision } };
    }, { timeout: () => undefined }, scriptUrl);
  } catch (caught) {
    if (caught instanceof Exit) exitCode = caught.code;
    else { error = caught; exitCode = 1; }
  }
  return { calls, health, events, sleeps, logs, exitCode, error };
}

test("AWS API-onlyは静的公開を実行せず、private ZIP・Web Function・CloudFront healthを維持する", async () => {
  const result = await deployment(["prod", "--api-only"], {
    env: { ALLOWED_ORIGINS: "https://one.example/, https://two.example,https://one.example" }
  });
  assert.equal(result.exitCode, 0, result.error?.stack);
  assert.deepEqual(result.calls.map(({ command, args }) => [command, ...args.slice(0, 2)]), [
    ["aws", "lambda-web", "get-web-account-settings"],
    ["npm", "run", "audit:public"], ["npm", "run", "scenario:build"],
    ["npm", "run", "audit:aws:scenario"], ["npm", "run", "audit:client"],
    ["node", "scripts/build-aws-api.mjs"], ["aws", "cloudformation", "deploy"],
    ["aws", "cloudformation", "describe-stacks"], ["aws", "s3api", "head-object"], ["aws", "s3api", "put-object"],
    ["sam", "deploy", "--no-confirm-changeset"], ["aws", "cloudformation", "describe-stacks"],
    ["aws", "lambda-web", "get-resource-policy"], ["aws", "lambda-web", "put-resource-policy"],
    ["aws", "cloudfront", "wait"]
  ]);
  const parameters = result.calls.find(({ command, args }) => command === "sam" && args[0] === "deploy").args;
  assert.ok(parameters.includes('AllowedOrigins="https://one.example,https://two.example"'));
  assert.ok(parameters.includes("EnvironmentName=prod"));
  assert.ok(parameters.includes("CodeBucketName=mock-code-bucket"));
  assert.ok(parameters.includes(`CodeObjectKey=releases/${archiveSha256}.zip`));
  assert.ok(parameters.includes("CodeObjectVersion=mock-code-version"));
  assert.ok(parameters.includes("MaxEnvironments=2"));
  assert.ok(parameters.includes("MaxConcurrencyPerEnvironment=5"));
  assert.equal(parameters[parameters.indexOf("--s3-bucket") + 1], "mock-code-bucket");
  assert.equal(parameters[parameters.indexOf("--s3-prefix") + 1], "cloudformation/xstoryphone-prod");
  assert.equal(parameters[parameters.indexOf("--template-file") + 1], "infra/aws/template.yaml");
  assert.ok(!result.calls.some(({ args }) => args.includes("build:aws") || args.includes("sync") || args.includes("create-invalidation")));
  assert.ok(!result.calls.some(({ command, args }) => command === "sam" && ["build", "package"].includes(args[0])));
  assert.deepEqual(result.health, ["https://site.example/api/health"]);
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

test("通常AWS公開はAPI health成功後だけS3同期し、invalidation後もCloudFront healthを確認する", async () => {
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
    assert.deepEqual(result.health, ["https://site.example/api/health", "https://site.example/api/health"]);
    const firstHealth = result.events.findIndex(event => event.health);
    const firstSync = result.events.findIndex(event => event.command === "aws" && event.args.includes("sync"));
    const invalidation = result.events.findIndex(event => event.command === "aws" && event.args.includes("create-invalidation"));
    assert.ok(firstHealth < firstSync);
    assert.ok(invalidation < result.events.findLastIndex(event => event.health));
  }
});

test("AWS配備は未知引数と無効originを処理開始前に拒否する", async () => {
  for (const arguments_ of [[], ["unknown"], ["constructor"], ["prod", "--api-onyl"], ["dev", "--api-only", "--api-only"],
    ["dev", "--no-execute-changeset", "--no-execute-changeset"], ["prod", "extra"]]) {
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
  for (const failing of ["audit:aws:scenario", "audit:client", "scripts/build-aws-api.mjs", "deploy"]) {
    const result = await deployment(["dev", "--api-only"], {
      failCommand: (command, args) => args.includes(failing) && (failing !== "deploy" || command === "sam")
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.health, []);
    assert.ok(!result.calls.some(({ args }) => args.includes("sync") || args.includes("create-invalidation")));
  }
  const unhealthy = await deployment(["dev", "--api-only"], { healthOk: false });
  assert.equal(unhealthy.exitCode, 1);
  assert.equal(unhealthy.health.length, 5);
  assert.deepEqual(unhealthy.sleeps, [2_000, 2_000, 2_000, 2_000]);
  const missingEndpoint = await deployment(["dev", "--api-only"], { outputs: { SiteUrl: "https://site.example" } });
  assert.equal(missingEndpoint.exitCode, 1);
  assert.deepEqual(missingEndpoint.health, []);
});

test("AWS CLI非対応・認証失敗はbuildより前に止まり、すべてのAWS操作は東京へ固定する", async () => {
  const failed = await deployment(["dev"], {
    commandResult: (_command, args) => args.includes("get-web-account-settings")
      ? { status: 254, stderr: "AccessDeniedException: not authorized" } : undefined
  });
  assert.equal(failed.exitCode, 254);
  assert.equal(failed.calls.length, 1);
  assert.deepEqual(failed.health, []);
  assert.ok(failed.logs.some(line => line.includes("AccessDeniedException")));
  const accepted = await deployment(["dev", "--api-only"]);
  assert.equal(accepted.exitCode, 0, accepted.error?.stack);
  for (const { command, args } of accepted.calls) {
    if (command !== "aws" && command !== "sam") continue;
    assert.equal(args[args.indexOf("--region") + 1], "ap-northeast-1");
    assert.ok(!args.includes("--profile"));
  }
});

test("同じZIPは既存VersionIdを再利用し、S3不在404の場合だけ新規uploadする", async () => {
  const reused = await deployment(["stg", "--api-only"], { existingCode: { VersionId: "existing-code-version" } });
  assert.equal(reused.exitCode, 0, reused.error?.stack);
  assert.ok(!reused.calls.some(({ args }) => args[0] === "s3api" && args[1] === "put-object"));
  const sam = reused.calls.find(({ command }) => command === "sam");
  assert.ok(sam.args.includes("CodeObjectVersion=existing-code-version"));

  for (const stderr of [
    "An error occurred (403) when calling the HeadObject operation: Forbidden",
    "Could not connect to the endpoint URL",
    "The security token included in the request is invalid"
  ]) {
    const denied = await deployment(["dev", "--api-only"], {
      commandResult: (_command, args) => args[0] === "s3api" && args[1] === "head-object"
        ? { status: 254, stderr } : undefined
    });
    assert.equal(denied.exitCode, 254);
    assert.ok(!denied.calls.some(({ command, args }) => command === "sam" || args[1] === "put-object"));
    assert.deepEqual(denied.health, []);
  }
});

test("不正なmanifest・ZIP hash・VersionIdではmainを配備しない", async () => {
  for (const options of [
    { manifest: { sha256: "not-a-sha256" } },
    { archiveBytes: Buffer.from("different-archive") },
    { existingCode: { VersionId: "null" } },
    { existingCode: {} },
    { uploadedCode: {} }
  ]) {
    const result = await deployment(["dev", "--api-only"], options);
    assert.equal(result.exitCode, 1, result.error?.stack);
    assert.ok(!result.calls.some(({ command }) => command === "sam"));
    assert.deepEqual(result.health, []);
    if (options.manifest || options.archiveBytes) {
      assert.ok(!result.calls.some(({ command, args }) => command === "aws" && args[1] === "deploy"));
    }
  }
});

test("Web Functionのpolicyは他statementを保ち、既存revisionIdで自分のstatementだけを更新する", async () => {
  const other = { Sid: "OtherCaller", Effect: "Allow", Principal: { AWS: "arn:aws:iam::123456789012:root" }, Action: "lambda:GetWebFunction", Resource: functionArn };
  for (const Statement of [other, [other, { ...ownStatement, Resource: `${functionArn}/endpoint/old` }]]) {
    const result = await deployment(["dev", "--api-only"], { currentPolicy: { Version: "2012-10-17", Id: "original-policy", Statement } });
    assert.equal(result.exitCode, 0, result.error?.stack);
    const put = result.calls.find(({ args }) => args[1] === "put-resource-policy");
    assert.ok(put);
    assert.equal(put.args[put.args.indexOf("--revision-id") + 1], "mock-policy-revision");
    const policy = JSON.parse(put.args[put.args.indexOf("--policy") + 1]);
    assert.equal(policy.Id, "original-policy");
    assert.deepEqual(policy.Statement, [other, ownStatement]);
  }
  const unchanged = await deployment(["dev", "--api-only"], { currentPolicy: { Version: "2012-10-17", Statement: [other, ownStatement] } });
  assert.equal(unchanged.exitCode, 0, unchanged.error?.stack);
  assert.ok(!unchanged.calls.some(({ args }) => args[1] === "put-resource-policy"));
  const created = await deployment(["dev", "--api-only"]);
  const put = created.calls.find(({ args }) => args[1] === "put-resource-policy");
  assert.ok(!put.args.includes("--revision-id"));
  assert.deepEqual(JSON.parse(put.args[put.args.indexOf("--policy") + 1]), { Version: "2012-10-17", Statement: [ownStatement] });
});

test("policy取得失敗をpolicy不在と取り違えず、競合は再取得・無条件上書きで通さない", async () => {
  for (const stderr of [
    "An error occurred (AccessDeniedException) when calling the GetResourcePolicy operation: not authorized",
    "An error occurred (ResourceNotFoundException) when calling the GetResourcePolicy operation: The function does not exist",
    "Could not connect to the endpoint URL"
  ]) {
    const result = await deployment(["dev", "--api-only"], {
      commandResult: (_command, args) => args[1] === "get-resource-policy" ? { status: 254, stderr } : undefined
    });
    assert.equal(result.exitCode, 254);
    assert.ok(!result.calls.some(({ args }) => args[1] === "put-resource-policy" || args[1] === "wait"));
    assert.deepEqual(result.health, []);
  }
  const conflict = await deployment(["dev", "--api-only"], {
    currentPolicy: { Version: "2012-10-17", Statement: [] },
    commandResult: (_command, args) => args[1] === "put-resource-policy"
      ? { status: 254, stderr: "PreconditionFailedException: revision mismatch" } : undefined
  });
  assert.equal(conflict.exitCode, 254);
  assert.equal(conflict.calls.filter(({ args }) => args[1] === "get-resource-policy").length, 1);
  assert.equal(conflict.calls.filter(({ args }) => args[1] === "put-resource-policy").length, 1);
  assert.deepEqual(conflict.health, []);
});

test("未実行の変更セット作成はmain SAMの後で止まり、policy・health・静的公開を進めない", async () => {
  for (const arguments_ of [["dev", "--no-execute-changeset"], ["dev", "--api-only", "--no-execute-changeset"]]) {
    const result = await deployment(arguments_);
    assert.equal(result.exitCode, 0, result.error?.stack);
    const last = result.calls.at(-1);
    assert.equal(last.command, "sam");
    assert.ok(last.args.includes("--no-execute-changeset"));
    assert.deepEqual(result.health, []);
    assert.ok(!result.calls.some(({ args }) => ["get-resource-policy", "put-resource-policy", "sync", "create-invalidation"].includes(args[1])));
    assert.equal(result.calls.filter(({ args }) => args[1] === "describe-stacks").length, 1);
  }
});

test("各配備段階の失敗は後続操作と静的同期へ進まない", async () => {
  for (const [command, first, second] of [
    ["npm", "run", "audit:public"],
    ["npm", "run", "build:aws"],
    ["npm", "run", "audit:client:aws"],
    ["node", "scripts/build-aws-api.mjs", undefined],
    ["aws", "cloudformation", "deploy"],
    ["aws", "cloudformation", "describe-stacks"],
    ["aws", "s3api", "put-object"],
    ["sam", "deploy", "--no-confirm-changeset"],
    ["aws", "lambda-web", "put-resource-policy"],
    ["aws", "cloudfront", "wait"]
  ]) {
    const result = await deployment(["dev"], {
      failCommand: (current, args) => current === command && args[0] === first && args[1] === second
    });
    assert.equal(result.exitCode, 1, `${command} ${first} ${second}`);
    const last = result.calls.at(-1);
    assert.equal(last.command, command);
    assert.deepEqual(last.args.slice(0, 2), second === undefined ? [first] : [first, second]);
    assert.deepEqual(result.health, []);
    assert.ok(!result.calls.some(({ args }) => args.includes("sync") || args.includes("create-invalidation")));
  }
});

test("CloudFront healthは期待revisionまで有限回だけ待ち、不一致のままなら静的同期しない", async () => {
  const recovered = await deployment(["dev", "--api-only"], {
    healthResponses: [new Error("network"), { ok: true, status: 200, body: { ok: true, clientRevision: "old" } }]
  });
  assert.equal(recovered.exitCode, 0, recovered.error?.stack);
  assert.equal(recovered.health.length, 3);
  assert.deepEqual(recovered.sleeps, [2_000, 2_000]);
  assert.deepEqual(new Set(recovered.health), new Set(["https://site.example/api/health"]));
  const failed = await deployment(["dev"], {
    healthResponses: Array.from({ length: 5 }, () => ({ ok: true, status: 200, body: { ok: true, clientRevision: "old" } }))
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.health.length, 5);
  assert.ok(!failed.calls.some(({ args }) => args.includes("sync") || args.includes("create-invalidation")));
});

test("code bucketとmainの必須output不足は後続の配備・policy操作を止める", async () => {
  const missingBucket = await deployment(["dev", "--api-only"], { artifactOutputs: {} });
  assert.equal(missingBucket.exitCode, 1);
  assert.ok(!missingBucket.calls.some(({ command, args }) => command === "sam" || args[0] === "s3api"));
  for (const missing of ["FunctionArn", "EndpointArn", "DistributionId", "ApiEndpoint", "StaticBucketName"]) {
    const outputs = { StaticBucketName: "mock-static-bucket", DistributionId: "mock-distribution", ApiEndpoint: "https://site.example", FunctionArn: functionArn, EndpointArn: endpointArn };
    delete outputs[missing];
    const result = await deployment(["dev"], { outputs });
    assert.equal(result.exitCode, 1, missing);
    assert.ok(!result.calls.some(({ args }) => args[1] === "get-resource-policy" || args[1] === "sync"));
    assert.deepEqual(result.health, []);
  }
});

test("静的同期・invalidation失敗後に最終healthや成功表示を行わない", async () => {
  for (const failingSync of [1, 2]) {
    let sync = 0;
    const result = await deployment(["dev"], {
      failCommand: (command, args) => command === "aws" && args[0] === "s3" && args[1] === "sync" && ++sync === failingSync
    });
    assert.equal(result.exitCode, 1);
    assert.equal(sync, failingSync);
    assert.equal(result.health.length, 1);
    assert.ok(!result.calls.some(({ args }) => args.includes("create-invalidation")));
    assert.ok(!result.logs.some(line => line.includes("公開が完了しました")));
  }
  const invalidation = await deployment(["dev"], {
    failCommand: (command, args) => command === "aws" && args.includes("create-invalidation")
  });
  assert.equal(invalidation.exitCode, 1);
  assert.equal(invalidation.health.length, 1);
  assert.ok(!invalidation.logs.some(line => line.includes("公開が完了しました")));
});

test("staticモードと必須secret欠落はAWSを操作しない", async () => {
  for (const options of [
    { playerMode: "static" },
    { env: { ADMIN_REVIEW_SECRET: "" } },
    { playerMode: "browser" }
  ]) {
    const result = await deployment(["dev", "--api-only"], options);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.health, []);
  }
});

test("mainのoutput取得失敗はpolicy変更より前に停止する", async () => {
  const result = await deployment(["dev", "--api-only"], {
    commandResult: (_command, args) => args[0] === "cloudformation" && args[1] === "describe-stacks" && args.includes("xstoryphone-dev")
      ? { status: 254, stderr: "AccessDenied: describe stack" } : undefined
  });
  assert.equal(result.exitCode, 254);
  assert.ok(result.calls.some(({ command }) => command === "sam"));
  assert.ok(!result.calls.some(({ args }) => args[1] === "get-resource-policy"));
  assert.deepEqual(result.health, []);
});
