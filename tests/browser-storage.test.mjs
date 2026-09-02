import assert from "node:assert/strict";
import test from "node:test";
import { safeLocalStorage, safeSessionStorage } from "../src/client/system/browserStorage.ts";
import { localPlayerMemoryKey, playerSessionChanged } from "../src/client/system/playerSession.ts";
import { loadUiState } from "../src/client/system/progress.ts";
import {
  clearTalkDelaySeenMessagesForMemoryKey,
  loadTalkDelaySeenMessages,
  saveTalkDelaySeenMessages
} from "../src/client/apps/talkDelaySeenStorage.ts";

test("browserモードの会話表示済み記録は進行トークンが変わっても同じ領域を使う", () => {
  assert.equal(localPlayerMemoryKey("browser", "progress-1"), localPlayerMemoryKey("browser", "progress-2"));
  assert.notEqual(localPlayerMemoryKey("server", "session-1"), localPlayerMemoryKey("server", "session-2"));
});

test("browser進行の再開はトークン更新だけで別セッション扱いにしない", () => {
  assert.equal(playerSessionChanged("browser", "progress-1", "progress-2", true), false);
  assert.equal(playerSessionChanged("browser", "progress-1", "progress-2", false), true);
  assert.equal(playerSessionChanged("server", "session-1", "session-2", false), true);
});

test("旧UI保存に不要fieldが残っていても最後の表示先を維持する", () => {
  const originalWindow = globalThis.window;
  const values = new Map([
    ["xstoryphone.ui", JSON.stringify({
      version: 5,
      locked: false,
      lockMethod: "none",
      sessionToken: "session",
      serialCounter: "anonymous",
      openedAppIds: ["notes"],
      lastContentByAppId: { notes: "note-1" },
      localTalkReadCursors: {},
      pendingTalkReadCursors: {}
    })]
  ]);
  globalThis.window = {
    localStorage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); }
    }
  };

  try {
    const state = loadUiState();
    assert.deepEqual(state.lastContentByAppId, { notes: "note-1" });
    assert.equal("serialCounter" in state, false);
    assert.equal("openedAppIds" in state, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("小さいUI用localStorageが利用不能でも画面処理を例外で止めない", () => {
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

test("検索AI talkも既存の表示済み記録を使い、player resetで同時に消去する", () => {
  const values = new Map();
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };

  try {
    saveTalkDelaySeenMessages("search_agent", "player-1", {
      search_agent: new Set(["message-1"])
    });
    assert.deepEqual([...loadTalkDelaySeenMessages("search_agent", "player-1").search_agent], ["message-1"]);

    clearTalkDelaySeenMessagesForMemoryKey("player-1");
    assert.deepEqual(loadTalkDelaySeenMessages("search_agent", "player-1"), {});
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});
