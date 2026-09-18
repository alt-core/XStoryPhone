import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { prefixStorageKey, resolveClientStorageSettings } from "../src/shared/clientStorage.ts";
import { safeLocalStorage, safeSessionStorage } from "../src/client/system/browserStorage.ts";
import { localPlayerMemoryKey, playerSessionChanged } from "../src/client/system/playerSession.ts";
import { loadUiState } from "../src/client/system/progress.ts";
import {
  clearTalkDelaySeenMessagesForMemoryKey,
  loadTalkDelaySeenMessages,
  saveTalkDelaySeenMessages
} from "../src/client/apps/talkDelaySeenStorage.ts";

// 設定を固定した別ページのmodule実体を作り、製品コードの可変globalは増やさない。
function storageHarness(file, { mode = "persistent", prefix = "" } = {}, globals = {}) {
  const settings = resolveClientStorageSettings("browser", {
    VITE_XSTORYPHONE_CLIENT_STORAGE: mode,
    VITE_XSTORYPHONE_STORAGE_PREFIX: prefix
  });
  const sandbox = {
    exports: {},
    require(name) {
      assert.ok(name.endsWith("/clientStorage.ts"));
      return {
        isMemoryStorage: settings.mode === "memory",
        clientStorageKey: (key) => prefixStorageKey(key, settings.prefix)
      };
    }
  };
  Object.defineProperties(sandbox, Object.getOwnPropertyDescriptors(globals));
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(readFileSync(new URL(`../src/client/${file}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, sandbox);
  return sandbox.exports;
}

function mapStorage(values = new Map()) {
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

test("local/sessionのget・set・removeは指定prefixだけに作用する", () => {
  const values = new Map([["key", "旧保存"]]);
  const sessionValues = new Map([["key", "旧session"]]);
  const window = { localStorage: mapStorage(values), sessionStorage: mapStorage(sessionValues) };
  const a = storageHarness("system/browserStorage", { prefix: "作品A" }, { window });
  const b = storageHarness("system/browserStorage", { prefix: "作品B" }, { window });
  for (const name of ["safeLocalStorage", "safeSessionStorage"]) {
    assert.equal(a[name].getItem("key"), null);
    assert.equal(a[name].setItem("key", "A"), true);
    assert.equal(b[name].getItem("key"), null);
    assert.equal(b[name].setItem("key", "B"), true);
    assert.equal(a[name].getItem("key"), "A");
    assert.equal(b[name].getItem("key"), "B");
    assert.equal(a[name].removeItem("key"), true);
    assert.equal(a[name].getItem("key"), null);
    assert.equal(b[name].getItem("key"), "B");
  }
  assert.deepEqual([...values], [["key", "旧保存"], ["作品B:key", "B"]]);
  assert.deepEqual([...sessionValues], [["key", "旧session"], ["作品B:key", "B"]]);
});

test("memoryの小さいUI保存はStorage getterへ触れず、local/sessionとページを分離する", () => {
  let touched = 0;
  const globals = {
    get window() { touched += 1; throw new Error("windowへ触れた"); },
    get localStorage() { touched += 1; throw new Error("localStorageへ触れた"); },
    get sessionStorage() { touched += 1; throw new Error("sessionStorageへ触れた"); }
  };
  const options = { mode: "memory", prefix: "作品A" };
  const page = storageHarness("system/browserStorage", options, globals);
  const otherPage = storageHarness("system/browserStorage", options, globals);
  assert.equal(page.safeLocalStorage.setItem("key", "local"), true);
  assert.equal(page.safeLocalStorage.getItem("key"), "local");
  assert.equal(page.safeSessionStorage.getItem("key"), null);
  assert.equal(page.safeSessionStorage.setItem("key", "session"), true);
  assert.equal(page.safeSessionStorage.getItem("key"), "session");
  assert.equal(otherPage.safeLocalStorage.getItem("key"), null);
  assert.equal(otherPage.safeSessionStorage.getItem("key"), null);
  assert.equal(page.safeLocalStorage.removeItem("key"), true);
  assert.equal(page.safeLocalStorage.getItem("key"), null);
  assert.equal(page.safeSessionStorage.getItem("key"), "session");
  assert.equal(page.safeSessionStorage.removeItem("key"), true);
  assert.equal(page.safeSessionStorage.getItem("key"), null);
  assert.equal(touched, 0);
});

test("delay保存はprefix間で混ざらず、破損保存のremoveも当該prefixだけに作用する", () => {
  const values = new Map([["xstoryphone.talk-delay-seen", "旧保存"]]);
  const localStorage = mapStorage(values);
  const a = storageHarness("apps/talkDelaySeenStorage", { prefix: "A" }, { localStorage });
  const b = storageHarness("apps/talkDelaySeenStorage", { prefix: "B" }, { localStorage });
  a.saveTalkDelaySeenMessages("messages", "browser-player", { thread: new Set(["A1"]) });
  b.saveTalkDelaySeenMessages("messages", "browser-player", { thread: new Set(["B1"]) });
  assert.deepEqual([...a.loadTalkDelaySeenMessages("messages", "browser-player").thread], ["A1"]);
  assert.deepEqual([...b.loadTalkDelaySeenMessages("messages", "browser-player").thread], ["B1"]);
  values.set("A:xstoryphone.talk-delay-seen", "壊れたJSON");
  assert.equal(Object.keys(a.loadTalkDelaySeenMessages("messages", "browser-player")).length, 0);
  assert.equal(values.has("A:xstoryphone.talk-delay-seen"), false);
  assert.equal(values.get("xstoryphone.talk-delay-seen"), "旧保存");
  assert.deepEqual([...b.loadTalkDelaySeenMessages("messages", "browser-player").thread], ["B1"]);
});

test("delay読取例外では同一ページの記録を保持し、保存が空なら記録を消す", () => {
  const values = new Map();
  let readFailure = false;
  const storage = mapStorage(values);
  const localStorage = {
    ...storage,
    getItem(key) {
      if (readFailure) throw new Error("読取不可");
      return storage.getItem(key);
    }
  };
  const page = storageHarness("apps/talkDelaySeenStorage", {}, { localStorage });
  page.saveTalkDelaySeenMessages("chat", "player", { thread: new Set(["1"]) });
  readFailure = true;
  assert.deepEqual([...page.loadTalkDelaySeenMessages("chat", "player").thread], ["1"]);
  page.saveTalkDelaySeenMessages("chat", "player", { thread: new Set(["2"]) });
  assert.deepEqual([...page.loadTalkDelaySeenMessages("chat", "player").thread], ["1", "2"]);
  readFailure = false;
  values.clear();
  assert.equal(Object.keys(page.loadTalkDelaySeenMessages("chat", "player")).length, 0);
});

test("memoryのdelay記録は外部保存を参照せず再表示まで保持し、clearとページを分離する", () => {
  let touched = 0;
  const globals = { get localStorage() { touched += 1; throw new Error("外部保存へ触れた"); } };
  const options = { mode: "memory", prefix: "作品A" };
  const page = storageHarness("apps/talkDelaySeenStorage", options, globals);
  const otherPage = storageHarness("apps/talkDelaySeenStorage", options, globals);
  for (const scope of ["messages", "chat", "search_agent"]) {
    page.saveTalkDelaySeenMessages(scope, "browser-player", { thread: new Set(["1"]) });
    page.saveTalkDelaySeenMessages(scope, "browser-player", { thread: new Set(["2"]) });
    assert.deepEqual([...page.loadTalkDelaySeenMessages(scope, "browser-player").thread], ["1", "2"]);
    assert.equal(Object.keys(otherPage.loadTalkDelaySeenMessages(scope, "browser-player")).length, 0);
  }
  page.clearTalkDelaySeenMessagesForMemoryKey("browser-player");
  for (const scope of ["messages", "chat", "search_agent"]) {
    page.saveTalkDelaySeenMessages(scope, "browser-player", { thread: new Set(["遅い保存"]) });
    assert.equal(Object.keys(page.loadTalkDelaySeenMessages(scope, "browser-player")).length, 0);
  }
  assert.equal(touched, 0);
});

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
