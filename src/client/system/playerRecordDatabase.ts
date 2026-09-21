import { BrowserPlayerStorageError, isBrowserPlayerStorageError } from "./playerStorageError.ts";

const unavailable = (message: string, cause?: unknown) => new BrowserPlayerStorageError("unavailable", message, cause);

export async function openPlayerRecordDatabase(name: string, version: number, storeName: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      if (!globalThis.indexedDB) throw unavailable("IndexedDBを利用できません。");
      request = globalThis.indexedDB.open(name, version);
    } catch (error) { reject(unavailable("IndexedDBを開けません。", error)); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "key" });
    };
    request.onerror = () => { settled = true; reject(unavailable("IndexedDBを開けません。", request.error)); };
    request.onblocked = () => { settled = true; reject(unavailable("IndexedDBの更新が別の画面に阻まれています。")); };
    request.onsuccess = () => {
      if (settled) request.result.close();
      else resolve(request.result);
    };
  });
}

// 読取り完了callback内で同期検査・書込みを行う。transaction中に通信やawaitを持ち込まない。
export function mutatePlayerRecords<T>(
  database: IDBDatabase,
  storeName: string,
  keys: readonly string[],
  candidate: (records: ReadonlyMap<string, unknown>) => { value: T; writes: readonly { key: string }[]; clear?: boolean }
) {
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = database.transaction(storeName, "readwrite"); }
    catch (error) { reject(unavailable("IndexedDB transactionを開始できません。", error)); return; }
    const store = transaction.objectStore(storeName);
    const records = new Map<string, unknown>();
    let pending = keys.length;
    let result: { value: T } | null = null;
    let failure: unknown;
    const abort = (error: unknown) => {
      failure = isBrowserPlayerStorageError(error) ? error : unavailable("プレイデータの保存に失敗しました。", error);
      try { transaction.abort(); } catch { /* transactionの結果で完了する。 */ }
    };
    const finish = () => {
      if (failure || pending) return;
      try {
        const next = candidate(records);
        if (next.clear) store.clear();
        for (const record of next.writes) store.put(record);
        result = next;
      } catch (error) { abort(error); }
    };
    transaction.oncomplete = () => result ? resolve(result.value) : reject(unavailable("保存transactionの結果がありません。"));
    transaction.onabort = () => reject(failure ?? unavailable("保存transactionが中断されました。", transaction.error));
    transaction.onerror = () => undefined;
    try {
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => { records.set(key, request.result); pending -= 1; finish(); };
        request.onerror = () => abort(unavailable("プレイデータを読み取れません。", request.error));
      }
      finish();
    } catch (error) { abort(error); }
  });
}

export function readPlayerRecords(database: IDBDatabase, storeName: string) {
  return new Promise<unknown[]>((resolve, reject) => {
    try {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(unavailable("プレイデータの読取りが中断されました。", transaction.error));
      transaction.onerror = () => undefined;
    } catch (error) { reject(unavailable("プレイデータを読み取れません。", error)); }
  });
}
