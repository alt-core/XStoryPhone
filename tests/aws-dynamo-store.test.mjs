import assert from "node:assert/strict";
import test from "node:test";
import { DynamoStore, dynamoDocument } from "../src/platform/aws/dynamoStore.ts";
import { createInitialPlayerState } from "../src/worker/scenario.ts";
import {
  DYNAMO_PLAYER_STATE_WARNING_BYTES,
  storedPlayerStateBytes,
  storedTranscriptBytes
} from "../src/server/store.ts";

function fakeTransport(handler = async () => ({})) {
  const calls = [];
  return {
    calls,
    transport: {
      async execute(operation, input) {
        calls.push({ operation, input });
        return handler(operation, input, calls.length - 1);
      }
    }
  };
}

function conditionalError() {
  const error = new Error("競合");
  error.name = "ConditionalCheckFailedException";
  return error;
}

test("DynamoDBの文書変換はプレイヤー状態の型を保つ", () => {
  const source = {
    text: "日本語",
    count: 3,
    enabled: true,
    empty: null,
    list: ["a", 2],
    nested: { value: false }
  };
  assert.deepEqual(dynamoDocument.valueFromItem(dynamoDocument.item(source)), source);
});

test("DynamoDB版も入力ログが明示的に有効な場合だけ冪等Putする", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  const event = {
    eventType: "talk_send",
    playerId: "player-1",
    requestKey: "turn-1",
    appId: "messages",
    talkId: "talk-1",
    fromId: "from-1",
    userInput: "見つけた",
    status: "completed",
    matched: true,
    ruleId: "rule-1"
  };

  await store.recordInputEvent(event, false);
  assert.equal(fake.calls.length, 0);

  await store.recordInputEvent(event, true);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].operation, "PutItem");
  assert.equal(fake.calls[0].input.ConditionExpression, "attribute_not_exists(PK)");
  const saved = dynamoDocument.valueFromItem(fake.calls[0].input.Item);
  assert.equal(saved.PK, "PLAYER#player-1");
  assert.equal(saved.SK, "INPUT#talk_send#turn-1");
  assert.equal(saved.GSI1PK, "REVIEW_SOURCE");
  assert.match(saved.GSI1SK, /^INPUT#talk-1#from-1#/u);
  assert.equal(saved.GSI2PK, "INPUT_REVIEW");
  assert.match(saved.GSI2SK, /^INPUT#talk_send#/u);
});

test("DynamoDBの入力ログ確認はGSI2を時系列降順でQueryする", async () => {
  const row = {
    id: "input-1", eventType: "search", playerId: "player-1", occurredAt: "2026-08-17T00:00:00.000Z",
    appId: "search-agent", talkId: null, fromId: null, userInput: "黄色い灯り", normalizedInput: "黄色い灯り",
    status: "completed", matched: true, ruleId: null, nextFromId: null, responseSnapshot: { resultCount: 1 }
  };
  const fake = fakeTransport(async (operation) => operation === "Query" ? { Items: [dynamoDocument.item(row)] } : {});
  const items = await new DynamoStore(fake.transport, "table").playerInputEvents({
    eventType: "search",
    playerId: "player-1",
    query: "灯り",
    limit: 100
  });
  assert.equal(items[0].userInput, "黄色い灯り");
  assert.deepEqual(items[0].responseSnapshot, { resultCount: 1 });
  assert.equal(fake.calls[0].input.IndexName, "GSI2");
  assert.equal(fake.calls[0].input.ScanIndexForward, false);
  const values = dynamoDocument.valueFromItem(fake.calls[0].input.ExpressionAttributeValues);
  assert.equal(values[":sk"], "INPUT#search#");
});

test("同じパスコードの初回作成競合は先に作られたプレイヤーへ収束する", async () => {
  let getCount = 0;
  const fake = fakeTransport(async (operation) => {
    if (operation === "GetItem") {
      getCount += 1;
      return getCount === 1
        ? {}
        : { Item: dynamoDocument.item({ PK: "ACCESS#hash", SK: "META", playerId: "existing-player" }) };
    }
    if (operation === "TransactWriteItems") throw conditionalError();
    if (operation === "Query") return { Items: [] };
    return {};
  });

  const created = await new DynamoStore(fake.transport, "table").createPasscodeSession("12345678", createInitialPlayerState());
  assert.equal(created.created, false);
  assert.equal(created.playerId, "existing-player");
  assert.equal(fake.calls.filter((call) => call.operation === "TransactWriteItems").length, 1);
  const sessionPut = fake.calls.find((call) => call.operation === "PutItem");
  const session = dynamoDocument.valueFromItem(sessionPut.input.Item);
  assert.equal(session.playerId, "existing-player");
  assert.equal(session.GSI1PK, "PLAYER#existing-player");
});

