function safeStorage(resolve: () => Storage) {
  return {
    getItem(key: string) {
      try {
        return resolve().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      try {
        resolve().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    removeItem(key: string) {
      try {
        resolve().removeItem(key);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export const safeLocalStorage = safeStorage(() => window.localStorage);
export const safeSessionStorage = safeStorage(() => window.sessionStorage);
