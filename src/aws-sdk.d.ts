declare module "@aws-sdk/client-dynamodb" {
  export class DynamoDBClient {
    constructor(config?: Record<string, unknown>);
    send(command: { input: Record<string, unknown> }): Promise<Record<string, unknown>>;
  }

  class DynamoCommand {
    constructor(input: Record<string, unknown>);
    input: Record<string, unknown>;
  }

  export class BatchWriteItemCommand extends DynamoCommand {}
  export class GetItemCommand extends DynamoCommand {}
  export class PutItemCommand extends DynamoCommand {}
  export class QueryCommand extends DynamoCommand {}
  export class TransactWriteItemsCommand extends DynamoCommand {}
  export class UpdateItemCommand extends DynamoCommand {}
}
