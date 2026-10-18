import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertAwsInitialScheduleLimit,
  AWS_INITIAL_SCHEDULE_ITEM_LIMIT_BYTES,
  AWS_INITIAL_SCHEDULE_LIMIT
} from "../scripts/audit-aws-scenario.mjs";

const template = readFileSync(new URL("../infra/aws/template.yaml", import.meta.url), "utf8");
const artifactsTemplate = readFileSync(new URL("../infra/aws/artifacts.yaml", import.meta.url), "utf8");
const samconfig = readFileSync(new URL("../infra/aws/samconfig.toml", import.meta.url), "utf8");
const wranglerConfig = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dynamoStore = readFileSync(new URL("../src/platform/aws/dynamoStore.ts", import.meta.url), "utf8");
const awsServer = readFileSync(new URL("../src/platform/aws/server.ts", import.meta.url), "utf8");
const deployAws = readFileSync(new URL("../scripts/deploy-aws.mjs", import.meta.url), "utf8");
const deployCloudflare = readFileSync(new URL("../scripts/deploy-cloudflare.mjs", import.meta.url), "utf8");
const reviewAnalyzer = readFileSync(new URL("../scripts/analyze-talk-branch-review-clusters.mjs", import.meta.url), "utf8");

function resourceBlock(source, logicalId) {
  const resources = source.split("\nResources:\n")[1]?.split("\nOutputs:\n")[0];
  assert.ok(resources, "Resourcesが必要です");
  const marker = `  ${logicalId}:\n`;
  const start = resources.indexOf(marker);
  assert.notEqual(start, -1, `${logicalId}が必要です`);
  return resources.slice(start + marker.length).split(/\n  [A-Za-z][A-Za-z0-9]*:\n/u)[0];
}

test("AWS初期構成は必要最小限のサーバーレス資源だけを定義する", () => {
  for (const resource of [
    "AWS::Serverless::WebFunction",
    "AWS::IAM::Role",
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
    "AWS::Scheduler::Schedule",
    "AWS::Serverless::Function",
    "AWS::Serverless::HttpApi",
    "AWS::Lambda::Function"
  ]) {
    assert.doesNotMatch(template, new RegExp(excluded.replaceAll("*", "\\*"), "u"));
  }
});

test("Web Functionはversion固定の非公開ZIPと要求単位の上限を使う", () => {
  const app = resourceBlock(template, "AppWebFunction");
  assert.match(app, /FunctionName: !Sub \$\{ProjectName\}-\$\{EnvironmentName\}-web-api/u);
  assert.match(app, /Runtime: nodejs24\.x/u);
  assert.match(app, /EntryPoint: index\.cjs/u);
  assert.match(app, /CodeUri:\n\s+Bucket: !Ref CodeBucketName\n\s+Key: !Ref CodeObjectKey\n\s+Version: !Ref CodeObjectVersion/u);
  assert.match(app, /ExecutionRoleArn: !GetAtt AppFunctionRole\.Arn/u);
  assert.match(app, /AuthType: IamAuth/u);
  assert.match(app, /EndpointType: HomeRegion/u);
  assert.match(app, /EndpointName: !Ref EnvironmentName/u);
  assert.match(app, /AutoDeploymentMode: LatestRevision/u);
  assert.match(app, /Timeout: 30/u);
  assert.match(app, /MaxConcurrencyPerEnvironment: !Ref MaxConcurrencyPerEnvironment/u);
  assert.match(app, /ScalingConfig:\n\s+MaxEnvironments: !Ref MaxEnvironments/u);
  assert.doesNotMatch(app, /MemorySize:|Handler:|Events:|ApplicationManaged|ReservedConcurrentExecutions/u);
  assert.doesNotMatch(template, /BuildMethod:|BuildProperties:|ReservedConcurrency:/u);
});

