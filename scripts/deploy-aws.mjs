import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { parseAllowedOrigins } from "../src/server/cors.ts";

const environments = {
  dev: { concurrency: "3", logDays: "7" },
  stg: { concurrency: "5", logDays: "14" },
  prod: { concurrency: "10", logDays: "14" }
};
const environment = process.argv[2];
const options = process.argv.slice(3);
if (options.some((option) => option !== "--api-only") || new Set(options).size !== options.length) {
  console.error("未知または重複した引数です。環境の後には --api-only だけを指定できます。");
  process.exit(1);
}
const apiOnly = options.includes("--api-only");
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
  ["TypesafeGameOverMinConfidence", "TYPESAFE_GAME_OVER_MIN_CONFIDENCE"]
].flatMap(([parameter, environmentVariable]) => {
  const value = process.env[environmentVariable]?.trim();
  return value ? [`${parameter}=${value}`] : [];
});

const root = fileURLToPath(new URL("../", import.meta.url));
const samConfigPath = fileURLToPath(new URL("../infra/aws/samconfig.toml", import.meta.url));

function run(command, args, capture = false, extraEnvironment = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: { ...process.env, ...extraEnvironment }
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? result.stdout : "";
}

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
run("sam", ["build", "--template-file", "infra/aws/template.yaml"]);
run("sam", [
  "deploy",
  "--no-confirm-changeset",
  "--no-fail-on-empty-changeset",
  "--stack-name", stackName,
  "--template-file", ".aws-sam/build/template.yaml",
  "--config-file", samConfigPath,
  "--config-env", environment,
  "--parameter-overrides",
  `EnvironmentName=${environment}`,
  `ProjectName=${projectName}`,
  ...(webAclArn === undefined ? [] : [`WebAclArn="${webAclArn}"`]),
  `ReservedConcurrency=${settings.concurrency}`,
  `LogRetentionDays=${settings.logDays}`,
  `PlayerInputLogging=${playerInputLogging}`,
  // SAMへ引用符ごと渡し、CSVだけでなく未設定の空文字も明示的に反映する。
  `AllowedOrigins="${allowedOrigins}"`,
  `AdminReviewSecret=${adminReviewSecret}`,
  ...(browserStateSecret ? [`BrowserStateSecret=${browserStateSecret}`] : []),
  ...(accessCodeSecret ? [`AccessCodeSecret=${accessCodeSecret}`] : []),
  ...llmParameterOverrides
]);

const outputJson = run("aws", [
  "cloudformation", "describe-stacks",
  "--stack-name", stackName,
  "--query", "Stacks[0].Outputs",
  "--output", "json"
], true);
const outputs = Object.fromEntries(JSON.parse(outputJson).map((entry) => [entry.OutputKey, entry.OutputValue]));
const healthEndpoint = apiOnly ? outputs.ApiEndpoint : outputs.SiteUrl;
if (!healthEndpoint || (!apiOnly && (!outputs.StaticBucketName || !outputs.DistributionId))) {
  console.error("CloudFormation outputから公開先を取得できませんでした。");
  process.exit(1);
}

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

const response = await fetch(`${healthEndpoint.replace(/\/$/u, "")}/api/health`, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  console.error(`ヘルスチェックに失敗しました: HTTP ${response.status}`);
  process.exit(1);
}
console.log(`AWSへの${apiOnly ? "APIのみの" : ""}公開が完了しました: ${healthEndpoint}`);
