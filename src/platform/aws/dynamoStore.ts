import type {
  AppStore,
  GeneratedAudioJob,
  InputEventRecord,
  PlayerInputReviewEvent,
  PlayerRecord,
  ReviewCluster,
  ReviewClusterReplacement,
  ReviewInputEvent,
  ReviewJudgment,
  ReviewJudgmentFilter,
  ReviewJudgmentStatus,
  ReviewTrialInput,
  ScheduledEvent,
  StoredPlayerState,
  StoredTranscript,
  TranscriptUpdate
} from "../../server/store.ts";
import { ACCESS_CODE_ATTEMPT_WINDOW_MS, ACCESS_CODE_MAX_FAILED_ATTEMPTS } from "../../server/accessCode.ts";
import {
  DYNAMO_PLAYER_STATE_WARNING_BYTES,
  MAX_SESSIONS_PER_PLAYER,
  limitedTranscript,
  normalizeStoredState,
  nowIso,
  scheduledEventLeaseCutoff,
  scheduledEventLeaseWakeAt,
  sha256,
  storedPlayerStateBytes,
  storedTranscriptBytes
} from "../../server/store.ts";

type AttributeValue = {
  S?: string;
  N?: string;
  BOOL?: boolean;
  NULL?: boolean;
  L?: AttributeValue[];
  M?: Record<string, AttributeValue>;
};

type DynamoItem = Record<string, AttributeValue>;
type BatchWriteRequest =
  | { DeleteRequest: { Key: DynamoItem } }
  | { PutRequest: { Item: DynamoItem } };
type DynamoResult = {
  Item?: DynamoItem;
  Items?: DynamoItem[];
  LastEvaluatedKey?: DynamoItem;
  UnprocessedItems?: Record<string, BatchWriteRequest[]>;
};

export interface DynamoTransport {
  execute(operation: string, input: Record<string, unknown>): Promise<DynamoResult>;
}

const PLAYER_STATE_HARD_LIMIT_BYTES = 380 * 1024;

function attribute(value: unknown): AttributeValue {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(attribute) };
  return { M: item(value as Record<string, unknown>) };
}

function item(value: Record<string, unknown>): DynamoItem {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, attribute(entry)]));
}

function valueFromAttribute(value: AttributeValue): unknown {
  if (value.S !== undefined) return value.S;
  if (value.N !== undefined) return Number(value.N);
  if (value.BOOL !== undefined) return value.BOOL;
  if (value.NULL) return null;
  if (value.L) return value.L.map(valueFromAttribute);
  if (value.M) return valueFromItem(value.M);
  return undefined;
}

function valueFromItem(value: DynamoItem) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, valueFromAttribute(entry)]));
}

function recordFromItem(value: DynamoItem | undefined) {
  return value ? valueFromItem(value) : null;
}

