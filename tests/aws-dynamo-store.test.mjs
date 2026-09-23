import assert from "node:assert/strict";
import test from "node:test";
import { DynamoStore, dynamoDocument } from "../src/platform/aws/dynamoStore.ts";
import { MAX_SEARCH_AGENT_DISPLAY_ITEMS, SEARCH_AGENT_STREAM_ID } from "../src/shared/searchAgent.ts";
import { searchAgentPlayerMessageEvent } from "../src/worker/talkEvents.ts";
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

test("DynamoDBのreset開始CASが競合したら、清掃も成功扱いもしない",async()=>{
  const fake=fakeTransport(async operation=>{
    if(operation==="UpdateItem") throw conditionalError();
    if(operation==="GetItem") return {Item:dynamoDocument.item({generation:2,resetting:false})};
    throw new Error("競合後は清掃に入ってはいけない");
  });
  const store=new DynamoStore(fake.transport,"table");
  assert.equal(await store.resetPlayerProgress({id:"p",state:createInitialPlayerState(),stateVersion:3,sessionGeneration:2,resetting:false}),false);
});

test("DynamoDBの中断resetは同じ世代の清掃だけを再開し、全chunkを条件付きで消す",async()=>{
  let root={generation:0,stateVersion:0,resetting:false,state:createInitialPlayerState()};
  let unavailable=true;
  const deleted=[];
  const fake=fakeTransport(async(operation,input)=>{
    const values=dynamoDocument.valueFromItem(input.ExpressionAttributeValues??{});
    if(operation==="UpdateItem") {
      if(input.ConditionExpression==="stateVersion = :version") {
        assert.equal(root.stateVersion,values[":version"]);
        root={...root,state:null,resetting:true,generation:values[":generation"],stateVersion:values[":nextVersion"]};
      } else {
        assert.equal(root.generation,values[":generation"]);assert.equal(root.resetting,true);
        root={...root,resetting:false,stateVersion:root.stateVersion+1};
      }
      return {};
    }
    if(operation==="Query") {
      const prefix=Object.values(values).find(value=>typeof value==="string"&&value.endsWith("#"));
      assert.ok(["SCHEDULE#","AUDIO#","TRANSCRIPT#","HOOK_LLM_RESULT#"].includes(prefix),"監修・入力logは清掃しない");
      return {Items:Array.from({length:30},(_,i)=>dynamoDocument.item({PK:"PLAYER#p",SK:`${prefix}${i}`}))};
    }
    if(operation==="TransactWriteItems") {
      if(unavailable) throw new Error("一時DB障害");
      const {ConditionCheck:guard}=input.TransactItems[0];
      assert.equal(guard.ConditionExpression,"resetting = :yes AND generation = :generation");
      assert.equal(dynamoDocument.valueFromItem(guard.ExpressionAttributeValues)[":generation"],1);
      assert.ok(input.TransactItems.length<=100);
      deleted.push(...input.TransactItems.slice(1).map(entry=>dynamoDocument.valueFromItem(entry.Delete.Key).SK));
      return {};
    }
    throw new Error(operation);
  });
  const store=new DynamoStore(fake.transport,"table");
  await assert.rejects(store.resetPlayerProgress({id:"p",...root,sessionGeneration:root.generation}),/一時DB障害/);
  assert.equal(root.resetting,true);assert.equal(root.state,null);assert.equal(root.generation,1);
  unavailable=false;
  assert.equal(await store.resetPlayerProgress({id:"p",...root,sessionGeneration:root.generation}),true);
  assert.equal(root.resetting,false);assert.equal(root.generation,1);assert.equal(deleted.length,120);
});

