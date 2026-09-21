import type { ClientStorageSettings } from "../shared/clientStorage.ts";
import { prefixStorageKey } from "../shared/clientStorage.ts";
import { mergeTranscriptAppend, normalizeStoredState, type PlayerRecord, type StoredTranscript, type TranscriptAppend } from "../server/store.ts";
import { BrowserPlayerStorageError } from "../client/system/playerStorageError.ts";
import { mutatePlayerRecords, openPlayerRecordDatabase, readPlayerRecords } from "../client/system/playerRecordDatabase.ts";

export type LoadedPart = { id: string; locator: string };
export type StaticCurrent = {
  key: "current";
  projectId: string;
  releaseId: string;
  saveVersion: number;
  player: PlayerRecord;
  parts: LoadedPart[];
};
type Stream = StoredTranscript & { key: string };
const corrupt = (message: string) => new BrowserPlayerStorageError("corrupt", message);
const conflict = () => new BrowserPlayerStorageError("conflict", "別の画面または初期化操作で進行が更新されています。");

function readCurrent(value: unknown, projectId: string): StaticCurrent | null {
  if (value === undefined) return null;
  const current = value as StaticCurrent;
  if (!current || current.key !== "current" || current.projectId !== projectId
    || typeof current.releaseId !== "string" || !Number.isSafeInteger(current.saveVersion) || current.saveVersion < 1
    || !current.player || typeof current.player.id !== "string" || !Number.isSafeInteger(current.player.stateVersion)
    || !current.player.state || !Array.isArray(current.parts)
    || current.parts.some(part => !part || typeof part.id !== "string" || !/^[a-f0-9]{32}$/u.test(part.locator))) throw corrupt("staticの保存データ形式が不正です。");
  try { return { ...current, player: { ...current.player, state: normalizeStoredState(current.player.state) } }; }
  catch { throw corrupt("staticの進行データを読み取れません。"); }
}

function parentKey(current: StaticCurrent | null) { return current ? `${current.player.id}:${current.saveVersion}` : null; }

export function createStaticPlayerStore(projectId: string, settings: ClientStorageSettings) {
  settings = Object.freeze({ ...settings });
  let database: IDBDatabase | null = null;
  let initialized = false;
  let invalidated = false;
  let current: StaticCurrent | null = null;
  let streams = new Map<string, Stream>();
  let generation = 0;
  const name = prefixStorageKey(`xstoryphone-static-player-${projectId}`, settings.prefix);
  const ready = () => {
    if (!initialized || invalidated) throw new BrowserPlayerStorageError("unavailable", "staticの保存先を利用できません。");
  };
  return {
    get current() { return current; },
    get streams(): ReadonlyMap<string, Stream> { return streams; },
    get generation() { return generation; },
    async initialize() {
      if (initialized && !invalidated) return;
      if (settings.mode === "persistent") {
        database = await openPlayerRecordDatabase(name, 1, "records");
        database.onversionchange = () => { invalidated = true; database?.close(); };
        const records = await readPlayerRecords(database, "records");
        for (const raw of records) {
          const record = raw as Stream | StaticCurrent;
          if (record?.key === "current") current = readCurrent(record, projectId);
          else {
            const stream = raw as Stream;
            if (!stream?.key?.startsWith("talk:") || stream.key !== stream.streamId
              || typeof stream.transcriptKey !== "string" || !Array.isArray(stream.messages)
              || stream.messages.some(event => !event || typeof event.id !== "string" || typeof event.delivered_at !== "string")) throw corrupt("staticの履歴データ形式が不正です。");
            streams.set(stream.key, stream);
          }
        }
        if (!current && streams.size) throw corrupt("進行なしで履歴だけが残っています。");
      }
      initialized = true;
    },
    async prepare() {
      ready();
      const key = parentKey(current);
      if (database) await mutatePlayerRecords(database, "records", ["current"], records => {
        if (parentKey(readCurrent(records.get("current"), projectId)) !== key) throw conflict();
        return { value: undefined, writes: [] };
      });
      return key;
    },
    async commit(parent: string | null, epoch: number, player: PlayerRecord, releaseId: string, parts: LoadedPart[]) {
      ready();
      const appends = player.transcriptDeltas ?? [];
      const candidate = (stored: unknown) => {
        if (generation !== epoch || parentKey(readCurrent(stored, projectId)) !== parent || parentKey(current) !== parent) throw conflict();
        const nextStreams = new Map(streams);
        const changed = new Map<string, Stream>();
        for (const append of appends) {
          const compact: TranscriptAppend = { streamId: append.streamId, transcriptKey: append.transcriptKey, messages: append.messages };
          const existing = nextStreams.get(append.streamId) ?? { streamId: append.streamId, transcriptKey: append.transcriptKey, messages: [] };
          const next = { ...mergeTranscriptAppend(existing, compact), key: append.streamId };
          delete next.resolvedMessages;
          nextStreams.set(next.key, next);
          changed.set(next.key, next);
        }
        const savedPlayer = { id: player.id, state: player.state, stateVersion: player.stateVersion };
        const unchanged = current?.releaseId === releaseId && current.player.stateVersion === player.stateVersion
          && !appends.length && JSON.stringify(current.parts) === JSON.stringify(parts);
        const nextCurrent: StaticCurrent = unchanged ? current! : {
          key: "current", projectId, releaseId, saveVersion: (current?.saveVersion ?? 0) + 1, player: savedPlayer, parts
        };
        return { value: { current: nextCurrent, streams: nextStreams }, writes: unchanged ? [] : [...changed.values(), nextCurrent] };
      };
      const next = database
        ? await mutatePlayerRecords(database, "records", ["current"], records => candidate(records.get("current")))
        : candidate(current ?? undefined).value;
      current = next.current;
      streams = next.streams;
    },
    async clear(expected?: string | null) {
      ready();
      generation += 1;
      const check = (value: unknown) => {
        if (expected !== undefined && parentKey(readCurrent(value, projectId)) !== expected) throw conflict();
        return { value: undefined, writes: [], clear: true };
      };
      if (database) await mutatePlayerRecords(database, "records", ["current"], records => check(records.get("current")));
      else check(current ?? undefined);
      current = null;
      streams = new Map();
    },
    async deleteDatabase() {
      generation += 1;
      initialized = false;
      invalidated = true;
      if (settings.mode === "persistent") {
        database?.close();
        database = null;
        await new Promise<void>((resolve, reject) => {
          let request: IDBOpenDBRequest;
          try { request = globalThis.indexedDB.deleteDatabase(name); }
          catch (error) { reject(new BrowserPlayerStorageError("unavailable", "保存を初期化できません。", error)); return; }
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new BrowserPlayerStorageError("unavailable", "保存の初期化に失敗しました。", request.error));
          request.onblocked = () => reject(new BrowserPlayerStorageError("unavailable", "他の画面を閉じてから初期化してください。"));
        });
      }
      current = null; streams = new Map(); initialized = false; invalidated = false;
    }
  };
}
