import assert from "node:assert/strict";
import test from "node:test";
import { safeLocalStorage, safeSessionStorage } from "../src/client/system/browserStorage.ts";
import { localPlayerMemoryKey, playerSessionChanged } from "../src/client/system/playerSession.ts";

test("browserモードの会話表示済み記録は進行トークンが変わっても同じ領域を使う", () => {
  assert.equal(localPlayerMemoryKey("browser", "progress-1"), localPlayerMemoryKey("browser", "progress-2"));
  assert.notEqual(localPlayerMemoryKey("server", "session-1"), localPlayerMemoryKey("server", "session-2"));
});

test("browser進行の再開はトークン更新だけで別セッション扱いにしない", () => {
  assert.equal(playerSessionChanged("browser", "progress-1", "progress-2", true), false);
  assert.equal(playerSessionChanged("browser", "progress-1", "progress-2", false), true);
  assert.equal(playerSessionChanged("server", "session-1", "session-2", false), true);
});

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
