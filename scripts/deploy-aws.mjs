import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "./scenario-lib.mjs";

const environments = {
  dev: { stackName: "xstoryphone-dev", concurrency: "3", logDays: "7" },
  stg: { stackName: "xstoryphone-stg", concurrency: "5", logDays: "14" },
  prod: { stackName: "xstoryphone-prod", concurrency: "10", logDays: "14" }
};
const environment = process.argv[2];
const settings = environments[environment];
if (!settings) {
  console.error("環境はdev、stg、prodのいずれかを指定してください。");
  process.exit(1);
}
const resetForTesting = environment === "prod" ? "false" : "true";

const adminReviewSecret = process.env.ADMIN_REVIEW_SECRET?.trim();
if (!adminReviewSecret) {
  console.error("ADMIN_REVIEW_SECRETを環境変数へ設定してください。");
  process.exit(1);
}
const playerInputLogging = process.env.PLAYER_INPUT_LOGGING === "true" ? "true" : "false";
const browserStateSecret = process.env.BROWSER_STATE_SECRET?.trim();
const accessCodeSecret = process.env.ACCESS_CODE_SECRET?.trim();
if (loadAndValidateScenario().worker.playerMode === "browser" && !browserStateSecret) {
  console.error("browserモードではBROWSER_STATE_SECRETを環境変数へ設定してください。");
  process.exit(1);
}
const llmParameterOverrides = [
  ["LlmApiKey", "LLM_API_KEY"],
  ["LlmModel", "LLM_MODEL"],
  ["LlmBaseUrl", "LLM_BASE_URL"],
  ["LlmTimeoutMs", "LLM_TIMEOUT_MS"],
  ["LlmReasoningEffort", "LLM_REASONING_EFFORT"]
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
run("npm", ["run", "build:aws"], false, {
  VITE_XSTORYPHONE_RESET_FOR_TESTING: resetForTesting
});
run("npm", ["run", "audit:client:aws"]);
run("sam", ["build", "--template-file", "infra/aws/template.yaml"]);
run("sam", [
  "deploy",
  "--no-confirm-changeset",
  "--no-fail-on-empty-changeset",
  "--stack-name", settings.stackName,
  "--template-file", ".aws-sam/build/template.yaml",
  "--config-file", samConfigPath,
  "--config-env", environment,
  "--parameter-overrides",
  `EnvironmentName=${environment}`,
  `ReservedConcurrency=${settings.concurrency}`,
  `LogRetentionDays=${settings.logDays}`,
  `PlayerInputLogging=${playerInputLogging}`,
  `AdminReviewSecret=${adminReviewSecret}`,
  ...(browserStateSecret ? [`BrowserStateSecret=${browserStateSecret}`] : []),
  ...(accessCodeSecret ? [`AccessCodeSecret=${accessCodeSecret}`] : []),
  ...llmParameterOverrides
]);

const outputJson = run("aws", [
  "cloudformation", "describe-stacks",
  "--stack-name", settings.stackName,
  "--query", "Stacks[0].Outputs",
  "--output", "json"
], true);
const outputs = Object.fromEntries(JSON.parse(outputJson).map((entry) => [entry.OutputKey, entry.OutputValue]));
if (!outputs.StaticBucketName || !outputs.DistributionId || !outputs.SiteUrl) {
  console.error("CloudFormation outputから公開先を取得できませんでした。");
  process.exit(1);
}

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

const response = await fetch(`${outputs.SiteUrl}/api/health`, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  console.error(`ヘルスチェックに失敗しました: HTTP ${response.status}`);
  process.exit(1);
}
console.log(`AWSへの公開が完了しました: ${outputs.SiteUrl}`);