test("DynamoDBの遅いreset清掃は先行完了後の新プレイを削除しない",async()=>{
  const fake=fakeTransport(async(operation)=>{
    if(operation==="Query") return {Items:[dynamoDocument.item({PK:"PLAYER#p",SK:"TRANSCRIPT#new"})]};
    if(operation==="TransactWriteItems") throw conditionalError();
    if(operation==="GetItem") return {Item:dynamoDocument.item({generation:4,resetting:false,state:createInitialPlayerState()})};
    throw new Error("guard失敗後に無条件の削除・更新をしてはいけない");
  });
  const store=new DynamoStore(fake.transport,"table");
  assert.equal(await store.resetPlayerProgress({id:"p",state:null,stateVersion:8,sessionGeneration:4,resetting:true}),true);
  const tx=fake.calls.find(call=>call.operation==="TransactWriteItems").input.TransactItems;
  assert.equal(tx[0].ConditionCheck.ConditionExpression,"resetting = :yes AND generation = :generation");
});

test("DynamoDBの旧sessionはplay不可、消去中のreset再試行だけ許可する",async()=>{
  let clearing=true;
  const fake=fakeTransport(async(operation,input)=>{
    if(operation==="GetItem") {
      const key=dynamoDocument.valueFromItem(input.Key);
      return {Item:dynamoDocument.item(key.PK.startsWith("SESSION#") ? {playerId:"p",generation:1} : {generation:2,stateVersion:3,state:null,resetting:clearing})};
    }
    return {};
  });
  const store=new DynamoStore(fake.transport,"table");
  assert.equal(await store.playerForSession("old"),null);
  assert.equal((await store.playerForSession("old","reset")).resetting,true);
  clearing=false;
  assert.equal(await store.playerForSession("old","reset"),null);
});

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
  assert.equal(saved.eventType, undefined);
  assert.equal(saved.GSI1PK, "REVIEW_SOURCE");
  assert.match(saved.GSI1SK, /^INPUT#talk-1#from-1#/u);
  assert.equal(saved.GSI2PK, "INPUT_REVIEW");
  assert.match(saved.GSI2SK, /^INPUT#talk_send#/u);
});

