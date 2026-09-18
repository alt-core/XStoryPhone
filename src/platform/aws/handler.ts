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
import { handle } from "hono/aws-lambda";
import { createApp } from "../../server/app";
import { DynamoStore, type DynamoTransport } from "./dynamoStore";

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
    const Command = commands[operation as keyof typeof commands];
    if (!Command) throw new Error(`未対応のDynamoDB操作です: ${operation}`);
    return await dynamoClient.send(new Command(input));
  }
};

const tableName = process.env.TABLE_NAME?.trim();
if (!tableName) throw new Error("TABLE_NAMEが設定されていません。");

const app = createApp({
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
      LLM_DEBUG_LOGS: process.env.LLM_DEBUG_LOGS
    }
  }
});

export const handler = handle(app);