function conditionalFailure(error: unknown) {
  return error instanceof Error && (
    error.name === "ConditionalCheckFailedException"
    || error.name === "TransactionCanceledException"
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function playerPk(playerId: string) {
  return `PLAYER#${playerId}`;
}

function reviewPk(talkId: string, fromId: string) {
  return `REVIEW#${talkId}#${fromId}`;
}

export class DynamoStore implements AppStore {
  readonly transport: DynamoTransport;
  readonly tableName: string;

  constructor(
    transport: DynamoTransport,
    tableName: string
  ) {
    this.transport = transport;
    this.tableName = tableName;
  }

  private async get(pk: string, sk: string) {
    const result = await this.transport.execute("GetItem", {
      TableName: this.tableName,
      Key: item({ PK: pk, SK: sk }),
      ConsistentRead: true
    });
    return recordFromItem(result.Item);
  }

  private async queryPk(pk: string, skPrefix?: string) {
    const records: Record<string, unknown>[] = [];
    let startKey: DynamoItem | undefined;
    do {
      const names: Record<string, string> = { "#pk": "PK" };
      const values: DynamoItem = { ":pk": attribute(pk) };
      let condition = "#pk = :pk";
      if (skPrefix) {
        names["#sk"] = "SK";
        values[":sk"] = attribute(skPrefix);
        condition += " AND begins_with(#sk, :sk)";
      }
      const result = await this.transport.execute("Query", {
        TableName: this.tableName,
        ConsistentRead: true,
        KeyConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ...(startKey ? { ExclusiveStartKey: startKey } : {})
      });
      records.push(...(result.Items ?? []).map(valueFromItem));
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return records;
  }

  private async queryGsi(gsiPk: string, skPrefix?: string) {
    const records: Record<string, unknown>[] = [];
    let startKey: DynamoItem | undefined;
    do {
      const names: Record<string, string> = { "#pk": "GSI1PK" };
      const values: DynamoItem = { ":pk": attribute(gsiPk) };
      let condition = "#pk = :pk";
      if (skPrefix) {
        names["#sk"] = "GSI1SK";
        values[":sk"] = attribute(skPrefix);
        condition += " AND begins_with(#sk, :sk)";
      }
      const result = await this.transport.execute("Query", {
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ...(startKey ? { ExclusiveStartKey: startKey } : {})
      });
      records.push(...(result.Items ?? []).map(valueFromItem));
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return records;
  }

  private async batchWrite(allRequests: BatchWriteRequest[]) {
    for (let offset = 0; offset < allRequests.length; offset += 25) {
      let requests = allRequests.slice(offset, offset + 25);
      for (let attempt = 0; requests.length; attempt += 1) {
        const result = await this.transport.execute("BatchWriteItem", {
          RequestItems: { [this.tableName]: requests }
        });
        requests = result.UnprocessedItems?.[this.tableName] ?? [];
        if (!requests.length) break;
        if (attempt >= 2) throw new Error("dynamodb_batch_delete_incomplete");
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }

  private async deleteKeys(keys: Array<{ PK: string; SK: string }>) {
    await this.batchWrite(keys.map((key) => ({ DeleteRequest: { Key: item(key) } })));
  }

  async createPasscodeSession(accessCode: string, initialState: StoredPlayerState) {
    const accessCodeHash = await sha256(`xstoryphone:access-code:v1:${accessCode}`);
    const accessPk = `ACCESS#${accessCodeHash}`;
    let access = await this.get(accessPk, "META");
    let created = false;
    if (!access) {
      const playerId = crypto.randomUUID();
      const now = nowIso();
      try {
        await this.transport.execute("TransactWriteItems", {
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: item({ PK: accessPk, SK: "META", entityType: "ACCESS", playerId }),
                ConditionExpression: "attribute_not_exists(PK)"
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: item({
                  PK: playerPk(playerId),
                  SK: "STATE",
                  entityType: "PLAYER",
                  playerId,
                  state: initialState,
                  stateVersion: 0,
                  createdAt: now,
                  updatedAt: now
                }),
                ConditionExpression: "attribute_not_exists(PK)"
              }
            }
          ]
        });
        access = { playerId };
        created = true;
      } catch (error) {
        if (!conditionalFailure(error)) throw error;
        access = await this.get(accessPk, "META");
        if (!access) throw error;
      }
    }

    const playerId = stringValue(access.playerId);
    const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/gu, "");
    const tokenHash = await sha256(sessionToken);
    const now = nowIso();
    await this.transport.execute("PutItem", {
      TableName: this.tableName,
      Item: item({
        PK: `SESSION#${tokenHash}`,
        SK: "META",
        entityType: "SESSION",
        playerId,
        tokenHash,
        createdAt: now,
        lastSeenAt: now,
        GSI1PK: playerPk(playerId),
        GSI1SK: `SESSION#${now}#${tokenHash}`
      }),
      ConditionExpression: "attribute_not_exists(PK)"
    });
    await this.prunePlayerSessions(playerId, tokenHash)
      .catch((error) => console.error("[sessions:prune]", error));
    return { playerId, sessionToken, created };
  }

  async isAccessCodeLocked(counter: string, at: string) {
    const current = await this.get(`ACCESS_ATTEMPT#${counter}`, "META");
    const lockedUntil = stringValue(current?.lockedUntil);
    return Boolean(lockedUntil && Date.parse(lockedUntil) > Date.parse(at));
  }

  async recordAccessCodeAttempt(counter: string, success: boolean, at: string) {
    const key = item({ PK: `ACCESS_ATTEMPT#${counter}`, SK: "META" });
    if (success) {
      await this.transport.execute("DeleteItem", { TableName: this.tableName, Key: key });
      return;
    }
    const current = await this.get(`ACCESS_ATTEMPT#${counter}`, "META");
    const atMs = Date.parse(at);
    const updatedAt = stringValue(current?.updatedAt);
    const withinWindow = updatedAt && atMs - Date.parse(updatedAt) < ACCESS_CODE_ATTEMPT_WINDOW_MS;
    const failedCount = withinWindow ? Number(current?.failedCount ?? 0) + 1 : 1;
    const lockedUntil = failedCount >= ACCESS_CODE_MAX_FAILED_ATTEMPTS
      ? new Date(atMs + ACCESS_CODE_ATTEMPT_WINDOW_MS).toISOString()
      : null;
    await this.transport.execute("PutItem", {
      TableName: this.tableName,
      Item: item({
        PK: `ACCESS_ATTEMPT#${counter}`,
        SK: "META",
        entityType: "ACCESS_ATTEMPT",
        failedCount,
        lockedUntil,
        updatedAt: at
      })
    });
  }

  private async prunePlayerSessions(playerId: string, currentTokenHash: string) {
    const sessions = (await this.queryGsi(playerPk(playerId), "SESSION#"))
      .sort((left, right) => stringValue(right.lastSeenAt).localeCompare(stringValue(left.lastSeenAt)));
    const stale = sessions
      .filter((session) => session.tokenHash !== currentTokenHash)
      .slice(MAX_SESSIONS_PER_PLAYER - 1)
      .map((session) => ({ PK: stringValue(session.PK), SK: "META" }));
    await this.deleteKeys(stale);
  }

  async playerForSession(sessionToken: string): Promise<PlayerRecord | null> {
    const tokenHash = await sha256(sessionToken);
    const session = await this.get(`SESSION#${tokenHash}`, "META");
    if (!session) return null;
    const playerId = stringValue(session.playerId);
    const row = await this.get(playerPk(playerId), "STATE");
    if (!row) return null;
    const now = nowIso();
    await this.transport.execute("UpdateItem", {
      TableName: this.tableName,
      Key: item({ PK: `SESSION#${tokenHash}`, SK: "META" }),
      UpdateExpression: "SET lastSeenAt = :now, GSI1SK = :gsi",
      ExpressionAttributeValues: item({ ":now": now, ":gsi": `SESSION#${now}#${tokenHash}` })
    });
    return {
      id: playerId,
      state: normalizeStoredState(row.state as StoredPlayerState),
      stateVersion: Number(row.stateVersion)
    };
  }

  async loadTranscript(playerId: string, streamId: string, transcriptKey: string): Promise<StoredTranscript> {
    const row = await this.get(playerPk(playerId), `TRANSCRIPT#${streamId}`);
    if (!row || row.transcriptKey !== transcriptKey) {
      return { streamId, transcriptKey, messages: [] };
    }
    return limitedTranscript({
      streamId,
      transcriptKey,
      messages: Array.isArray(row.messages) ? row.messages as StoredTranscript["messages"] : []
    });
  }

  async savePlayer(player: PlayerRecord, nextState: StoredPlayerState, transcripts: TranscriptUpdate[] = []) {
    transcripts = transcripts.map(limitedTranscript);
    const bytes = storedPlayerStateBytes(nextState);
    if (bytes > PLAYER_STATE_HARD_LIMIT_BYTES) {
      throw new Error(`player_state_too_large:${bytes}`);
    }
    if (bytes > DYNAMO_PLAYER_STATE_WARNING_BYTES) {
      console.warn("[player_state:size_warning]", { playerId: player.id, bytes });
    }
    for (const transcript of transcripts) {
      const transcriptBytes = storedTranscriptBytes(transcript);
      if (transcriptBytes > PLAYER_STATE_HARD_LIMIT_BYTES) {
        throw new Error(`player_transcript_too_large:${transcript.streamId}:${transcriptBytes}`);
      }
      if (transcriptBytes > DYNAMO_PLAYER_STATE_WARNING_BYTES) {
        console.warn("[player_transcript:size_warning]", { playerId: player.id, streamId: transcript.streamId, bytes: transcriptBytes });
      }
    }
    try {
      const now = nowIso();
      if (transcripts.length) {
        if (transcripts.length > 99) throw new Error("player_transcript_updates_too_many");
        await this.transport.execute("TransactWriteItems", {
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: item({ PK: playerPk(player.id), SK: "STATE" }),
                UpdateExpression: "SET #state = :state, stateVersion = :nextVersion, updatedAt = :now",
                ConditionExpression: "stateVersion = :expectedVersion",
                ExpressionAttributeNames: { "#state": "state" },
                ExpressionAttributeValues: item({
                  ":state": nextState,
                  ":nextVersion": player.stateVersion + 1,
                  ":expectedVersion": player.stateVersion,
                  ":now": now
                })
              }
            },
            ...transcripts.map((transcript) => ({
              Put: {
                TableName: this.tableName,
                Item: item({
                  PK: playerPk(player.id),
                  SK: `TRANSCRIPT#${transcript.streamId}`,
                  entityType: "TRANSCRIPT",
                  streamId: transcript.streamId,
                  transcriptKey: transcript.transcriptKey,
                  messages: transcript.messages,
                  updatedAt: now
                })
              }
            }))
          ]
        });
      } else {
        await this.transport.execute("UpdateItem", {
          TableName: this.tableName,
          Key: item({ PK: playerPk(player.id), SK: "STATE" }),
          UpdateExpression: "SET #state = :state, stateVersion = :nextVersion, updatedAt = :now",
          ConditionExpression: "stateVersion = :expectedVersion",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: item({
            ":state": nextState,
            ":nextVersion": player.stateVersion + 1,
            ":expectedVersion": player.stateVersion,
            ":now": now
          })
        });
      }
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  async clearPlayerRuntimeJobs(playerId: string) {
    const rows = [
      ...await this.queryPk(playerPk(playerId), "SCHEDULE#"),
      ...await this.queryPk(playerPk(playerId), "AUDIO#")
    ];
    await this.deleteKeys(rows
      .map((row) => ({ PK: stringValue(row.PK), SK: stringValue(row.SK) })));
  }

  async queueScheduledEvent(playerId: string, scheduleId: string, eventId: string, fields: Record<string, string>, dueAt: string) {
    const now = nowIso();
    try {
      await this.transport.execute("UpdateItem", {
        TableName: this.tableName,
        Key: item({ PK: playerPk(playerId), SK: `SCHEDULE#${scheduleId}` }),
        UpdateExpression: "SET entityType = :entity, scheduleId = :scheduleId, eventId = :eventId, #fields = :fields, dueAt = :dueAt, #status = :queued, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)",
        ConditionExpression: "attribute_not_exists(#status) OR #status <> :completed",
        ExpressionAttributeNames: { "#fields": "fields", "#status": "status" },
        ExpressionAttributeValues: item({
          ":entity": "SCHEDULE", ":scheduleId": scheduleId, ":eventId": eventId, ":fields": fields,
          ":dueAt": dueAt, ":queued": "queued", ":completed": "completed", ":now": now
        })
      });
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async cancelScheduledEvent(playerId: string, scheduleId: string) {
    try {
      await this.transport.execute("UpdateItem", {
        TableName: this.tableName,
        Key: item({ PK: playerPk(playerId), SK: `SCHEDULE#${scheduleId}` }),
        UpdateExpression: "SET #status = :canceled, updatedAt = :now",
        ConditionExpression: "#status = :queued OR #status = :running",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: item({ ":canceled": "canceled", ":queued": "queued", ":running": "running", ":now": nowIso() })
      });
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async nextScheduledWakeAt(playerId: string) {
    const rows = await this.queryPk(playerPk(playerId), "SCHEDULE#");
    const wakeTimes = rows
      .filter((row) => row.status === "queued" || row.status === "running")
      .map((row) => row.status === "running"
        ? scheduledEventLeaseWakeAt(stringValue(row.updatedAt))
        : stringValue(row.dueAt));
    return wakeTimes.sort()[0] ?? null;
  }

  async dueScheduledEvents(playerId: string, at: string): Promise<ScheduledEvent[]> {
    const leaseCutoff = scheduledEventLeaseCutoff(at);
    return (await this.queryPk(playerPk(playerId), "SCHEDULE#"))
      .filter((row) => stringValue(row.dueAt) <= at && (
        row.status === "queued" || (row.status === "running" && stringValue(row.updatedAt) <= leaseCutoff)
      ))
      .sort((left, right) => stringValue(left.dueAt).localeCompare(stringValue(right.dueAt)))
      .slice(0, 5)
      .map((row) => ({
        id: stringValue(row.scheduleId),
        scheduleId: stringValue(row.scheduleId),
        eventId: stringValue(row.eventId),
        fields: row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)
          ? Object.fromEntries(Object.entries(row.fields).map(([key, value]) => [key, String(value)]))
          : {}
      }));
  }

  async claimScheduledEvent(playerId: string, id: string) {
    const now = nowIso();
    try {
      await this.transport.execute("UpdateItem", {
        TableName: this.tableName,
        Key: item({ PK: playerPk(playerId), SK: `SCHEDULE#${id}` }),
        UpdateExpression: "SET #status = :running, updatedAt = :now",
        ConditionExpression: "#status = :queued OR (#status = :running AND updatedAt <= :cutoff)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: item({
          ":running": "running", ":queued": "queued", ":now": now, ":cutoff": scheduledEventLeaseCutoff(now)
        })
      });
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  async completeScheduledEvent(playerId: string, id: string) {
    await this.updateScheduleStatus(playerId, id, "completed");
  }

  async requeueScheduledEvent(playerId: string, id: string) {
    await this.updateScheduleStatus(playerId, id, "queued");
  }

  private async updateScheduleStatus(playerId: string, id: string, status: "completed" | "queued") {
    try {
      await this.transport.execute("UpdateItem", {
        TableName: this.tableName,
        Key: item({ PK: playerPk(playerId), SK: `SCHEDULE#${id}` }),
        UpdateExpression: "SET #status = :status, updatedAt = :now",
        ConditionExpression: "#status = :running",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: item({ ":status": status, ":running": "running", ":now": nowIso() })
      });
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async recordInputEvent(event: InputEventRecord, enabled: boolean) {
    if (!enabled) return;
    const occurredAt = nowIso();
    try {
      await this.transport.execute("PutItem", {
        TableName: this.tableName,
        Item: item({
          PK: playerPk(event.playerId),
          SK: `INPUT#${event.eventType}#${event.requestKey}`,
          entityType: "INPUT",
          id: crypto.randomUUID(),
          ...event,
          normalizedInput: event.userInput.normalize("NFC").trim().toLocaleLowerCase("ja"),
          occurredAt,
          GSI2PK: "INPUT_REVIEW",
          GSI2SK: `INPUT#${event.eventType}#${occurredAt}#${event.requestKey}`,
          ...(event.talkId && event.fromId ? {
            GSI1PK: "REVIEW_SOURCE",
            GSI1SK: `INPUT#${event.talkId}#${event.fromId}#${occurredAt}#${event.requestKey}`
          } : {})
        }),
        ConditionExpression: "attribute_not_exists(PK)"
      });
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async playerInputEvents(filters: {
    eventType?: "search" | "talk_send";
    playerId?: string;
    talkId?: string;
    query?: string;
    limit: number;
  }): Promise<PlayerInputReviewEvent[]> {
    const rows: Record<string, unknown>[] = [];
    const normalizedQuery = filters.query?.normalize("NFC").trim().toLocaleLowerCase("ja");
    let startKey: DynamoItem | undefined;
    const prefix = filters.eventType ? `INPUT#${filters.eventType}#` : "INPUT#";
    do {
      const result = await this.transport.execute("Query", {
        TableName: this.tableName,
        IndexName: "GSI2",
        KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
        ExpressionAttributeNames: { "#pk": "GSI2PK", "#sk": "GSI2SK" },
        ExpressionAttributeValues: item({ ":pk": "INPUT_REVIEW", ":sk": prefix }),
        ScanIndexForward: false,
        Limit: Math.max(50, Math.min(500, filters.limit * 2)),
        ...(startKey ? { ExclusiveStartKey: startKey } : {})
      });
      for (const row of (result.Items ?? []).map(valueFromItem)) {
        const matches = (!filters.playerId || stringValue(row.playerId) === filters.playerId)
          && (!filters.talkId || stringValue(row.talkId) === filters.talkId)
          && (!normalizedQuery || stringValue(row.normalizedInput).includes(normalizedQuery));
        if (matches) rows.push(row);
        if (rows.length >= filters.limit) break;
      }
      startKey = result.LastEvaluatedKey;
    } while (startKey && rows.length < filters.limit);
    return rows.slice(0, filters.limit).map((row) => ({
      id: stringValue(row.id),
      eventType: row.eventType as "search" | "talk_send",
      playerId: stringValue(row.playerId),
      occurredAt: stringValue(row.occurredAt),
      appId: stringValue(row.appId),
      talkId: nullableString(row.talkId),
      fromId: nullableString(row.fromId),
      userInput: stringValue(row.userInput),
      status: stringValue(row.status),
      matched: row.matched === true,
      ruleId: nullableString(row.ruleId),
      nextFromId: nullableString(row.nextFromId),
      responseSnapshot: row.responseSnapshot && typeof row.responseSnapshot === "object" && !Array.isArray(row.responseSnapshot)
        ? row.responseSnapshot as Record<string, unknown>
        : {}
    }));
  }

  async generatedAudioJob(playerId: string, audioId: string) {
    const row = await this.get(playerPk(playerId), `AUDIO#${audioId}`);
    return row ? this.audioFrom(row) : null;
  }

  async saveGeneratedAudioJob(playerId: string, job: GeneratedAudioJob) {
    await this.transport.execute("PutItem", {
      TableName: this.tableName,
      Item: item({ PK: playerPk(playerId), SK: `AUDIO#${job.audioId}`, entityType: "AUDIO", ...job, updatedAt: nowIso() })
    });
  }

  async pendingGeneratedAudioJobs(playerId: string) {
    return (await this.generatedAudioJobs(playerId)).filter((job) => job.status === "queued" || job.status === "running");
  }

  async generatedAudioJobs(playerId: string) {
    return (await this.queryPk(playerPk(playerId), "AUDIO#")).map((row) => this.audioFrom(row));
  }

  private audioFrom(row: Record<string, unknown>): GeneratedAudioJob {
    return {
      id: stringValue(row.id),
      audioId: stringValue(row.audioId),
      provider: stringValue(row.provider),
      externalJobId: nullableString(row.externalJobId),
      inputHash: stringValue(row.inputHash),
      outputKey: nullableString(row.outputKey),
      status: row.status as GeneratedAudioJob["status"],
      errorCode: nullableString(row.errorCode),
      createdAt: stringValue(row.createdAt),
      completedAt: nullableString(row.completedAt)
    };
  }

  async reviewJudgments(filter: ReviewJudgmentFilter) {
    const talkId = "talkId" in filter ? filter.talkId : undefined;
    const fromId = "fromId" in filter ? filter.fromId : undefined;
    const rows = talkId && fromId
      ? await this.queryPk(reviewPk(talkId, fromId), "JUDGMENT#")
      : await this.queryGsi(`REVIEW_JUDGMENT#${filter.status}`);
    return rows
      .map((row) => this.judgmentFrom(row))
      .filter((row) => (!talkId || row.talkId === talkId)
        && (!fromId || row.fromId === fromId)
        && (!filter.status || row.status === filter.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private judgmentFrom(row: Record<string, unknown>): ReviewJudgment {
    return {
      id: stringValue(row.id),
      scope: stringValue(row.scope),
      sourceEventIds: stringArray(row.sourceEventIds),
      clusterId: nullableString(row.clusterId),
      talkId: stringValue(row.talkId),
      fromId: stringValue(row.fromId),
      actualRuleId: nullableString(row.actualRuleId),
      expectedRuleId: nullableString(row.expectedRuleId),
      judgment: stringValue(row.judgment),
      comment: stringValue(row.comment),
      newBranchNote: stringValue(row.newBranchNote),
      reviewerLabel: stringValue(row.reviewerLabel),
      scenarioRevision: stringValue(row.scenarioRevision),
      status: row.status as ReviewJudgmentStatus,
      createdAt: stringValue(row.createdAt),
      updatedAt: stringValue(row.updatedAt)
    };
  }

  async reviewInputEvents(talkId: string, fromId: string): Promise<ReviewInputEvent[]> {
    return (await this.queryGsi("REVIEW_SOURCE", `INPUT#${talkId}#${fromId}#`))
      .sort((left, right) => stringValue(right.occurredAt).localeCompare(stringValue(left.occurredAt)))
      .slice(0, 1000)
      .map((row) => ({
        id: stringValue(row.id),
        ruleId: stringValue(row.ruleId),
        userInput: stringValue(row.userInput),
        normalizedInput: stringValue(row.normalizedInput)
      }));
  }

  async reviewTrialInputs(talkId: string, fromId: string): Promise<ReviewTrialInput[]> {
    return (await this.queryPk(reviewPk(talkId, fromId), "TRIAL#"))
      .filter((row) => row.status === "active")
      .sort((left, right) => stringValue(right.createdAt).localeCompare(stringValue(left.createdAt)))
      .slice(0, 500)
      .map((row) => ({ id: stringValue(row.id), actualRuleId: stringValue(row.actualRuleId), userInput: stringValue(row.userInput) }));
  }

  async reviewClusters(talkId: string, fromId: string, scenarioRevision: string): Promise<ReviewCluster[]> {
    return (await this.queryPk(reviewPk(talkId, fromId), `CLUSTER#${scenarioRevision}#`))
      .map((row) => ({
        id: stringValue(row.id),
        actualRuleId: stringValue(row.actualRuleId),
        fit: row.fit as ReviewCluster["fit"],
        representativeInput: stringValue(row.representativeInput),
        inputCount: Number(row.inputCount),
        sourceEventIds: stringArray(row.sourceEventIds),
        inputsJson: stringValue(row.inputsJson)
      }))
      .sort((left, right) => right.inputCount - left.inputCount);
  }

  async replaceReviewClusters(
    talkId: string,
    fromId: string,
    actualRuleId: string,
    scenarioRevision: string,
    clusters: ReviewClusterReplacement[]
  ) {
    const pk = reviewPk(talkId, fromId);
    const prefix = `CLUSTER#${scenarioRevision}#${actualRuleId}#`;
    const previous = await this.queryPk(pk, prefix);
    const now = nowIso();
    const nextItems = clusters.map((cluster) => ({
      PK: pk,
      SK: `${prefix}${cluster.id}`,
      entityType: "CLUSTER",
      actualRuleId,
      fit: cluster.fit,
      representativeInput: cluster.representativeInput,
      inputCount: cluster.sourceEventIds.length,
      sourceEventIds: cluster.sourceEventIds,
      inputsJson: "[]",
      summaryJson: cluster.summaryJson,
      analysisVersion: cluster.analysisVersion,
      scenarioRevision,
      createdAt: now,
      updatedAt: now
    }));
    await this.batchWrite(nextItems.map((row) => ({ PutRequest: { Item: item(row) } })));
    const nextKeys = new Set(nextItems.map((row) => row.SK));
    await this.deleteKeys(previous
      .filter((row) => !nextKeys.has(stringValue(row.SK)))
      .map((row) => ({ PK: pk, SK: stringValue(row.SK) })));
  }

  async saveReviewTrialInput(input: {
    id: string;
    talkId: string;
    fromId: string;
    actualRuleId: string;
    userInput: string;
    nextFromId: string;
    responseSnapshot: Record<string, unknown>;
    createdAt: string;
  }) {
    await this.transport.execute("PutItem", {
      TableName: this.tableName,
      Item: item({
        PK: reviewPk(input.talkId, input.fromId), SK: `TRIAL#${input.id}`, entityType: "TRIAL",
        ...input, status: "active", updatedAt: input.createdAt,
        GSI1PK: "REVIEW_SOURCE",
        GSI1SK: `TRIAL#${input.talkId}#${input.fromId}#${input.createdAt}#${input.id}`
      })
    });
  }

  async saveReviewJudgment(judgment: ReviewJudgment) {
    await this.transport.execute("PutItem", {
      TableName: this.tableName,
      Item: item({
        PK: reviewPk(judgment.talkId, judgment.fromId), SK: `JUDGMENT#${judgment.id}`,
        entityType: "JUDGMENT",
        GSI1PK: `REVIEW_JUDGMENT#${judgment.status}`,
        GSI1SK: `${judgment.createdAt}#${judgment.id}`,
        ...judgment
      }),
      ConditionExpression: "attribute_not_exists(PK)"
    });
  }

  private async updateReviewJudgmentItem(
    talkId: string,
    fromId: string,
    id: string,
    input: Record<string, unknown>
  ) {
    try {
      await this.transport.execute("UpdateItem", {
        TableName: this.tableName,
        Key: item({ PK: reviewPk(talkId, fromId), SK: `JUDGMENT#${id}` }),
        ConditionExpression: "attribute_exists(PK)",
        ...input
      });
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async updateReviewJudgment(talkId: string, fromId: string, id: string, input: { comment: string; newBranchNote: string; reviewerLabel: string; updatedAt: string }) {
    await this.updateReviewJudgmentItem(talkId, fromId, id, {
      UpdateExpression: "SET #comment = :comment, newBranchNote = :note, reviewerLabel = :label, updatedAt = :now",
      ExpressionAttributeNames: { "#comment": "comment" },
      ExpressionAttributeValues: item({
        ":comment": input.comment, ":note": input.newBranchNote, ":label": input.reviewerLabel, ":now": input.updatedAt
      })
    });
  }

  async updateReviewJudgmentStatus(talkId: string, fromId: string, id: string, status: ReviewJudgmentStatus, updatedAt: string) {
    await this.updateReviewJudgmentItem(talkId, fromId, id, {
      UpdateExpression: "SET #status = :status, GSI1PK = :gsi, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: item({ ":status": status, ":gsi": `REVIEW_JUDGMENT#${status}`, ":now": updatedAt })
    });
  }

  async deleteReviewTrialInput(talkId: string, fromId: string, id: string, updatedAt: string) {
    try {
      await this.transport.execute("UpdateItem", {
        TableName: this.tableName,
        Key: item({ PK: reviewPk(talkId, fromId), SK: `TRIAL#${id}` }),
        UpdateExpression: "SET #status = :deleted, updatedAt = :now",
        ConditionExpression: "#status = :active",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: item({ ":deleted": "deleted", ":active": "active", ":now": updatedAt })
      });
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  async updateReviewJudgmentSourceIds(talkId: string, fromId: string, id: string, sourceEventIds: string[], updatedAt: string) {
    await this.updateReviewJudgmentItem(talkId, fromId, id, {
      UpdateExpression: "SET sourceEventIds = :ids, updatedAt = :now",
      ExpressionAttributeValues: item({ ":ids": sourceEventIds, ":now": updatedAt })
    });
  }

}

export const dynamoDocument = { attribute, item, valueFromItem };