test("DynamoDB版もアクセスコード失敗回数を同じテーブルの有界キーへ保存する", async () => {
  const at = "2026-08-17T00:00:00.000Z";
  const fake = fakeTransport(async (operation) => operation === "GetItem"
    ? { Item: dynamoDocument.item({ failedCount: 19, updatedAt: at, lockedUntil: null }) }
    : {});
  const store = new DynamoStore(fake.transport, "table");
  await store.recordAccessCodeAttempt("0042", false, at);
  const put = fake.calls.find((call) => call.operation === "PutItem");
  const saved = dynamoDocument.valueFromItem(put.input.Item);
  assert.equal(saved.PK, "ACCESS_ATTEMPT#0042");
  assert.equal(saved.failedCount, 20);
  assert.equal(saved.lockedUntil, "2026-08-17T00:15:00.000Z");

  const locked = fakeTransport(async (operation) => operation === "GetItem"
    ? { Item: dynamoDocument.item({ lockedUntil: "2026-08-17T00:15:00.000Z" }) }
    : {});
  assert.equal(await new DynamoStore(locked.transport, "table").isAccessCodeLocked("0042", "2026-08-17T00:01:00.000Z"), true);

  const cleared = fakeTransport();
  await new DynamoStore(cleared.transport, "table").recordAccessCodeAttempt("0042", true, at);
  assert.equal(cleared.calls[0].operation, "DeleteItem");
});

test("DynamoDB版も検索履歴だけを直近200メッセージへ制限する", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  const state = createInitialPlayerState();
  const messages = Array.from({ length: 202 }, (_, index) => ({
    seq: index + 1,
    id: `search-${index + 1}`,
    requestId: `request-${Math.floor(index / 2)}`,
    role: index % 2 ? "assistant" : "user",
    body: "検索",
    sentAt: "2026-08-17T00:00:00.000Z"
  }));
  assert.equal(await store.savePlayer({ id: "player-1", state, stateVersion: 1 }, state, [{
    streamId: "search",
    transcriptKey: state.searchTranscriptKey,
    messages
  }]), true);
  const transaction = fake.calls[0].input.TransactItems;
  const transcript = dynamoDocument.valueFromItem(transaction[1].Put.Item);
  assert.equal(transcript.messages.length, 200);
  assert.equal(transcript.messages[0].seq, 3);
});

test("プレイヤー更新はstateVersionの条件付き更新にし、競合をfalseで返す", async () => {
  const fake = fakeTransport(async () => { throw conditionalError(); });
  const store = new DynamoStore(fake.transport, "table");
  const state = createInitialPlayerState();

  assert.equal(await store.savePlayer({ id: "player-1", state, stateVersion: 4 }, state), false);
  assert.equal(fake.calls[0].operation, "UpdateItem");
  assert.equal(fake.calls[0].input.ConditionExpression, "stateVersion = :expectedVersion");
  const values = dynamoDocument.valueFromItem(fake.calls[0].input.ExpressionAttributeValues);
  assert.equal(values[":expectedVersion"], 4);
  assert.equal(values[":nextVersion"], 5);
});

test("予定イベントclaimはqueuedまたは期限切れleaseだけを獲得する", async () => {
  const accepted = fakeTransport();
  const store = new DynamoStore(accepted.transport, "table");
  assert.equal(await store.claimScheduledEvent("player-1", "schedule-1"), true);
  assert.match(accepted.calls[0].input.ConditionExpression, /updatedAt <= :cutoff/u);

  const rejected = fakeTransport(async () => { throw conditionalError(); });
  assert.equal(await new DynamoStore(rejected.transport, "table").claimScheduledEvent("player-1", "schedule-1"), false);
});

test("予定イベントのfieldsはDynamoDB式で属性名を明示する", async () => {
  const fake = fakeTransport();
  await new DynamoStore(fake.transport, "table").queueScheduledEvent(
    "player-1",
    "schedule-1",
    "event-1",
    { value: "1" },
    "2026-08-14T00:00:00.000Z"
  );

  assert.match(fake.calls[0].input.UpdateExpression, /#fields = :fields/u);
  assert.equal(fake.calls[0].input.ExpressionAttributeNames["#fields"], "fields");
});

test("予定イベントは期限とleaseを評価してdue順に最大5件返す", async () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, index) => ({
      PK: "PLAYER#player-1", SK: `SCHEDULE#queued-${index}`, entityType: "SCHEDULE", scheduleId: `queued-${index}`,
      eventId: `event-${index}`, fields: { value: String(index) }, dueAt: `2026-08-13T09:0${index}:00.000Z`, status: "queued",
      updatedAt: "2026-08-13T08:00:00.000Z"
    })),
    {
      PK: "PLAYER#player-1", SK: "SCHEDULE#leased", entityType: "SCHEDULE", scheduleId: "leased",
      eventId: "event-leased", fields: {}, dueAt: "2026-08-13T08:00:00.000Z", status: "running",
      updatedAt: "2026-08-13T09:59:00.000Z"
    }
  ];
  const fake = fakeTransport(async (operation) => operation === "Query"
    ? { Items: rows.map(dynamoDocument.item) }
    : {});
  const due = await new DynamoStore(fake.transport, "table").dueScheduledEvents("player-1", "2026-08-13T10:00:00.000Z");

  assert.deepEqual(due.map((event) => event.id), ["queued-0", "queued-1", "queued-2", "queued-3", "queued-4"]);
  assert.deepEqual(due[0].fields, { value: "0" });
});

