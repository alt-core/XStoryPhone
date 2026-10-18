import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { parseAllowedOrigins } from "../src/server/cors.ts";

const environments = {
  dev: { maxEnvironments: "2", maxConcurrencyPerEnvironment: "2", logDays: "7" },
  stg: { maxEnvironments: "2", maxConcurrencyPerEnvironment: "2", logDays: "14" },
  prod: { maxEnvironments: "2", maxConcurrencyPerEnvironment: "5", logDays: "14" }
};
const environment = process.argv[2];
const options = process.argv.slice(3);
if (options.some((option) => !["--api-only", "--no-execute-changeset"].includes(option)) || new Set(options).size !== options.length) {
  console.error("未知または重複した引数です。環境の後には --api-only、--no-execute-changeset を指定できます。");
  process.exit(1);
}
const apiOnly = options.includes("--api-only");
const prepareOnly = options.includes("--no-execute-changeset");
const region = "ap-northeast-1";
const settings = Object.hasOwn(environments, environment) ? environments[environment] : undefined;
if (!settings) {
  console.error("環境はdev、stg、prodのいずれかを指定してください。");
  process.exit(1);
}
const resetForTesting = environment === "prod" ? "false" : "true";
const projectName = process.env.XSTORYPHONE_PROJECT_NAME ?? "xstoryphone";
if (!/^[a-z][a-z0-9-]{0,23}$/u.test(projectName) || /^(xn--|sthree-|amzn-s3-demo-)/u.test(projectName)) {
  console.error("XSTORYPHONE_PROJECT_NAMEは英小文字で始まる小文字英数字・ハイフンの1〜24文字を指定してください。S3の予約prefixは使えません。");
  process.exit(1);
}
const stackName = `${projectName}-${environment}`;
const webAclArn = process.env.WEB_ACL_ARN;
if (webAclArn !== undefined && webAclArn !== "" && !/^arn:aws(?:-[a-z]+)*:wafv2:us-east-1:\d{12}:global\/webacl\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+$/u.test(webAclArn)) {
  console.error("WEB_ACL_ARNはus-east-1のCloudFront用WebACL ARN、または解除するための空文字を指定してください。");
  process.exit(1);
}
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS).join(",");

const selectedScenario = loadAndValidateScenario().worker;
if (selectedScenario.playerMode === "static") {
  console.error("staticモードは npm run build:static で作り、dist/staticを静的ホストへ配置してください。APIはデプロイしません。");
  process.exit(1);
}

const adminReviewSecret = process.env.ADMIN_REVIEW_SECRET?.trim();
if (!adminReviewSecret) {
  console.error("ADMIN_REVIEW_SECRETを環境変数へ設定してください。");
  process.exit(1);
}
const playerInputLogging = process.env.PLAYER_INPUT_LOGGING === "true" ? "true" : "false";
const browserStateSecret = process.env.BROWSER_STATE_SECRET?.trim();
const accessCodeSecret = process.env.ACCESS_CODE_SECRET?.trim();
if (selectedScenario.playerMode === "browser" && !browserStateSecret) {
  console.error("browserモードではBROWSER_STATE_SECRETを環境変数へ設定してください。");
  process.exit(1);
}
if (selectedScenario.playerMode === "browser" && selectedScenario.project?.accessCode === "required" && !accessCodeSecret) {
  console.error("アクセスコード必須のbrowserモードではACCESS_CODE_SECRETを設定してください。");
  process.exit(1);
}
const llmParameterOverrides = [
  ["LlmApiKey", "LLM_API_KEY"],
  ["LlmModel", "LLM_MODEL"],
  ["LlmBaseUrl", "LLM_BASE_URL"],
  ["LlmTimeoutMs", "LLM_TIMEOUT_MS"],
  ["LlmReasoningEffort", "LLM_REASONING_EFFORT"],
  ["LlmProfileFastModel", "LLM_PROFILE_FAST_MODEL"],
  ["LlmProfileFastReasoningEffort", "LLM_PROFILE_FAST_REASONING_EFFORT"],
  ["LlmProfileFastTimeoutMs", "LLM_PROFILE_FAST_TIMEOUT_MS"],
  ["LlmProfileSuperModel", "LLM_PROFILE_SUPER_MODEL"],
  ["LlmProfileSuperReasoningEffort", "LLM_PROFILE_SUPER_REASONING_EFFORT"],
  ["LlmProfileSuperTimeoutMs", "LLM_PROFILE_SUPER_TIMEOUT_MS"],
  ["LlmProfileUltraModel", "LLM_PROFILE_ULTRA_MODEL"],
  ["LlmProfileUltraReasoningEffort", "LLM_PROFILE_ULTRA_REASONING_EFFORT"],
  ["LlmProfileUltraTimeoutMs", "LLM_PROFILE_ULTRA_TIMEOUT_MS"],
  ["LlmAnalyticsEnabled", "LLM_ANALYTICS_ENABLED"],
  ["LlmDebugLogs", "LLM_DEBUG_LOGS"],
  ["LlmResultRetentionDays", "LLM_RESULT_RETENTION_DAYS"],
  ["LlmHookMaxRequests", "LLM_HOOK_MAX_REQUESTS"],
  ["LlmTalkSelector", "LLM_TALK_SELECTOR"],
  ["TypesafeApiKey", "TYPESAFE_API_KEY"],
  ["TypesafeModel", "TYPESAFE_MODEL"],
  ["TypesafeMinConfidence", "TYPESAFE_MIN_CONFIDENCE"],
  ["TypesafeAdvanceMinConfidence", "TYPESAFE_ADVANCE_MIN_CONFIDENCE"],
  ["TypesafeGameOverMinConfidence", "TYPESAFE_GAME_OVER_MIN_CONFIDENCE"],
  ["TypesafeLowConfidenceFallback", "TYPESAFE_LOW_CONFIDENCE_FALLBACK"]
].flatMap(([parameter, environmentVariable]) => {
  const value = process.env[environmentVariable]?.trim();
  return value ? [`${parameter}=${value}`] : [];
});