test("SAM生成の重複依存警告だけをWeb Function内で除外し、他の検査は維持する", () => {
  const app = resourceBlock(template, "AppWebFunction");
  assert.match(app, /Metadata:\n\s+cfn-lint:\n\s+config:\n\s+ignore_checks:\n\s+- W3005\n\s+Properties:/u);
  assert.equal([...template.matchAll(/ignore_checks:/gu)].length, 1, "テンプレート全体や別資源に除外を広げない");
  assert.doesNotMatch(artifactsTemplate, /ignore_checks:/u);
  assert.match(packageJson.scripts["aws:validate"], /sam validate --lint/u);
  assert.doesNotMatch(packageJson.scripts["aws:validate"], /--ignore-checks|--non-zero-exit-code/u);
});

test("コード保管は公開素材と別のversioned S3へ限定し、使用中の資材と権限を保持する", () => {
  assert.deepEqual([...artifactsTemplate.matchAll(/^    Type: (AWS::[^\n]+)/gmu)].map((match) => match[1]), [
    "AWS::S3::Bucket", "AWS::S3::BucketPolicy"
  ]);
  const bucket = resourceBlock(artifactsTemplate, "CodeBucket");
  const policy = resourceBlock(artifactsTemplate, "CodeBucketPolicy");
  for (const block of [bucket, policy]) {
    assert.match(block, /DeletionPolicy: Retain/u);
    assert.match(block, /UpdateReplacePolicy: Retain/u);
  }
  assert.match(bucket, /VersioningConfiguration:\n\s+Status: Enabled/u);
  assert.match(bucket, /SSEAlgorithm: AES256/u);
  assert.match(bucket, /ObjectOwnership: BucketOwnerEnforced/u);
  for (const flag of ["BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets"]) {
    assert.match(bucket, new RegExp(`${flag}: true`, "u"));
  }
  assert.doesNotMatch(bucket, /BucketName:|LifecycleConfiguration:/u);
  assert.match(policy, /Service: lambda\.amazonaws\.com/u);
  assert.match(policy, /s3:GetObject\n\s+- s3:GetObjectVersion/u);
  assert.match(policy, /Resource: !Sub \$\{CodeBucket\.Arn\}\/releases\/\*/u);
  assert.match(policy, /aws:SourceAccount: !Ref AWS::AccountId/u);
  assert.match(policy, /aws:SourceArn: !Sub arn:\$\{AWS::Partition\}:lambda:\$\{AWS::Region\}:\$\{AWS::AccountId\}:web-function\/\$\{ProjectName\}-\$\{EnvironmentName\}-web-api\/revision\/\*/u);
  assert.doesNotMatch(policy, /cloudfront\.amazonaws\.com|cloudformation\/|kms:/u);
  assert.match(artifactsTemplate, /CodeBucketName:\n\s+Value: !Ref CodeBucket/u);
  assert.doesNotMatch(samconfig, /resolve_s3/u);
});

test("DynamoDB・公開素材・CloudFrontのlogical IDと保存契約を維持する", () => {
  const table = resourceBlock(template, "AppTable");
  const bucket = resourceBlock(template, "StaticBucket");
  const distribution = resourceBlock(template, "Distribution");
  for (const block of [table, bucket]) {
    assert.match(block, /DeletionPolicy: Retain/u);
    assert.match(block, /UpdateReplacePolicy: Retain/u);
  }
  assert.match(table, /TableName: !Sub \$\{ProjectName\}-\$\{EnvironmentName\}/u);
  assert.match(table, /BillingMode: PAY_PER_REQUEST/u);
  assert.match(table, /IndexName: GSI1/u);
  assert.match(table, /IndexName: GSI2/u);
  assert.match(bucket, /BucketName: !Sub \$\{ProjectName\}-\$\{EnvironmentName\}-\$\{AWS::AccountId\}-\$\{AWS::Region\}/u);
  assert.match(distribution, /DefaultRootObject: index\.html/u);
  assert.match(distribution, /DomainName: !GetAtt StaticBucket\.RegionalDomainName/u);
  assert.match(distribution, /FunctionARN: !GetAtt SpaRewriteFunction\.FunctionARN/u);
  for (const output of ["SiteUrl", "ApiEndpoint"]) {
    assert.match(template, new RegExp(`${output}:\\n\\s+Value: !Sub https://\\$\\{Distribution\\.DomainName\\}`, "u"));
  }
});

