import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(new URL("../infra/aws/template.yaml", import.meta.url), "utf8");
const samconfig = readFileSync(new URL("../infra/aws/samconfig.toml", import.meta.url), "utf8");
const wranglerConfig = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dynamoStore = readFileSync(new URL("../src/platform/aws/dynamoStore.ts", import.meta.url), "utf8");
const awsHandler = readFileSync(new URL("../src/platform/aws/handler.ts", import.meta.url), "utf8");
const deployAws = readFileSync(new URL("../scripts/deploy-aws.mjs", import.meta.url), "utf8");
const deployCloudflare = readFileSync(new URL("../scripts/deploy-cloudflare.mjs", import.meta.url), "utf8");
const reviewAnalyzer = readFileSync(new URL("../scripts/analyze-talk-branch-review-clusters.mjs", import.meta.url), "utf8");

test("AWS初期構成は必要最小限のサーバーレス資源だけを定義する", () => {
  for (const resource of [
    "AWS::Serverless::Function",
    "AWS::Serverless::HttpApi",
    "AWS::DynamoDB::Table",
    "AWS::S3::Bucket",
    "AWS::CloudFront::Distribution",
    "AWS::CloudFront::OriginAccessControl",
    "AWS::Logs::LogGroup"
  ]) {
    assert.match(template, new RegExp(resource.replaceAll("*", "\\*"), "u"));
  }
  for (const excluded of [
    "AWS::EC2::VPC",
    "AWS::EC2::NatGateway",
    "AWS::RDS::DBCluster",
    "AWS::ECS::Service",
    "AWS::StepFunctions::StateMachine",
    "AWS::Scheduler::Schedule"
  ]) {
    assert.doesNotMatch(template, new RegExp(excluded.replaceAll("*", "\\*"), "u"));
  }
});

test("S3は非公開OAC、APIは同一CloudFrontの非キャッシュ経路を使う", () => {
  assert.match(template, /BlockPublicAcls: true/u);
  assert.match(template, /RestrictPublicBuckets: true/u);
  assert.match(template, /OriginAccessControlId:/u);
  assert.match(template, /PathPattern: \/api\/\*/u);
  assert.match(template, /CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad/u);
  assert.match(template, /OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac/u);
});

test("dev・stg・prodは明示的なビルド／デプロイコマンドを持つ", () => {
  for (const environment of ["dev", "stg", "prod"]) {
    assert.match(samconfig, new RegExp(`\\[${environment}\\.deploy\\.parameters\\]`, "u"));
    assert.equal(packageJson.scripts[`deploy:aws:${environment}`], `node scripts/deploy-aws.mjs ${environment}`);
    assert.equal(packageJson.scripts[`deploy:cloudflare:${environment}`], `node scripts/deploy-cloudflare.mjs ${environment}`);
    assert.match(packageJson.scripts[`build:cloudflare:${environment}`], new RegExp(`CLOUDFLARE_ENV=${environment}`, "u"));
  }
  assert.match(packageJson.scripts["build:aws"], /BUILD_PLATFORM=aws/u);
  assert.doesNotMatch(packageJson.scripts["build:aws"], /deploy/u);
});

test("dev・stgデプロイだけがテストプレイ用リセットをクライアントへ組み込む", () => {
  assert.match(deployAws, /const resetForTesting = environment === "prod" \? "false" : "true"/u);
  assert.match(deployAws, /VITE_XSTORYPHONE_RESET_FOR_TESTING: resetForTesting/u);
  assert.match(packageJson.scripts["build:cloudflare:dev"], /VITE_XSTORYPHONE_RESET_FOR_TESTING=true/u);
  assert.match(packageJson.scripts["build:cloudflare:stg"], /VITE_XSTORYPHONE_RESET_FOR_TESTING=true/u);
  assert.match(packageJson.scripts["build:cloudflare:prod"], /VITE_XSTORYPHONE_RESET_FOR_TESTING=false/u);
});

test("Cloudflareの基底設定はguardで、実アプリは明示環境だけに置く", () => {
  assert.equal(wranglerConfig.name, "xstoryphone-deploy-guard");
  assert.equal(wranglerConfig.main, "./src/worker/deployGuard.ts");
  assert.equal(wranglerConfig.d1_databases, undefined);
  assert.equal(wranglerConfig.assets, undefined);
  assert.equal(packageJson.scripts.build, "npm run build:cloudflare:dev");
  assert.equal(packageJson.scripts["build:cloudflare"], "npm run build:cloudflare:dev");

  for (const [environment, appEnv] of [["dev", "development"], ["stg", "staging"], ["prod", "production"]]) {
    assert.equal(wranglerConfig.env[environment].main, "./src/worker/index.ts");
    assert.equal(wranglerConfig.env[environment].vars.APP_ENV, appEnv);
    assert.equal(wranglerConfig.env[environment].d1_databases[0].binding, "DB");
  }
});

