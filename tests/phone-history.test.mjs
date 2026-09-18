import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isAppId } from "../src/shared/appRegistry.ts";
import {
  goBackInPhoneHistory,
  phoneHistoryMarkerFrom,
  phoneHistoryStateFrom,
  pushPhoneHistoryRoute,
  replacePhoneHistoryRoute
} from "../src/client/system/phoneHistory.ts";

const source = readFileSync(new URL("../src/client/system/phoneHistory.ts", import.meta.url), "utf8");

// 実moduleの固定設定だけを差し替え、ページごとに独立したMapを検証する。
function memoryHistoryHarness() {
  const sandbox = {
    exports: {},
    require(name) {
      if (name === "./clientStorage.ts") return { isMemoryStorage: true };
      assert.equal(name, "../../shared/appRegistry.ts");
      return { isAppId };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, sandbox);
  return sandbox.exports;
}

class FakeHistory {
  entries = [{ state: null }];
  position = 0;
  goCalls = [];
  backCalls = 0;

  get state() {
    return this.entries[this.position]?.state ?? null;
  }

  replaceState(state) {
    this.entries[this.position] = { state };
  }

  pushState(state) {
    this.entries = [...this.entries.slice(0, this.position + 1), { state }];
    this.position += 1;
  }

  go(delta) {
    this.goCalls.push(delta);
    this.position = Math.max(0, Math.min(this.entries.length - 1, this.position + delta));
  }

  back() {
    this.backCalls += 1;
    this.go(-1);
  }
}

test("管理対象外・別スコープ・不正な履歴stateは復元しない", () => {
  assert.equal(phoneHistoryStateFrom(null), null);
  assert.equal(phoneHistoryStateFrom({ owner: "another", version: 1 }), null);
  assert.equal(phoneHistoryStateFrom({
    owner: "xstoryphone",
    version: 1,
    scope: "old",
    index: 0,
    route: { kind: "home" }
  }, "current"), null);
  assert.equal(phoneHistoryStateFrom({
    owner: "xstoryphone",
    version: 1,
    scope: "current",
    index: 0,
    route: { kind: "app", appId: "unknown" }
  }), null);
  assert.equal(phoneHistoryStateFrom({
    owner: "xstoryphone",
    version: 1,
    scope: "current",
    index: 0,
    route: { kind: "app", appId: "notes", contentId: "" }
  }), null);
});

test("画面情報のない自社markerと管理対象外の履歴を区別できる", () => {
  const marker = { owner: "xstoryphone", version: 1, scope: "old-page", index: 3 };
  assert.deepEqual(phoneHistoryMarkerFrom(marker), marker);
  assert.equal(phoneHistoryStateFrom(marker), null);
  assert.equal(phoneHistoryMarkerFrom({ ...marker, owner: "another" }), null);
  assert.equal(phoneHistoryMarkerFrom({ ...marker, version: 2 }), null);
  assert.equal(phoneHistoryMarkerFrom({ ...marker, index: -1 }), null);
  assert.equal(phoneHistoryMarkerFrom({ ...marker, scope: "" }), null);
});

test("トップ階層の移動だけをpushし、同一画面は増やさない", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });

  assert.equal(history.entries.length, 2);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope"), {
    owner: "xstoryphone",
    version: 1,
    scope: "scope",
    index: 1,
    route: { kind: "app", appId: "notes" },
    previousRoute: { kind: "home" }
  });
});

test("メールの一覧と個別メールを端末履歴として復元できる", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "mail" });
  replacePhoneHistoryRoute(history, "scope", { kind: "app", appId: "mail", contentId: "mail-1" });

  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, {
    kind: "app",
    appId: "mail",
    contentId: "mail-1"
  });
});

test("同一アプリ内の選択は現在位置を保ったまま置換できる", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  replacePhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes", contentId: "note-2" });

  assert.equal(history.entries.length, 2);
  assert.equal(phoneHistoryStateFrom(history.state, "scope")?.index, 1);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, {
    kind: "app",
    appId: "notes",
    contentId: "note-2"
  });
});

test("端末ホームは新しい履歴として積み、戻ると直前のアプリへ戻る", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  pushPhoneHistoryRoute(history, "scope", { kind: "home" });

  assert.equal(history.entries.length, 3);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, { kind: "home" });

  assert.equal(goBackInPhoneHistory(history, "scope"), true);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, { kind: "app", appId: "notes" });
});

test("戻るリンクは同じスコープの直前画面がある場合だけブラウザ履歴を使う", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  assert.equal(goBackInPhoneHistory(history, "scope", "messages"), false);

  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "messages" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  replacePhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes", contentId: "note-1" });
  assert.equal(goBackInPhoneHistory(history, "scope", "chat"), false);
  assert.equal(history.backCalls, 0);

  assert.equal(goBackInPhoneHistory(history, "scope", "messages"), true);
  assert.equal(history.backCalls, 1);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, { kind: "app", appId: "messages" });
});

test("戻った後の新しい遷移では不要なforward履歴を捨てる", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });
  history.go(-1);
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "radio" });

  assert.equal(history.entries.length, 3);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, { kind: "app", appId: "radio" });
});