test("既存の実行role logical IDとDynamoDB CRUD権限を維持し、両ログの保持期限を設定する", () => {
  const role = resourceBlock(template, "AppFunctionRole");
  assert.match(role, /Type: AWS::IAM::Role/u);
  assert.doesNotMatch(role, /RoleName:/u);
  assert.match(role, /Service: lambda\.amazonaws\.com/u);
  for (const action of [
    "GetItem", "DeleteItem", "PutItem", "Scan", "Query", "UpdateItem", "BatchWriteItem", "BatchGetItem", "DescribeTable", "ConditionCheckItem"
  ]) {
    assert.match(role, new RegExp(`dynamodb:${action}(?:\\n|$)`, "u"));
  }
  assert.match(role, /!GetAtt AppTable\.Arn/u);
  assert.match(role, /!Sub \$\{AppTable\.Arn\}\/index\/\*/u);
  for (const logicalId of ["AppWebFunctionLogGroup", "AppWebFunctionLocalLogGroup"]) {
    const group = resourceBlock(template, logicalId);
    assert.match(group, /RetentionInDays: !Ref LogRetentionDays/u);
    assert.match(role, new RegExp(`!GetAtt ${logicalId}\\.Arn`, "u"));
  }
  assert.match(resourceBlock(template, "AppWebFunctionLogGroup"), /LogGroupName: !Sub \/aws\/lambda\/web\/\$\{ProjectName\}-\$\{EnvironmentName\}-web-api\n/u);
  assert.match(resourceBlock(template, "AppWebFunctionLocalLogGroup"), /LogGroupName: !Sub \/aws\/lambda\/web\/\$\{ProjectName\}-\$\{EnvironmentName\}-web-api\.local\n/u);
});

test("S3は非公開OAC、APIは同一CloudFrontの非キャッシュ経路を使う", () => {
  assert.match(template, /BlockPublicAcls: true/u);
  assert.match(template, /RestrictPublicBuckets: true/u);
  assert.match(template, /OriginAccessControlId:/u);
  assert.match(template, /PathPattern: \/api\/\*/u);
  assert.match(template, /CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad/u);
  assert.match(template, /OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac/u);
  const apiOac = resourceBlock(template, "ApiOriginAccessControl");
  assert.match(apiOac, /OriginAccessControlOriginType: lambda/u);
  assert.match(apiOac, /SigningBehavior: always-amz-auth/u);
  assert.match(apiOac, /SigningProtocol: sigv4/u);
  assert.match(template, /DomainName: !GetAtt AppWebFunctionEndpoint\.DomainName\n\s+OriginAccessControlId: !GetAtt ApiOriginAccessControl\.Id/u);
  assert.match(template, /OriginReadTimeout: 45/u);
  assert.doesNotMatch(template, /execute-api|CustomHeaders:|AWS::CloudFront::CachePolicy|CustomErrorResponses:/u);
  assert.match(template, /FunctionArn:\n\s+Value: !GetAtt AppWebFunction\.FunctionArn/u);
  assert.match(template, /EndpointArn:\n\s+Value: !GetAtt AppWebFunctionEndpoint\.EndpointArn/u);
});

test("dev・stg・prodは明示的なビルド／デプロイコマンドを持つ", () => {
  for (const environment of ["dev", "stg", "prod"]) {
    assert.match(samconfig, new RegExp(`\\[${environment}\\.deploy\\.parameters\\]`, "u"));
    assert.equal(packageJson.scripts[`deploy:aws:${environment}`], `node scripts/deploy-aws.mjs ${environment}`);
    assert.equal(packageJson.scripts[`deploy:cloudflare:${environment}`], `node scripts/deploy-cloudflare.mjs ${environment}`);
    assert.match(packageJson.scripts[`build:cloudflare:${environment}`], new RegExp(`CLOUDFLARE_ENV=${environment}`, "u"));
  }
  assert.match(packageJson.scripts["build:aws"], /BUILD_PLATFORM=aws/u);
  assert.match(packageJson.scripts["build:aws"], /audit:aws:scenario/u);
  assert.doesNotMatch(packageJson.scripts["build:aws"], /deploy/u);
});