const root = fileURLToPath(new URL("../", import.meta.url));
const samConfigPath = fileURLToPath(new URL("../infra/aws/samconfig.toml", import.meta.url));

function run(command, args, capture = false, extraEnvironment = {}) {
  const result = spawnSync(command, command === "aws" ? [...args, "--region", region, "--no-cli-pager"] : args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: { ...process.env, ...extraEnvironment }
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? result.stdout : "";
}

function awsJson(args, missingPattern) {
  const result = spawnSync("aws", [...args, "--region", region, "--no-cli-pager", "--output", "json"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env
  });
  if (result.status !== 0) {
    // 不在だけを区別し、認証・認可・通信の失敗を初回作成と取り違えない。
    if (missingPattern?.test(result.stderr ?? "")) return null;
    console.error(result.stderr || result.error?.message || "AWS CLIの実行に失敗しました。");
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout);
}

function stackOutputs(name) {
  const outputs = awsJson(["cloudformation", "describe-stacks", "--stack-name", name, "--query", "Stacks[0].Outputs"]);
  return Object.fromEntries(outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
}

async function checkHealth(endpoint) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`${endpoint.replace(/\/$/u, "")}/api/health`, { signal: AbortSignal.timeout(30_000) });
      if (response.ok) {
        const body = await response.json();
        if (body.ok === true && body.clientRevision === selectedScenario.clientRevision) return;
      }
    } catch {
      // 配備直後の伝播・起動待ちだけを有限回確認する。別originへ迂回しない。
    }
    if (attempt < 4) await setTimeout(2_000);
  }
  console.error("ヘルスチェックに失敗しました。APIの正常応答とclientRevisionを確認してください。");
  process.exit(1);
}

