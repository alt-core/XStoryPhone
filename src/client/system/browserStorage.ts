import { clientStorageKey, isMemoryStorage } from "./clientStorage.ts";

function safeStorage(resolve: () => Storage) {
  const memory = new Map<string, string>();
  return {
    getItem(key: string) {
      const storageKey = clientStorageKey(key);
      if (isMemoryStorage) return memory.get(storageKey) ?? null;
      try {
        return resolve().getItem(storageKey);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      const storageKey = clientStorageKey(key);
      if (isMemoryStorage) {
        memory.set(storageKey, value);
        return true;
      }
      try {
        resolve().setItem(storageKey, value);
        return true;
      } catch {
        return false;
      }
    },
    removeItem(key: string) {
      const storageKey = clientStorageKey(key);
      if (isMemoryStorage) {
        memory.delete(storageKey);
        return true;
      }
      try {
        resolve().removeItem(storageKey);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export const safeLocalStorage = safeStorage(() => window.localStorage);
export const safeSessionStorage = safeStorage(() => window.sessionStorage);