test("AWS版のserverモードだけ新規player作成transactionへ収まる初期scheduleを検証する", () => {
  const schedule = { id: "schedule", eventId: "event", fields: {}, delayMs: 0 };
  assert.doesNotThrow(() => assertAwsInitialScheduleLimit(Array.from(
    { length: AWS_INITIAL_SCHEDULE_LIMIT },
    (_, index) => ({ ...schedule, id: `schedule_${index}` })
  ), "server"));
  assert.throws(
    () => assertAwsInitialScheduleLimit(Array.from(
      { length: AWS_INITIAL_SCHEDULE_LIMIT + 1 },
      (_, index) => ({ ...schedule, id: `schedule_${index}` })
    ), "server"),
    /initialSchedulesは98件以下/u
  );
  assert.throws(
    () => assertAwsInitialScheduleLimit([{
      ...schedule,
      fields: { body: "あ".repeat(AWS_INITIAL_SCHEDULE_ITEM_LIMIT_BYTES) }
    }], "server"),
    /initialSchedules\[0\]が大きすぎます/u
  );
  assert.throws(
    () => assertAwsInitialScheduleLimit(Array.from({ length: 12 }, (_, index) => ({
      ...schedule,
      id: `large_${index}`,
      fields: { body: "あ".repeat(90_000) }
    })), "server"),
    /initialSchedules全体が大きすぎます/u
  );
  assert.doesNotThrow(() => assertAwsInitialScheduleLimit(Array.from(
    { length: AWS_INITIAL_SCHEDULE_LIMIT + 1 },
    (_, index) => ({ ...schedule, id: `browser_schedule_${index}` })
  ), "browser"));
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
  assert.doesNotMatch(awsServer, /ScanCommand/u);
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
  assert.match(deployAws, /"--no-confirm-changeset"/u);
  assert.match(deployAws, /"--no-fail-on-empty-changeset"/u);
});