test("DynamoDBの入力ログ確認はGSI2を時系列降順でQueryする", async () => {
  const row = {
    id: "input-1", playerId: "player-1", occurredAt: "2026-08-17T00:00:00.000Z",
    appId: null, talkId: "search_agent", fromId: "intro", userInput: "黄色い灯り", normalizedInput: "黄色い灯り",
    status: "completed", matched: true, ruleId: null, nextFromId: null, responseSnapshot: { resultCount: 1 }
  };
  const fake = fakeTransport(async (operation) => operation === "Query" ? { Items: [dynamoDocument.item(row)] } : {});
  const { items } = await new DynamoStore(fake.transport, "table").playerInputEvents({
    playerId: "player-1",
    query: "灯り",
    limit: 100
  });
  assert.equal(items[0].userInput, "黄色い灯り");
  assert.equal(items[0].appId, null);
  assert.deepEqual(items[0].responseSnapshot, { resultCount: 1 });
  assert.equal(fake.calls[0].input.IndexName, "GSI2");
  assert.equal(fake.calls[0].input.ScanIndexForward, false);
  const values = dynamoDocument.valueFromItem(fake.calls[0].input.ExpressionAttributeValues);
  assert.equal(values[":lo"], "INPUT#talk_send#");
  assert.equal(values[":hi"], "INPUT#talk_send#\uffff");
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

test("DynamoDB版は新規playerと初期scheduleを同じtransactionで作成する", async () => {
  const fake = fakeTransport(async (operation) => operation === "GetItem" ? {} : operation === "Query" ? { Items: [] } : {});
  const schedule = {
    id: "initial-schedule",
    eventId: "show_demo_call",
    fields: { source: "initial" },
    dueAt: "2099-01-01T00:00:00.000Z"
  };
  const created = await new DynamoStore(fake.transport, "table").createPasscodeSession(
    "initial-schedule-code",
    createInitialPlayerState(),
    [schedule]
  );
  assert.equal(created.created, true);
  const transaction = fake.calls.find((call) => call.operation === "TransactWriteItems").input.TransactItems;
  assert.equal(transaction.length, 3);
  const scheduleItem = dynamoDocument.valueFromItem(transaction[2].Put.Item);
  assert.equal(scheduleItem.SK, `SCHEDULE#${schedule.id}`);
  assert.equal(scheduleItem.eventId, schedule.eventId);
  assert.deepEqual(scheduleItem.fields, schedule.fields);
  assert.equal(scheduleItem.dueAt, schedule.dueAt);
  assert.equal(scheduleItem.status, "queued");
});

test("DynamoDB版はlast-seen更新失敗でghost sessionを作らず取得済みplayerを返す", async () => {
  let getCount = 0;
  const fake = fakeTransport(async (operation) => {
    if (operation === "GetItem") {
      getCount += 1;
      return getCount === 1
        ? { Item: dynamoDocument.item({ playerId: "player-1" }) }
        : { Item: dynamoDocument.item({ state: createInitialPlayerState(), stateVersion: 3 }) };
    }
    if (operation === "UpdateItem") throw new Error("last_seen_failed");
    return {};
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const player = await new DynamoStore(fake.transport, "table").playerForSession("session-token");
    assert.equal(player?.id, "player-1");
    assert.equal(player?.stateVersion, 3);
    const update = fake.calls.find((call) => call.operation === "UpdateItem");
    assert.equal(update.input.ConditionExpression, "attribute_exists(PK)");
  } finally {
    console.error = originalConsoleError;
  }
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

test("DynamoDB版search agent履歴もtalk単位itemで直近200表示eventへ制限する", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  const state = createInitialPlayerState();
  const messages = Array.from({ length: 202 }, (_, index) => searchAgentPlayerMessageEvent({
    id: `search-${index + 1}`,
    seq: index + 1,
    body: "検索",
    deliveredAt: "2026-08-17T00:00:01.000Z"
  }));
  assert.equal(await store.savePlayer({ id: "player-1", state, stateVersion: 1 }, state, [{
    streamId: SEARCH_AGENT_STREAM_ID,
    transcriptKey: "search-agent-key",
    messages
  }]), true);
  const transaction = fake.calls.find((call) => call.operation === "TransactWriteItems").input.TransactItems;
  const transcript = dynamoDocument.valueFromItem(transaction[1].Put.Item);
  assert.equal(transcript.streamId, SEARCH_AGENT_STREAM_ID);
  assert.equal(transcript.messages.length, MAX_SEARCH_AGENT_DISPLAY_ITEMS);
  assert.equal(transcript.messages[0].seq, 3);
  assert.equal(transcript.messages.at(-1).seq, 202);
});

test("DynamoDB版talk履歴はNPC本文を展開せずblock参照のcompact eventを保存する", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  const state = createInitialPlayerState();
  const events = [{
    id: "sms_block_turn_1",
    kind: "sms",
    talk_id: "guide",
    event_type: "message_block",
    body: null,
    block_id: "guide::message_reply",
    format_env_json: JSON.stringify({ player_name: "田中" }),
    delivered_at: "2026-08-20T00:00:01.000Z"
  }];
  assert.equal(await store.savePlayer({ id: "player-1", state, stateVersion: 1 }, state, [{
    streamId: "talk:guide",
    transcriptKey: "talk-key",
    messages: events,
    resolvedMessages: [{ body: "展開済み本文を保存してはいけない" }]
  }]), true);
  const transaction = fake.calls.find((call) => call.operation === "TransactWriteItems").input.TransactItems;
  const transcript = dynamoDocument.valueFromItem(transaction[1].Put.Item);
  assert.deepEqual(transcript.messages, events);
  assert.equal(JSON.stringify(transcript).includes("展開済み本文を保存してはいけない"), false);
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
  const instance = JSON.stringify(["schedule-1", "instance-1"]);
  assert.equal(await store.claimScheduledEvent("player-1", instance), true);
  assert.match(accepted.calls[0].input.ConditionExpression, /updatedAt <= :cutoff/u);
  assert.match(accepted.calls[0].input.ConditionExpression, /instanceId = :instance/u);

  const rejected = fakeTransport(async () => { throw conditionalError(); });
  assert.equal(await new DynamoStore(rejected.transport, "table").claimScheduledEvent("player-1", instance), false);
});

test("DynamoDB版hook LLM cacheは同じplayer partitionとTTL属性を使う", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  const record = {
    cacheKey: "cache-key",
    taskId: "task",
    kind: "match",
    modelVersion: "fast:model:none",
    inputHash: "input",
    promptHash: "prompt",
    schemaHash: "schema",
    status: "fallback",
    output: { value: "fallback" },
    errorCode: "provider_error",
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
  assert.deepEqual(await store.saveHookLlmResultIfAbsent("player-1", record), record);
  const put = fake.calls.find((call) => call.operation === "PutItem");
  const item = dynamoDocument.valueFromItem(put.input.Item);
  assert.equal(item.PK, "PLAYER#player-1");
  assert.equal(item.SK, "HOOK_LLM_RESULT#cache-key");
  assert.equal(item.expiresAtEpoch, Math.floor(Date.parse(record.expiresAt) / 1_000));
  assert.equal(
    put.input.ConditionExpression,
    "attribute_not_exists(PK) OR attribute_not_exists(expiresAt) OR expiresAt <= :now"
  );
  const values = dynamoDocument.valueFromItem(put.input.ExpressionAttributeValues);
  assert.match(values[":now"], /^\d{4}-\d{2}-\d{2}T/u);
});

test("DynamoDB版もscheduleと生成音声intentをstate CAS transactionへ含める", async () => {
  const fake = fakeTransport();
  const store = new DynamoStore(fake.transport, "table");
  const state = createInitialPlayerState();
  const audioJob = {
    id: "audio-job",
    audioId: "demo_voice",
    provider: "static",
    externalJobId: null,
    inputHash: "hash",
    inputText: "入力",
    outputKey: null,
    status: "queued",
    errorCode: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    completedAt: null
  };
  assert.equal(await store.savePlayer({ id: "player-1", state, stateVersion: 1 }, state, [], {
    schedules: [{ type: "queue", id: "schedule", eventId: "show_demo_call", fields: {}, dueAt: "2099-01-01T00:00:00.000Z" }],
    generatedAudioJobs: [audioJob]
  }), true);
  const transaction = fake.calls.find((call) => call.operation === "TransactWriteItems").input.TransactItems;
  assert.equal(transaction.length, 3);
  assert.equal(dynamoDocument.valueFromItem(transaction[1].Update.Key).SK, "SCHEDULE#schedule");
  assert.equal(dynamoDocument.valueFromItem(transaction[2].Put.Item).inputText, "入力");
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
      instanceId: `instance-${index}`, eventId: `event-${index}`, fields: { value: String(index) }, dueAt: `2026-08-13T09:0${index}:00.000Z`, status: "queued",
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

  assert.deepEqual(due.map((event) => event.id), Array.from({length:5}, (_, index) => JSON.stringify([`queued-${index}`,`instance-${index}`])));
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
  assert.equal(fake.calls[0].input.ConditionExpression, "attribute_exists(PK) AND #guardStatus = :guardOpen");
  assert.equal(fake.calls[0].input.ExpressionAttributeNames["#guardStatus"], "status");
  assert.equal(dynamoDocument.valueFromItem(fake.calls[0].input.ExpressionAttributeValues)[":guardOpen"], "open");
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
    streamId: "talk:large-test",
    transcriptKey: "large-talk-key",
    messages: [{
      id: "large",
      kind: "sms",
      talk_id: "large-test",
      event_type: "player_message",
      body: "あ".repeat(105_000),
      block_id: null,
      format_env_json: null,
      delivered_at: "2026-08-13T00:00:00.000Z"
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
  const acceptedTransaction = accepted.calls.find((call) => call.operation === "TransactWriteItems");
  assert.equal(acceptedTransaction.input.TransactItems.length, 2);
  assert.equal(acceptedTransaction.input.TransactItems[0].Update.ConditionExpression, "stateVersion = :expectedVersion");

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
