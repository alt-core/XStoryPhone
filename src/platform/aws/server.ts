import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";
import { serve } from "@hono/node-server";
import { createApp } from "../../server/app";
import type { AppDependencies } from "../../server/store";
import { DynamoStore, type DynamoTransport } from "./dynamoStore";

// AWSが指定するhost:portを使い、設定漏れをlocalhostへの暗黙fallbackにしない。
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT?.trim().match(/^(\[[^\]]+\]|[^\s:/?#@]+):(\d+)$/u);
const port = Number(endpoint?.[2]);
if (!endpoint || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("AWS_LAMBDA_HTTP_ENDPOINTをhost:port形式で指定してください。");
}

const commands = {
  BatchWriteItem: BatchWriteItemCommand,
  DeleteItem: DeleteItemCommand,
  GetItem: GetItemCommand,
  PutItem: PutItemCommand,
  Query: QueryCommand,
  TransactWriteItems: TransactWriteItemsCommand,
  UpdateItem: UpdateItemCommand
};

const dynamoClient = new DynamoDBClient({});
const transport: DynamoTransport = {
  async execute(operation, input) {
    // storeの共通RecordとSDK各commandの型を、このAWS adapterの境界だけで接続する。
    const Command = commands[operation as keyof typeof commands] as unknown as
      (new (input: Record<string, unknown>) => Parameters<DynamoDBClient["send"]>[0]) | undefined;
    if (!Command) throw new Error(`未対応のDynamoDB操作です: ${operation}`);
    return await dynamoClient.send(new Command(input)) as Awaited<ReturnType<DynamoTransport["execute"]>>;
  }
};

const tableName = process.env.TABLE_NAME?.trim();
if (!tableName) throw new Error("TABLE_NAMEが設定されていません。");

const dependencies: AppDependencies = {
  store: new DynamoStore(transport, tableName),
  config: {
    appEnv: process.env.APP_ENV,
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    adminReviewSecret: process.env.ADMIN_REVIEW_SECRET,
    browserStateSecret: process.env.BROWSER_STATE_SECRET,
    accessCodeSecret: process.env.ACCESS_CODE_SECRET,
    playerInputLogging: process.env.PLAYER_INPUT_LOGGING === "true",
    llmResultRetentionDays: Number(process.env.LLM_RESULT_RETENTION_DAYS) || 30,
    llm: {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
      LLM_REASONING_EFFORT: process.env.LLM_REASONING_EFFORT,
      LLM_PROFILE_FAST_MODEL: process.env.LLM_PROFILE_FAST_MODEL,
      LLM_PROFILE_FAST_REASONING_EFFORT: process.env.LLM_PROFILE_FAST_REASONING_EFFORT,
      LLM_PROFILE_FAST_TIMEOUT_MS: process.env.LLM_PROFILE_FAST_TIMEOUT_MS,
      LLM_PROFILE_SUPER_MODEL: process.env.LLM_PROFILE_SUPER_MODEL,
      LLM_PROFILE_SUPER_REASONING_EFFORT: process.env.LLM_PROFILE_SUPER_REASONING_EFFORT,
      LLM_PROFILE_SUPER_TIMEOUT_MS: process.env.LLM_PROFILE_SUPER_TIMEOUT_MS,
      LLM_PROFILE_ULTRA_MODEL: process.env.LLM_PROFILE_ULTRA_MODEL,
      LLM_PROFILE_ULTRA_REASONING_EFFORT: process.env.LLM_PROFILE_ULTRA_REASONING_EFFORT,
      LLM_PROFILE_ULTRA_TIMEOUT_MS: process.env.LLM_PROFILE_ULTRA_TIMEOUT_MS,
      LLM_ANALYTICS_ENABLED: process.env.LLM_ANALYTICS_ENABLED,
      LLM_DEBUG_LOGS: process.env.LLM_DEBUG_LOGS,
      LLM_HOOK_MAX_REQUESTS: process.env.LLM_HOOK_MAX_REQUESTS,
      LLM_TALK_SELECTOR: process.env.LLM_TALK_SELECTOR,
      TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
      TYPESAFE_MODEL: process.env.TYPESAFE_MODEL,
      TYPESAFE_MIN_CONFIDENCE: process.env.TYPESAFE_MIN_CONFIDENCE,
      TYPESAFE_ADVANCE_MIN_CONFIDENCE: process.env.TYPESAFE_ADVANCE_MIN_CONFIDENCE,
      TYPESAFE_GAME_OVER_MIN_CONFIDENCE: process.env.TYPESAFE_GAME_OVER_MIN_CONFIDENCE,
      TYPESAFE_LOW_CONFIDENCE_FALLBACK: process.env.TYPESAFE_LOW_CONFIDENCE_FALLBACK
    }
  }
};

const server = serve({
  hostname: endpoint[1].replace(/^\[|\]$/g, ""),
  port,
  fetch(request) {
    // 30秒の要求枠から保存・応答に3秒を残し、LLMと生成音声で同じ期限を使う。
    // 設定・part・hookの可変runtimeを要求内へ閉じ、別要求の締切を持ち越さない。
    const requestDeadlineMs = Date.now() + 27_000;
    return createApp({
      ...dependencies,
      config: { ...dependencies.config, llm: { ...dependencies.config.llm, requestDeadlineMs } }
    }).fetch(request);
  }
});

// 終了猶予は短い。新しい保存やjob再投入は始めず、接続を閉じてSDKを破棄する。
process.once("SIGTERM", () => server.close(() => dynamoClient.destroy()));