// CLI/APIの非対応や権限不足は、ビルドや資源作成の前に止める。
awsJson(["lambda-web", "get-web-account-settings"]);
run("npm", ["run", "audit:public"]);
if (apiOnly) {
  run("npm", ["run", "scenario:build"]);
  run("npm", ["run", "audit:aws:scenario"]);
  run("npm", ["run", "audit:client"]);
} else {
  run("npm", ["run", "build:aws"], false, {
    VITE_XSTORYPHONE_RESET_FOR_TESTING: resetForTesting
  });
  run("npm", ["run", "audit:client:aws"]);
}
run("node", ["scripts/build-aws-api.mjs"]);
const archive = fileURLToPath(new URL("../.aws-sam/web-api/api.zip", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../.aws-sam/web-api/manifest.json", import.meta.url), "utf8"));
if (!/^[a-f0-9]{64}$/u.test(manifest.sha256) || createHash("sha256").update(readFileSync(archive)).digest("hex") !== manifest.sha256) {
  console.error("APIアーカイブとmanifestのhashが一致しません。");
  process.exit(1);
}
const artifactStackName = `${stackName}-artifacts`;
run("aws", [
  "cloudformation", "deploy", "--stack-name", artifactStackName,
  "--template-file", "infra/aws/artifacts.yaml", "--no-fail-on-empty-changeset",
  "--parameter-overrides", `ProjectName=${projectName}`, `EnvironmentName=${environment}`
]);
const artifactOutputs = stackOutputs(artifactStackName);
const codeBucket = artifactOutputs.CodeBucketName;
if (!codeBucket) {
  console.error("非公開コード用バケットを取得できませんでした。");
  process.exit(1);
}
const codeKey = `releases/${manifest.sha256}.zip`;
const existingCode = awsJson(["s3api", "head-object", "--bucket", codeBucket, "--key", codeKey], /\(404\).*HeadObject[\s\S]*Not Found/u);
const code = existingCode ?? awsJson(["s3api", "put-object", "--bucket", codeBucket, "--key", codeKey, "--body", archive]);
if (!code.VersionId || code.VersionId === "null") {
  console.error("コード用S3のVersionIdが取得できませんでした。versioning設定を確認してください。");
  process.exit(1);
}
run("sam", [
  "deploy",
  "--no-confirm-changeset",
  "--no-fail-on-empty-changeset",
  "--stack-name", stackName,
  "--template-file", "infra/aws/template.yaml",
  "--config-file", samConfigPath,
  "--config-env", environment,
  "--region", region,
  "--s3-bucket", codeBucket,
  "--s3-prefix", `cloudformation/${stackName}`,
  ...(prepareOnly ? ["--no-execute-changeset"] : []),
  "--parameter-overrides",
  `EnvironmentName=${environment}`,
  `ProjectName=${projectName}`,
  ...(webAclArn === undefined ? [] : [`WebAclArn="${webAclArn}"`]),
  `CodeBucketName=${codeBucket}`,
  `CodeObjectKey=${codeKey}`,
  `CodeObjectVersion=${code.VersionId}`,
  `MaxEnvironments=${settings.maxEnvironments}`,
  `MaxConcurrencyPerEnvironment=${settings.maxConcurrencyPerEnvironment}`,
  `LogRetentionDays=${settings.logDays}`,
  `PlayerInputLogging=${playerInputLogging}`,
  // SAMへ引用符ごと渡し、CSVだけでなく未設定の空文字も明示的に反映する。
  `AllowedOrigins="${allowedOrigins}"`,
  `AdminReviewSecret=${adminReviewSecret}`,
  ...(browserStateSecret ? [`BrowserStateSecret=${browserStateSecret}`] : []),
  ...(accessCodeSecret ? [`AccessCodeSecret=${accessCodeSecret}`] : []),
  ...llmParameterOverrides
]);

if (prepareOnly) {
  console.log("mainスタックの変更セットを作成しました。未実行です。確認済みの変更セットを実行した後、このオプションを外して再実行してください。");
  process.exit(0);
}

const outputs = stackOutputs(stackName);
const healthEndpoint = outputs.ApiEndpoint;
if (!healthEndpoint || !outputs.FunctionArn || !outputs.EndpointArn || !outputs.DistributionId || (!apiOnly && !outputs.StaticBucketName)) {
  console.error("CloudFormation outputから公開先を取得できませんでした。");
  process.exit(1);
}

const current = awsJson(["lambda-web", "get-resource-policy", "--resource-arn", outputs.FunctionArn], /\(ResourceNotFoundException\).*GetResourcePolicy[\s\S]*function does not have a policy/u);
const policy = current ? JSON.parse(current.policy) : { Version: "2012-10-17", Statement: [] };
const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement];
const account = outputs.FunctionArn.split(":")[4];
const statement = {
  Sid: "AllowXStoryPhoneCloudFront", Effect: "Allow", Principal: { Service: "cloudfront.amazonaws.com" },
  Action: "lambda:InvokeWebFunctionEndpoint", Resource: outputs.EndpointArn,
  Condition: { StringEquals: { "aws:SourceArn": `arn:${outputs.FunctionArn.split(":")[1]}:cloudfront::${account}:distribution/${outputs.DistributionId}`, "aws:SourceAccount": account } }
};
if (!isDeepStrictEqual(statements.find(item => item.Sid === statement.Sid), statement)) {
  policy.Statement = [...statements.filter(item => item.Sid !== statement.Sid), statement];
  awsJson(["lambda-web", "put-resource-policy", "--resource-arn", outputs.FunctionArn, "--policy", JSON.stringify(policy), ...(current ? ["--revision-id", current.revisionId] : [])]);
}
run("aws", ["cloudfront", "wait", "distribution-deployed", "--id", outputs.DistributionId]);
await checkHealth(healthEndpoint);

if (!apiOnly) {
  const destination = `s3://${outputs.StaticBucketName}`;
  run("aws", [
    "s3", "sync", "dist/aws", destination, "--delete",
    "--exclude", "assets/*", "--cache-control", "public,max-age=300"
  ]);
  run("aws", [
    "s3", "sync", "dist/aws/assets", `${destination}/assets`, "--delete",
    "--cache-control", "public,max-age=31536000,immutable"
  ]);
  run("aws", ["cloudfront", "create-invalidation", "--distribution-id", outputs.DistributionId, "--paths", "/*"]);
}

if (!apiOnly) await checkHealth(healthEndpoint);
console.log(`AWSへの${apiOnly ? "APIのみの" : ""}公開が完了しました: ${healthEndpoint}`);