test("AWSの環境別スタック名と運用上限はデプロイスクリプトで一元管理する", () => {
  assert.doesNotMatch(samconfig, /stack_name|parameter_overrides/u);
  assert.match(deployAws, /--stack-name", stackName/u);
  assert.match(deployAws, /const stackName = `\$\{projectName\}-\$\{environment\}`/u);
  for (const [environment, concurrency, logDays] of [["dev", "2", "7"], ["stg", "2", "14"], ["prod", "5", "14"]]) {
    assert.match(deployAws, new RegExp(`${environment}: \\{ maxEnvironments: "2", maxConcurrencyPerEnvironment: "${concurrency}", logDays: "${logDays}" \\}`, "u"));
  }
  assert.match(deployAws, /`MaxEnvironments=\$\{settings\.maxEnvironments\}`/u);
  assert.match(deployAws, /`MaxConcurrencyPerEnvironment=\$\{settings\.maxConcurrencyPerEnvironment\}`/u);
});

test("AWSデプロイは設定されたLLM項目だけをLambdaへ渡す", () => {
  for (const [parameter, environmentVariable] of [
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
    ["LlmTalkSelector", "LLM_TALK_SELECTOR"],
    ["TypesafeApiKey", "TYPESAFE_API_KEY"],
    ["TypesafeModel", "TYPESAFE_MODEL"],
    ["TypesafeMinConfidence", "TYPESAFE_MIN_CONFIDENCE"],
    ["TypesafeAdvanceMinConfidence", "TYPESAFE_ADVANCE_MIN_CONFIDENCE"],
    ["TypesafeGameOverMinConfidence", "TYPESAFE_GAME_OVER_MIN_CONFIDENCE"],
    ["TypesafeLowConfidenceFallback", "TYPESAFE_LOW_CONFIDENCE_FALLBACK"]
  ]) {
    assert.match(template, new RegExp(`${environmentVariable}: !If \\[Has${parameter}, !Ref ${parameter}, !Ref AWS::NoValue\\]`, "u"));
    assert.match(template, new RegExp(`Has${parameter}: !Not \\[!Equals \\[!Ref ${parameter}, ""\\]\\]`, "u"));
    assert.match(deployAws, new RegExp(`\\["${parameter}", "${environmentVariable}"\\]`, "u"));
  }
  assert.match(template, /LlmApiKey:\s+[\s\S]*?NoEcho: true/u);
  assert.match(template, /TypesafeApiKey:\n\s+Type: String\n\s+NoEcho: true/u);
  assert.match(template, /TimeToLiveSpecification:\s+[\s\S]*?AttributeName: expiresAtEpoch[\s\S]*?Enabled: true/u);
});

test("AWSの人数限定アクセスコードは任意の非表示parameterとして渡す", () => {
  assert.match(template, /AccessCodeSecret:\s+[\s\S]*?NoEcho: true/u);
  assert.match(template, /ACCESS_CODE_SECRET: !If \[HasAccessCodeSecret, !Ref AccessCodeSecret, !Ref AWS::NoValue\]/u);
  assert.match(deployAws, /process\.env\.ACCESS_CODE_SECRET/u);
  assert.match(deployAws, /`AccessCodeSecret=\$\{accessCodeSecret\}`/u);
});

test("AWSの実プレイ入力一覧は全件Scanせず疎なGSI2を使う", () => {
  assert.match(template, /IndexName: GSI2/u);
  assert.match(dynamoStore, /IndexName: "GSI2"/u);
  assert.match(dynamoStore, /GSI2PK: "INPUT_REVIEW"/u);
  assert.doesNotMatch(awsServer, /ScanCommand/u);
});

test("AWSのbrowser署名鍵は非表示parameterからLambdaだけへ渡す", () => {
  assert.match(template, /BrowserStateSecret:\s+[\s\S]*?NoEcho: true/u);
  assert.match(template, /BROWSER_STATE_SECRET: !If \[HasBrowserStateSecret, !Ref BrowserStateSecret, !Ref AWS::NoValue\]/u);
  assert.match(deployAws, /selectedScenario\.playerMode === "browser" && !browserStateSecret/u);
  assert.match(deployAws, /`BrowserStateSecret=\$\{browserStateSecret\}`/u);
});

test("Web Functionの任意環境変数は空文字を渡さず、false等の明示値は維持する", () => {
  for (const [parameter, variable] of [
    ["AllowedOrigins", "ALLOWED_ORIGINS"],
    ["BrowserStateSecret", "BROWSER_STATE_SECRET"],
    ["AccessCodeSecret", "ACCESS_CODE_SECRET"]
  ]) {
    assert.match(template, new RegExp(`Has${parameter}: !Not \\[!Equals \\[!Ref ${parameter}, ""\\]\\]`, "u"));
    assert.match(template, new RegExp(`${variable}: !If \\[Has${parameter}, !Ref ${parameter}, !Ref AWS::NoValue\\]`, "u"));
  }
  const app = resourceBlock(template, "AppWebFunction");
  assert.match(app, /ADMIN_REVIEW_SECRET: !Ref AdminReviewSecret/u);
  assert.match(app, /PLAYER_INPUT_LOGGING: !Ref PlayerInputLogging/u);
  assert.match(app, /LLM_HOOK_MAX_REQUESTS: !Ref LlmHookMaxRequests/u);
  assert.doesNotMatch(app, /: ""|: ''/u);
});

test("Cloudflareデプロイは必要なsecret名を事前確認する", () => {
  assert.match(deployCloudflare, /secret", "list", "--format", "json"/u);
  assert.match(deployCloudflare, /"ADMIN_REVIEW_SECRET"/u);
  assert.match(deployCloudflare, /playerMode === "browser" \? \["BROWSER_STATE_SECRET"\]/u);
});
