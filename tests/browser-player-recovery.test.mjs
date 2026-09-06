import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import { BrowserPlayerStorageError, isBrowserPlayerStorageError } from "../src/client/system/browserPlayerStorage.ts";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

function startupHarness({ mode = "browser", pathname = "/", testing = false, confirmed = true, initializationError, deletionError } = {}) {
  const calls = [];
  const buttons = new Map();
  const target = {
    innerHTML: "",
    replaceChildren() { calls.push("clear-loading"); },
    querySelector(selector) {
      const key = selector.slice(1, -1);
      if (!this.innerHTML.includes(key)) return null;
      if (!buttons.has(key)) buttons.set(key, { disabled: false, addEventListener(_type, callback) { this.click = callback; } });
      return buttons.get(key);
    }
  };
  const context = {
    playerMode: mode, projectId: "test-project", resetForTestingEnabled: testing,
    projectConstants: { "client.runtime_revision": "test-revision" },
    defaultUiState: { version: 5, locked: true, lastContentByAppId: {}, localTalkReadCursors: {}, pendingTalkReadCursors: {} },
    isBrowserPlayerStorageError,
    window: {
      confirm() { calls.push("confirm"); return confirmed; },
      location: { pathname, replace(url) { calls.push(`replace:${url}`); }, reload() { calls.push("reload"); } },
      history: { replaceState(_state, _title, url) { calls.push(`history:${url}`); } }
    },
    async initializeBrowserPlayerStorage(options) { calls.push(`initialize:${options.enabled}`); if (initializationError) throw initializationError; },
    async deleteBrowserPlayerDatabase(id) { calls.push(`delete:${id}`); if (deletionError) throw deletionError; },
    clearStartConfirmation() { calls.push("clear-confirmation"); },
    saveUiState() { calls.push("clear-ui"); },
    mount() { calls.push("mount"); }, App: {},
    trackClientError() {}, console: { error() {} }
  };
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/client/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = source.statements.filter(ts.isFunctionDeclaration).map((item) => item.getText(source)).join("\n");
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, calls, target, buttons };
}

test("browserの本番logoutは確認取消で保存を消さず、確定した時だけ初期化前に削除する", async () => {
  const cancelled = startupHarness({ pathname: "/logout/", confirmed: false });
  await cancelled.context.start(cancelled.target);
  assert.deepEqual(cancelled.calls, ["confirm", "history:/", "initialize:true", "clear-loading", "mount"]);

  const accepted = startupHarness({ pathname: "/logout" });
  await accepted.context.start(accepted.target);
  assert.deepEqual(accepted.calls, ["confirm", "delete:test-project", "clear-confirmation", "clear-ui", "replace:/"]);
});

test("dev/stgの明示logoutは確認なし、serverのlogoutはAppへ渡してDBを削除しない", async () => {
  const testing = startupHarness({ pathname: "/logout", testing: true });
  await testing.context.start(testing.target);
  assert.deepEqual(testing.calls, ["delete:test-project", "clear-confirmation", "clear-ui", "replace:/"]);

  const server = startupHarness({ pathname: "/logout", mode: "server" });
  await server.context.start(server.target);
  assert.deepEqual(server.calls, ["initialize:false", "clear-loading", "mount"]);
});

test("起動時のcorruptだけに明示初期化の入口を出し、取消・削除失敗では画面を開始しない", async () => {
  const corrupted = startupHarness({ initializationError: new BrowserPlayerStorageError("corrupt", "検査失敗"), confirmed: false });
  await corrupted.context.start(corrupted.target);
  const button = corrupted.buttons.get("data-restart-button");
  assert.ok(button);
  await button.click({ currentTarget: button });
  assert.deepEqual(corrupted.calls, ["initialize:true", "confirm"]);
  assert.equal(button.disabled, false);

  const failed = startupHarness({ pathname: "/logout", deletionError: new BrowserPlayerStorageError("unavailable", "他画面が使用中" ) });
  await failed.context.start(failed.target);
  assert.deepEqual(failed.calls, ["confirm", "delete:test-project"]);
  assert.match(failed.target.innerHTML, /AP-STORAGE/u);
  assert.match(failed.target.innerHTML, /他の画面を閉じて/u);
  assert.equal(failed.buttons.has("data-restart-button"), false);

  for (const kind of ["unavailable", "conflict", "unauthorized"]) {
    const other = startupHarness({ initializationError: new BrowserPlayerStorageError(kind, "検証用") });
    await other.context.start(other.target);
    assert.equal(other.buttons.has("data-restart-button"), false);
    assert.deepEqual(other.calls, ["initialize:true"]);
  }
});

test("browser認証失敗のサポートコードを後続catchで上書きせず、Appはbrowser logoutを重ねて実行しない", () => {
  const context = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["showGlobalError", "shouldLogoutFromUrl"], {
    globalErrorVisible: false, globalErrorSupportCode: "AP-CLIENT", globalErrorMessage: "",
    isBrowserPlayerStorageError, stopBackgroundMediaPlayback() {}, cancelPresentations() {}, resetPhoneHistoryBoundary() {},
    console: { error() {}, warn() {} }, playerMode: "browser", LOGOUT_PATH_SUFFIX: "/logout",
    window: { location: { pathname: "/logout/" } }
  });
  context.showGlobalError(new BrowserPlayerStorageError("unauthorized", "署名検証失敗"));
  assert.equal(context.globalErrorVisible, true);
  assert.equal(context.globalErrorSupportCode, "AP-BROWSER-STATE");
  context.showGlobalError("後続catch", { supportCode: "AP-STATE" });
  assert.equal(context.globalErrorSupportCode, "AP-BROWSER-STATE");
  assert.equal(context.shouldLogoutFromUrl(), false);
  context.playerMode = "server";
  assert.equal(context.shouldLogoutFromUrl(), true);
});
