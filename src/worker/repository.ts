import { D1Store } from "../platform/cloudflare/d1Store.ts";
import type { InputEventRecord, PlayerRecord, StoredPlayerState } from "../server/store.ts";

// 既存の外部テストやプロジェクト拡張との互換用。共通アプリ本体はAppStoreを直接使う。
export type { PlayerRecord, StoredPlayerState, TranscriptUpdate } from "../server/store.ts";

export function createPasscodeSession(db: D1Database, accessCode: string, initialState: StoredPlayerState) {
  return new D1Store(db).createPasscodeSession(accessCode, initialState);
}

export function prunePlayerSessions(db: D1Database, playerId: string, currentTokenHash: string) {
  return new D1Store(db).prunePlayerSessions(playerId, currentTokenHash);
}

export function queueScheduledEvent(
  db: D1Database,
  playerId: string,
  scheduleId: string,
  eventId: string,
  fields: Record<string, string>,
  dueAt: string
) {
  return new D1Store(db).queueScheduledEvent(playerId, scheduleId, eventId, fields, dueAt);
}

export function cancelScheduledEvent(db: D1Database, playerId: string, scheduleId: string) {
  return new D1Store(db).cancelScheduledEvent(playerId, scheduleId);
}

export function nextScheduledWakeAt(db: D1Database, playerId: string) {
  return new D1Store(db).nextScheduledWakeAt(playerId);
}

export async function dueScheduledEvents(db: D1Database, playerId: string, at: string) {
  return (await new D1Store(db).dueScheduledEvents(playerId, at)).map((event) => ({
    id: event.id,
    schedule_id: event.scheduleId,
    event_id: event.eventId,
    payload_json: JSON.stringify(event.fields)
  }));
}

export function claimScheduledEvent(db: D1Database, playerId: string, id: string) {
  return new D1Store(db).claimScheduledEvent(playerId, id);
}

export function completeScheduledEvent(db: D1Database, playerId: string, id: string) {
  return new D1Store(db).completeScheduledEvent(playerId, id);
}

export function requeueScheduledEvent(db: D1Database, playerId: string, id: string) {
  return new D1Store(db).requeueScheduledEvent(playerId, id);
}

export function playerForSession(db: D1Database, sessionToken: string): Promise<PlayerRecord | null> {
  return new D1Store(db).playerForSession(sessionToken);
}

export function savePlayer(db: D1Database, player: PlayerRecord, nextState: StoredPlayerState) {
  return new D1Store(db).savePlayer(player, nextState);
}

export function resetPlayer(db: D1Database, player: PlayerRecord, nextState: StoredPlayerState) {
  return new D1Store(db).savePlayer(player, nextState);
}

export function clearPlayerRuntimeJobs(db: D1Database, playerId: string) {
  return new D1Store(db).clearPlayerRuntimeJobs(playerId);
}

export function recordInputEvent(db: D1Database, event: InputEventRecord, enabled: boolean) {
  return new D1Store(db).recordInputEvent(event, enabled);
}