test("Cloudflareの公開とremote migrationは対象未指定でprodへ進まない", () => {
  assert.equal(packageJson.scripts.deploy, "node scripts/deploy-cloudflare.mjs");
  assert.equal(packageJson.scripts["db:migrate:remote"], "node scripts/require-explicit-migration-target.mjs");
  for (const environment of ["dev", "stg", "prod"]) {
    assert.match(packageJson.scripts[`db:migrate:remote:${environment}`], new RegExp(`--env ${environment}`, "u"));
  }
  assert.match(deployCloudflare, /\["secret", "list", "--format", "json", "--env", environment\]/u);
  assert.match(deployCloudflare, /\["run", `build:cloudflare:\$\{environment\}`\]/u);
  assert.match(deployCloudflare, /run\("wrangler", \["deploy", "--env", environment\]\)/u);
});

test("DynamoDB監修処理は全テーブルScanと指示ロケーターを使わない", () => {
  assert.doesNotMatch(dynamoStore, /scanAll|JUDGMENT_LOCATOR|`JUDGMENT#\$\{id\}`,[ ]*"META"/u);
  assert.doesNotMatch(awsHandler, /ScanCommand/u);
});

test("監修集計はD1へ直接接続せず共通監修APIを使う", () => {
  assert.doesNotMatch(reviewAnalyzer, /spawnSync|d1 execute|INSERT INTO|DELETE FROM|node_modules\/\.bin\/wrangler/u);
  assert.match(reviewAnalyzer, /talk-branch-review\/analysis-inputs/u);
  assert.match(reviewAnalyzer, /talk-branch-review\/clusters/u);
});

test("AWSデプロイは入力ログ設定を環境変数から引き継ぐ", () => {
  assert.match(deployAws, /process\.env\.PLAYER_INPUT_LOGGING === "true"/u);
  assert.match(deployAws, /`PlayerInputLogging=\$\{playerInputLogging\}`/u);
  assert.doesNotMatch(deployAws, /"PlayerInputLogging=false"/u);
});

test("AWSデプロイはクライアントだけの変更でも静的ファイル同期まで続行する", () => {
  assert.match(deployAws, /"--no-fail-on-empty-changeset"/u);
});

test("AWSの環境別スタック名と運用上限はデプロイスクリプトで一元管理する", () => {
  assert.doesNotMatch(samconfig, /stack_name|parameter_overrides/u);
  assert.match(deployAws, /--stack-name", settings\.stackName/u);
  for (const environment of ["dev", "stg", "prod"]) {
    assert.match(deployAws, new RegExp(`${environment}: \\{ stackName: "xstoryphone-${environment}"`, "u"));
  }
});

test("AWSデプロイは設定されたLLM項目だけをLambdaへ渡す", () => {
  for (const [parameter, environmentVariable] of [
    ["LlmApiKey", "LLM_API_KEY"],
    ["LlmModel", "LLM_MODEL"],
    ["LlmBaseUrl", "LLM_BASE_URL"],
    ["LlmTimeoutMs", "LLM_TIMEOUT_MS"]
  ]) {
    assert.match(template, new RegExp(`${environmentVariable}: !Ref ${parameter}`, "u"));
    assert.match(deployAws, new RegExp(`\\["${parameter}", "${environmentVariable}"\\]`, "u"));
  }
  assert.match(template, /LlmApiKey:\s+[\s\S]*?NoEcho: true/u);
});

test("AWSのbrowser署名鍵は非表示parameterからLambdaだけへ渡す", () => {
  assert.match(template, /BrowserStateSecret:\s+[\s\S]*?NoEcho: true/u);
  assert.match(template, /BROWSER_STATE_SECRET: !Ref BrowserStateSecret/u);
  assert.match(deployAws, /worker\.playerMode === "browser" && !browserStateSecret/u);
  assert.match(deployAws, /`BrowserStateSecret=\$\{browserStateSecret\}`/u);
});

test("Cloudflareデプロイは必要なsecret名を事前確認する", () => {
  assert.match(deployCloudflare, /secret", "list", "--format", "json"/u);
  assert.match(deployCloudflare, /"ADMIN_REVIEW_SECRET"/u);
  assert.match(deployCloudflare, /playerMode === "browser" \? \["BROWSER_STATE_SECRET"\]/u);
});