test("監修指示はtalkとfromを含む本体キーへ1件だけ保存する", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  await store.saveReviewJudgment({
    id: "judgment-1",
    scope: "branch",
    sourceEventIds: [],
    clusterId: null,
    talkId: "talk-1",
    fromId: "from-1",
    actualRuleId: "rule-1",
    expectedRuleId: null,
    judgment: "comment_only",
    comment: "確認",
    newBranchNote: "",
    reviewerLabel: "reviewer",
    scenarioRevision: "revision-1",
    status: "open",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].operation, "PutItem");
  const saved = dynamoDocument.valueFromItem(fake.calls[0].input.Item);
  assert.deepEqual([saved.PK, saved.SK], ["REVIEW#talk-1#from-1", "JUDGMENT#judgment-1"]);
  assert.equal(fake.calls[0].input.ConditionExpression, "attribute_not_exists(PK)");
});

test("監修指示の更新はtalk・from・idから直接キーを組み立てる", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  await store.updateReviewJudgment("talk-1", "from-1", "judgment-1", {
    comment: "更新",
    newBranchNote: "",
    reviewerLabel: "reviewer",
    updatedAt: "2026-08-13T01:00:00.000Z"
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].operation, "UpdateItem");
  assert.deepEqual(dynamoDocument.valueFromItem(fake.calls[0].input.Key), {
    PK: "REVIEW#talk-1#from-1",
    SK: "JUDGMENT#judgment-1"
  });
  assert.equal(fake.calls[0].input.ConditionExpression, "attribute_exists(PK)");
  assert.match(fake.calls[0].input.UpdateExpression, /#comment = :comment/u);
  assert.equal(fake.calls[0].input.ExpressionAttributeNames["#comment"], "comment");
});

test("監修クラスタは新しい項目の保存後に古い項目だけを削除する", async () => {
  const fake = fakeTransport(async (operation) => operation === "Query"
    ? { Items: [dynamoDocument.item({
      PK: "REVIEW#talk-1#from-1",
      SK: "CLUSTER#revision-1#rule-1#old"
    })] }
    : {});
  const store = new DynamoStore(fake.transport, "table");
  await store.replaceReviewClusters("talk-1", "from-1", "rule-1", "revision-1", [{
    id: "new",
    fit: "blue",
    representativeInput: "確認入力",
    sourceEventIds: ["event-1"],
    summaryJson: "{}",
    analysisVersion: "v1"
  }]);

  assert.deepEqual(fake.calls.map((call) => call.operation), ["Query", "BatchWriteItem", "BatchWriteItem"]);
  const put = fake.calls[1].input.RequestItems.table[0].PutRequest.Item;
  const saved = dynamoDocument.valueFromItem(put);
  assert.equal(saved.SK, "CLUSTER#revision-1#rule-1#new");
  assert.equal(saved.inputsJson, "[]");
  const removed = dynamoDocument.valueFromItem(fake.calls[2].input.RequestItems.table[0].DeleteRequest.Key);
  assert.equal(removed.SK, "CLUSTER#revision-1#rule-1#old");
});

test("会話ストリームは状態と同じtransactionで保存し、DynamoDB上限付近では止める", async () => {
  const normalState = createInitialPlayerState();
  assert.ok(storedPlayerStateBytes(normalState) < DYNAMO_PLAYER_STATE_WARNING_BYTES);

  const warningTranscript = {
    streamId: "search",
    transcriptKey: "search-key",
    messages: [{
      seq: 1,
    id: "large",
    requestId: "large",
    role: "user",
    body: "あ".repeat(105_000),
    sentAt: "2026-08-13T00:00:00.000Z"
    }]
  };
  assert.ok(storedTranscriptBytes(warningTranscript) > DYNAMO_PLAYER_STATE_WARNING_BYTES);
  const accepted = fakeTransport();
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await new DynamoStore(accepted.transport, "table").savePlayer(
      { id: "player-1", state: normalState, stateVersion: 0 },
      normalState,
      [warningTranscript]
    ), true);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(accepted.calls[0].operation, "TransactWriteItems");
  assert.equal(accepted.calls[0].input.TransactItems.length, 2);
  assert.equal(accepted.calls[0].input.TransactItems[0].Update.ConditionExpression, "stateVersion = :expectedVersion");

  const oversized = {
    ...warningTranscript,
    messages: [{ ...warningTranscript.messages[0], body: "あ".repeat(140_000) }]
  };
  const rejected = fakeTransport();
  await assert.rejects(
    () => new DynamoStore(rejected.transport, "table").savePlayer(
      { id: "player-1", state: normalState, stateVersion: 0 },
      normalState,
      [oversized]
    ),
    /player_transcript_too_large/u
  );
  assert.equal(rejected.calls.length, 0);
});