test("memoryは画面詳細をHistory APIへ渡さず、同一画面の重複・置換・戻るリンクを維持する", () => {
  const api = memoryHistoryHarness();
  const history = new FakeHistory();
  api.replacePhoneHistoryRoute(history, "page-scope", { kind: "home" });
  assert.equal(api.goBackInPhoneHistory(history, "page-scope"), false);
  api.pushPhoneHistoryRoute(history, "page-scope", { kind: "app", appId: "messages" });
  api.pushPhoneHistoryRoute(history, "page-scope", { kind: "app", appId: "messages" });
  api.pushPhoneHistoryRoute(history, "page-scope", { kind: "app", appId: "notes", contentId: "secret-note" });
  api.replacePhoneHistoryRoute(history, "page-scope", { kind: "app", appId: "notes", contentId: "next-secret-note" });

  assert.equal(history.entries.length, 3);
  assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state, "page-scope")), {
    owner: "xstoryphone", version: 1, scope: "page-scope", index: 2,
    route: { kind: "app", appId: "notes", contentId: "next-secret-note" },
    previousRoute: { kind: "app", appId: "messages" }
  });
  assert.deepEqual(structuredClone(history.entries.map(({ state }) => state)), [
    { owner: "xstoryphone", version: 1, scope: "page-scope", index: 0 },
    { owner: "xstoryphone", version: 1, scope: "page-scope", index: 1 },
    { owner: "xstoryphone", version: 1, scope: "page-scope", index: 2 }
  ]);
  assert.equal(api.goBackInPhoneHistory(history, "page-scope", "chat"), false);
  assert.equal(api.goBackInPhoneHistory(history, "page-scope", "messages"), true);
  assert.equal(history.backCalls, 1);
  assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state)?.route), { kind: "app", appId: "messages" });
  history.go(1);
  assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state)?.route), {
    kind: "app", appId: "notes", contentId: "next-secret-note"
  });
});

test("memoryのホーム移動と通常の戻る・進むではページ内の画面情報を保持する", () => {
  const api = memoryHistoryHarness();
  const history = new FakeHistory();
  api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "mail", contentId: "mail-1" });
  api.pushPhoneHistoryRoute(history, "scope", { kind: "home" });
  assert.equal(api.goBackInPhoneHistory(history, "scope"), true);
  assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state)?.route), {
    kind: "app", appId: "mail", contentId: "mail-1"
  });
  history.go(1);
  assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state)?.route), { kind: "home" });
});

test("memoryは戻った後のpushでforward側のMapも破棄する", () => {
  const api = memoryHistoryHarness();
  const history = new FakeHistory();
  api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });
  api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "mail" });
  const discardedMarker = history.state;
  history.go(-2);
  api.replacePhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes", contentId: "note-1" });
  assert.notEqual(api.phoneHistoryStateFrom(discardedMarker), null);
  api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "radio" });

  assert.equal(history.entries.length, 3);
  assert.equal(api.phoneHistoryStateFrom(discardedMarker), null);
  assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state)?.route), { kind: "app", appId: "radio" });
});

test("memoryはscope更新で古いMapを破棄し、古いmarkerの読取りでも現scopeを維持する", () => {
  const api = memoryHistoryHarness();
  const history = new FakeHistory();
  api.replacePhoneHistoryRoute(history, "old-scope", { kind: "home" });
  const oldHomeMarker = history.state;
  api.pushPhoneHistoryRoute(history, "old-scope", { kind: "app", appId: "notes", contentId: "note-1" });
  const oldAppMarker = history.state;
  api.replacePhoneHistoryRoute(history, "new-scope", { kind: "home" });

  assert.equal(api.phoneHistoryStateFrom(oldHomeMarker), null);
  assert.equal(api.phoneHistoryStateFrom(oldAppMarker), null);
  assert.notEqual(api.phoneHistoryMarkerFrom(oldAppMarker), null);
  assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state)), {
    owner: "xstoryphone", version: 1, scope: "new-scope", index: 0, route: { kind: "home" }
  });
});

test("memoryは別ページや再生成後に古いmarker・persistentの画面情報から復元しない", () => {
  const firstPage = memoryHistoryHarness();
  const newPage = memoryHistoryHarness();
  const history = new FakeHistory();
  firstPage.replacePhoneHistoryRoute(history, "first-page", { kind: "app", appId: "notes", contentId: "note-1" });
  const oldMarker = history.state;

  assert.equal(newPage.phoneHistoryStateFrom(oldMarker), null);
  assert.notEqual(newPage.phoneHistoryMarkerFrom(oldMarker), null);
  assert.equal(newPage.phoneHistoryStateFrom({ ...oldMarker, route: { kind: "app", appId: "notes", contentId: "note-1" } }), null);
  assert.equal(newPage.phoneHistoryMarkerFrom({ owner: "another-site" }), null);
  assert.equal(newPage.goBackInPhoneHistory(history, "first-page"), false);
  newPage.replacePhoneHistoryRoute(history, "new-page", { kind: "home" });
  assert.deepEqual(structuredClone(firstPage.phoneHistoryStateFrom(oldMarker)?.route), {
    kind: "app", appId: "notes", contentId: "note-1"
  });
});
