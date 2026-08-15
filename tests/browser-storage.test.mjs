import assert from "node:assert/strict";
import test from "node:test";
import { safeLocalStorage, safeSessionStorage } from "../src/client/system/browserStorage.ts";

test("ブラウザストレージが利用不能でも進行処理を例外で止めない", () => {
  const unavailableStorage = {
    getItem() {
      throw new Error("unavailable");
    },
    setItem() {
      throw new Error("unavailable");
    },
    removeItem() {
      throw new Error("unavailable");
    }
  };
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: unavailableStorage,
    sessionStorage: unavailableStorage
  };

  try {
    assert.equal(safeLocalStorage.getItem("key"), null);
    assert.equal(safeLocalStorage.setItem("key", "value"), false);
    assert.equal(safeLocalStorage.removeItem("key"), false);
    assert.equal(safeSessionStorage.getItem("key"), null);
  } finally {
    globalThis.window = originalWindow;
  }
});
