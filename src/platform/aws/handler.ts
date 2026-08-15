import {
  BatchWriteItemCommand,
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
    adminReviewSecret: process.env.ADMIN_REVIEW_SECRET,
    browserStateSecret: process.env.BROWSER_STATE_SECRET,
    playerInputLogging: process.env.PLAYER_INPUT_LOGGING === "true",
    llm: {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS
    }
  }
});

export const handler = handle(app);
