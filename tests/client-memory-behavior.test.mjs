import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

function moduleFunctions(file, names, globals) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = source.statements.filter((item) => ts.isFunctionDeclaration(item) && names.includes(item.name?.text));
  assert.equal(functions.length, names.length);
  vm.createContext(globals);
  vm.runInContext(ts.transpileModule(functions.map((item) => item.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, globals);
  return globals;
}

test("memoryの更新不一致は保存を使わず手動更新へ、persistentの一度だけ自動更新は維持", () => {
  for (const memory of [false, true]) {
    const calls = [];
    const saved = new Map();
    const context = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["forceReloadForClientRevision"], {
      isMemoryStorage: memory, CLIENT_RUNTIME_REVISION: "old", FORCE_RELOAD_STORAGE_KEY: "reload",
      clearPlayerStateCache() { calls.push("clear-cache"); },
      safeSessionStorage: {
        getItem(key) { assert.equal(memory, false); return saved.get(key); },
        setItem(key, value) { assert.equal(memory, false); saved.set(key, value); return true; }
      },
      showGlobalError(_reason, options) { calls.push(options.supportCode); },
      window: { location: { reload() { calls.push("reload"); } } }
    });
    context.forceReloadForClientRevision("new");
    context.forceReloadForClientRevision("new");
    assert.deepEqual(calls, memory ? ["AP-UPDATE", "AP-UPDATE"] : ["clear-cache", "reload", "clear-cache", "AP-UPDATE"]);
  }
});

test("memoryで中身のない自社historyへ戻ったときだけホーム境界を置く", () => {
  const calls = [];
  const context = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["handlePhoneHistoryPop"], {
    isMemoryStorage: true, qaMode: false, phoneHistoryNavigationId: 0,
    phoneHistoryStateFrom: () => null,
    phoneHistoryMarkerFrom: (value) => value?.owner === "xstoryphone" ? value : null,
    clearPhoneRoute() { calls.push("clear"); },
    replaceCurrentPhoneRoute(route) { calls.push(route.kind); }
  });
  context.handlePhoneHistoryPop({ state: { owner: "another" } });
  assert.deepEqual(calls, []);
  assert.equal(context.phoneHistoryNavigationId, 0);
  context.handlePhoneHistoryPop({ state: { owner: "xstoryphone" } });
  assert.deepEqual(calls, ["clear", "home"]);
  assert.equal(context.phoneHistoryNavigationId, 1);
});

test("古いhistoryのホーム境界へ戻った後は先行する非同期の画面復元を失効する", async () => {
  for (const memory of [false, true]) {
    const calls = [];
    let resolveOpen;
    const pendingOpen = new Promise((resolve) => { resolveOpen = resolve; });
    const context = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), [
      "handlePhoneHistoryPop", "restorePhoneHistoryRoute"
    ], {
      isMemoryStorage: memory, qaMode: false, phoneHistoryScope: "current", phoneHistoryNavigationId: 0,
      uiState: { locked: false, sessionToken: "browser-player" },
      outOfGameVisible: false, gameOverVisible: false, allClearVisible: false,
      activeIncomingCall: null, globalErrorVisible: false,
      phoneHistoryStateFrom: (value) => value?.route ? value : null,
      phoneHistoryMarkerFrom: (value) => value?.owner === "xstoryphone" ? value : null,
      requestSearchAgentClose() {},
      clearPhoneRoute() { calls.push("clear"); },
      replaceCurrentPhoneRoute(route) { calls.push(route.kind); },
      openPhoneHistoryContent: () => pendingOpen,
      focusOpenedContent() { calls.push("古い画面を復元"); }
    });
    context.handlePhoneHistoryPop({ state: {
      owner: "xstoryphone", version: 1, scope: "current", index: 1,
      route: { kind: "app", appId: "notes", contentId: "note-1" }
    } });
    assert.equal(context.phoneHistoryNavigationId, 1);
    context.handlePhoneHistoryPop({ state: {
      owner: "xstoryphone", version: 1, scope: "old", index: 0,
      ...(memory ? {} : { route: { kind: "home" } })
    } });
    assert.equal(context.phoneHistoryNavigationId, 2);
    resolveOpen(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["clear", "home"]);
  }
});

test("memoryではGA4を設定していても外部スクリプトやCookieへ触れない", () => {
  const context = moduleFunctions("../src/client/system/analytics.ts", ["analyticsEnabled", "ensureGoogleTag"], {
    isMemoryStorage: true, GA4_MEASUREMENT_ID: "G-MEMORYTEST",
    get window() { assert.fail("GA4のwindowを利用してはいけません"); },
    get document() { assert.fail("外部スクリプトを追加してはいけません"); }
  });
  assert.equal(context.ensureGoogleTag(), undefined);
});

test("memoryのAPI通信だけCookieとHTTP cacheを使わず、JSON token等の内容は変えない", async () => {
  for (const memory of [false, true]) {
    const requests = [];
    const context = moduleFunctions("../src/client/system/playerApi.ts", ["fetchPlayerApi"], {
      isMemoryStorage: memory,
      apiUrl: (path) => `https://api.example.com${path}`,
      fetch(url, init) { requests.push({ url, init }); return Promise.resolve("response"); }
    });
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ progressToken: "signed-state" }) };
    assert.equal(await context.fetchPlayerApi("/api/player-state", init), "response");
    assert.equal(requests[0].url, "https://api.example.com/api/player-state");
    assert.equal(requests[0].init.body, init.body);
    assert.equal(requests[0].init.headers, init.headers);
    assert.equal(requests[0].init.credentials, memory ? "omit" : undefined);
    assert.equal(requests[0].init.cache, memory ? "no-store" : undefined);
    if (!memory) assert.equal(requests[0].init, init);
  }
});
