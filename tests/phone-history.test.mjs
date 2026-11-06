import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isAppId } from "../src/shared/appRegistry.ts";
import {
  consumePhoneHistoryPop,
  currentPhoneHistoryState,
  goBackInPhoneHistory,
  phoneHistoryMarkerFrom,
  phoneHistoryStateFrom,
  pushPhoneHistoryRoute,
  replacePhoneHistoryRoute,
  replacePhoneHistoryView,
  samePhoneHistoryPage,
  samePhoneHistoryRoute
} from "../src/client/system/phoneHistory.ts";

const source = readFileSync(new URL("../src/client/system/phoneHistory.ts", import.meta.url), "utf8");

// 実moduleの固定設定だけを差し替え、ページごとに独立したMapを検証する。
function memoryHistoryHarness(isMemoryStorage = true) {
  const sandbox = {
    exports: {},
    require(name) {
      if (name === "./clientStorage.ts") return { isMemoryStorage };
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
  replaceCalls = 0;
  pushCalls = 0;

  get state() {
    return this.entries[this.position]?.state ?? null;
  }

  replaceState(state) {
    this.replaceCalls += 1;
    this.entries[this.position] = { state };
  }

  pushState(state) {
    this.pushCalls += 1;
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

// go直後にはstateを変えず、ブラウザと同じく後からpopstateを届ける。
class AsyncFakeHistory extends FakeHistory {
  travels = [];

  go(delta) {
    this.goCalls.push(delta);
    this.travels.push(delta);
  }

  pop(api, beforeConsume) {
    assert.notEqual(this.travels.length, 0, "処理待ちの履歴移動が必要");
    const delta = this.travels.shift();
    this.position = Math.max(0, Math.min(this.entries.length - 1, this.position + delta));
    const eventState = this.state;
    beforeConsume?.(eventState);
    return api.consumePhoneHistoryPop(this, eventState);
  }

  finish(api) {
    let count = 0;
    while (this.travels.length) {
      assert.ok(count++ < 30, "履歴移動が完了する");
      this.pop(api);
    }
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

test("検索AIの開閉は画面比較に含め、同じページの判定からだけ除外する", () => {
  const closed = { kind: "app", appId: "notes", contentId: "note-1" };
  const open = { ...closed, searchAgentOpen: true };
  assert.equal(samePhoneHistoryRoute(closed, open), false);
  assert.equal(samePhoneHistoryRoute(closed, { ...closed, searchAgentOpen: false }), true);
  assert.equal(samePhoneHistoryPage(closed, open), true);
  assert.equal(samePhoneHistoryPage(open, { ...closed, contentId: "note-2" }), false);
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { ...closed, searchAgentOpen: false });
  assert.deepEqual(phoneHistoryStateFrom(history.state)?.route, closed);
});

test("表示位置はrouteと分けて保存し、置換で維持し、新規pushへは引き継がない", () => {
  const history = new FakeHistory();
  const view = { appScroll: [{ path: [0, 2], top: 150, left: 0 }], searchAgent: { scrollTop: 240, visibleMessageCount: 8 } };
  replacePhoneHistoryRoute(history, "scope", { kind: "home" }, view);
  replacePhoneHistoryRoute(history, "scope", { kind: "home", searchAgentOpen: true });
  assert.deepEqual(currentPhoneHistoryState(history, "scope")?.view, view);
  replacePhoneHistoryView(history, "scope", { appScroll: [{ path: [], top: 300, left: 4, frame: true }] });
  assert.deepEqual(currentPhoneHistoryState(history, "scope")?.view, {
    appScroll: [{ path: [], top: 300, left: 4, frame: true }]
  });
  assert.deepEqual(currentPhoneHistoryState(history, "scope")?.route, { kind: "home", searchAgentOpen: true });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  assert.equal(currentPhoneHistoryState(history, "scope")?.view, undefined);
  assert.equal(consumePhoneHistoryPop(history, history.state), false);
});

for (const isMemoryStorage of [false, true]) {
  const mode = isMemoryStorage ? "memory" : "persistent";
  const copiedState = (api, history, scope = "scope") => structuredClone(api.currentPhoneHistoryState(history, scope));
  const scrollView = (top) => ({
    appScroll: [{ path: [0], top, left: 0 }],
    searchAgent: { scrollTop: top + 10, visibleMessageCount: top / 10 }
  });

  test(`${mode}: 会話の末尾表示の指定を履歴の保存・復元で保持する`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new FakeHistory();
    const position = { path: [0], top: 1218, left: 0, bottom: true };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "app", appId: "messages" }, { appScroll: [position] });
    assert.deepEqual(copiedState(api, history).view.appScroll, [position]);
    api.pushPhoneHistoryRoute(history, "scope", { kind: "home" });
    history.back();
    api.consumePhoneHistoryPop(history, history.state);
    assert.deepEqual(copiedState(api, history).view.appScroll, [position]);
    api.replacePhoneHistoryView(history, "scope", { appScroll: [{ ...position, bottom: "true" }] });
    assert.equal(copiedState(api, history).view.appScroll, undefined, "不正な指定は復元しない");
  });

  test(`${mode}: 検索AIの末尾指定は位置のkeyを省略して保存し、従来の数値位置も維持する`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new FakeHistory();
    const route = { kind: "home", searchAgentOpen: true };
    const appScroll = [{ path: [0], top: 100, left: 0 }];
    for (const [position, expected] of [
      [{ visibleMessageCount: 8 }, { visibleMessageCount: 8 }],
      [{ scrollTop: undefined, visibleMessageCount: 8 }, { visibleMessageCount: 8 }],
      [{ scrollTop: 0, visibleMessageCount: 8 }, { scrollTop: 0, visibleMessageCount: 8 }],
      [{ scrollTop: 240, visibleMessageCount: 8 }, { scrollTop: 240, visibleMessageCount: 8 }],
      ...[NaN, Infinity, -Infinity, "0", null, true].map((scrollTop) => [
        { scrollTop, visibleMessageCount: 8 }, undefined
      ]),
      ...[-1, 1.5, NaN, Infinity, "8"].map((visibleMessageCount) => [
        { visibleMessageCount }, undefined
      ])
    ]) {
      const input = { appScroll, searchAgent: { ...position } };
      api.replacePhoneHistoryRoute(history, "scope", route, input);
      const normalized = expected ? { appScroll, searchAgent: expected } : { appScroll };
      assert.deepEqual(copiedState(api, history).view, normalized);
      const read = api.phoneHistoryStateFrom(history.state, "scope");
      assert.deepEqual(structuredClone(read.view), normalized, "保存された履歴の読み取りでも同じ正規化を使う");
      input.searchAgent.visibleMessageCount = 999;
      if (read.view.searchAgent) read.view.searchAgent.visibleMessageCount = 777;
      assert.deepEqual(copiedState(api, history).view, normalized, "入力と読み取り結果の変更を保存済み位置へ反映しない");
      if (expected && expected.scrollTop === undefined) {
        assert.equal(Object.hasOwn(copiedState(api, history).view.searchAgent, "scrollTop"), false);
      }
    }
  });

  test(`${mode}: native Back前の検索AI末尾snapshotは旧数値を残さず、Forwardで表示件数とともに復元する`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const closed = { kind: "app", appId: "notes" };
    const open = { ...closed, searchAgentOpen: true };
    const previousView = { searchAgent: { scrollTop: 0, visibleMessageCount: 5 } };
    const bottom = { searchAgent: { visibleMessageCount: 13 } };
    api.replacePhoneHistoryRoute(history, "scope", closed, previousView);
    api.pushPhoneHistoryRoute(history, "scope", open, scrollView(200));
    history.go(-1);
    assert.equal(history.pop(api, () => {
      assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", open, () => bottom), true);
    }), false);
    assert.deepEqual(copiedState(api, history).view, previousView, "到着先の明示的な先頭0は変えない");
    bottom.searchAgent.visibleMessageCount = 99;
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).view, {
      appScroll: scrollView(200).appScroll,
      searchAgent: { visibleMessageCount: 13 }
    }, "検索AIの旧scrollTopを消し、取得対象外のアプリ位置は維持する");
    assert.equal(Object.hasOwn(copiedState(api, history).view.searchAgent, "scrollTop"), false);
  });

  test(`${mode}: 検索AIの末尾snapshotは閉じるBack一回とForwardでも位置を固定せず保持する`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const closed = { kind: "app", appId: "notes" };
    const open = { ...closed, searchAgentOpen: true };
    const bottom = { searchAgent: { visibleMessageCount: 13 } };
    api.replacePhoneHistoryRoute(history, "scope", closed, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", open, scrollView(200));
    api.replacePhoneHistoryView(history, "scope", bottom);
    const calls = { replace: history.replaceCalls, push: history.pushCalls };
    api.pushPhoneHistoryRoute(history, "scope", closed, bottom);
    assert.deepEqual(history.goCalls, [-1]);
    assert.equal(history.backCalls, 1);
    assert.equal(history.pop(api), true);
    assert.deepEqual(copiedState(api, history).view, bottom);
    assert.equal(Object.hasOwn(copiedState(api, history).view.searchAgent, "scrollTop"), false);
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, open);
    assert.deepEqual(copiedState(api, history).view, bottom);
    assert.deepEqual({ replace: history.replaceCalls, push: history.pushCalls }, calls);
  });

  test(`${mode}: パネルを閉じると一段Backし、Forwardで開いた画面と当時の位置へ戻る`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const closed = { kind: "app", appId: "notes", contentId: "note-1" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", closed, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", { ...closed, searchAgentOpen: true }, scrollView(200));
    const openState = history.state;
    const calls = { replace: history.replaceCalls, push: history.pushCalls };
    api.pushPhoneHistoryRoute(history, "scope", closed, scrollView(300));
    assert.deepEqual(history.goCalls, [-1]);
    assert.equal(history.backCalls, 1);
    assert.equal(history.position, 2);
    assert.deepEqual(copiedState(api, history).route, closed);
    assert.equal(copiedState(api, history).index, 1);
    assert.equal(history.pop(api), true);
    assert.equal(history.entries.length, 3);
    assert.equal(history.position, 1);
    assert.deepEqual(copiedState(api, history).view, scrollView(300));
    assert.deepEqual({ replace: history.replaceCalls, push: history.pushCalls }, calls,
      "閉じる操作ではentryを置換も積み直しもしない");
    assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(openState).view), scrollView(200));
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, { ...closed, searchAgentOpen: true });
    assert.deepEqual(copiedState(api, history).view, scrollView(200));
    api.pushPhoneHistoryRoute(history, "scope", closed);
    assert.equal(history.pop(api), true);
    assert.deepEqual(copiedState(api, history).view, scrollView(300), "未指定の位置は元の閉じたentryから維持する");
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });
    assert.equal(history.entries.length, 3, "次のpushで初めてforwardを新画面へ置き換える");
    assert.equal(api.goBackInPhoneHistory(history, "scope"), true);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, closed);
    assert.deepEqual(copiedState(api, history).view, scrollView(300));
    assert.equal(api.goBackInPhoneHistory(history, "scope"), true);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, { kind: "home" });
    if (isMemoryStorage) {
      for (const { state } of history.entries) {
        assert.deepEqual(Object.keys(state).sort(), ["index", "owner", "scope", "version"]);
      }
    }
  });

  test(`${mode}: 履歴の根元でも閉じるとBackだけを行い、次のpushでforwardを破棄する`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", { kind: "home", searchAgentOpen: true }, scrollView(200));
    const calls = { replace: history.replaceCalls, push: history.pushCalls };
    api.pushPhoneHistoryRoute(history, "scope", { kind: "home" }, scrollView(400));
    assert.deepEqual(history.goCalls, [-1]);
    assert.equal(history.pop(api), true);
    assert.equal(history.position, 0);
    assert.equal(copiedState(api, history).index, 0);
    assert.deepEqual({ replace: history.replaceCalls, push: history.pushCalls }, calls);
    assert.equal(api.goBackInPhoneHistory(history, "scope"), false);
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, { kind: "home", searchAgentOpen: true });
    assert.deepEqual(copiedState(api, history).view, scrollView(200));
    api.pushPhoneHistoryRoute(history, "scope", { kind: "home" });
    assert.equal(history.pop(api), true);
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "radio" });
    assert.equal(history.entries.length, 2);
    api.goBackInPhoneHistory(history, "scope");
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(400));
  });

  test(`${mode}: 閉じる直前に保存した位置は閉じた画面とForward先の開いた画面の両方に残る`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const closed = { kind: "app", appId: "notes" };
    const open = { ...closed, searchAgentOpen: true };
    api.replacePhoneHistoryRoute(history, "scope", closed, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", open, scrollView(200));
    // Appと同じく、出発画面を保存してから到着先へ引き継ぐ位置を渡す。
    api.replacePhoneHistoryView(history, "scope", scrollView(350));
    api.pushPhoneHistoryRoute(history, "scope", closed, scrollView(350));
    assert.equal(history.pop(api), true);
    assert.deepEqual(copiedState(api, history).view, scrollView(350));
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, open);
    assert.deepEqual(copiedState(api, history).view, scrollView(350));
    api.replacePhoneHistoryView(history, "scope", scrollView(450));
    api.pushPhoneHistoryRoute(history, "scope", closed);
    assert.equal(history.pop(api), true);
    assert.deepEqual(copiedState(api, history).view, scrollView(350), "到着位置を渡さなければ閉じたentryの位置を維持する");
    history.go(1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(450), "出発位置はForward側へ独立して保存する");
  });

  test(`${mode}: 閉じるBack待機中の連続開閉・route置換・位置保存・次画面pushを順番に処理する`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const closed = { kind: "app", appId: "notes", contentId: "note-1" };
    const open = { ...closed, searchAgentOpen: true };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", closed);
    api.pushPhoneHistoryRoute(history, "scope", open);
    api.pushPhoneHistoryRoute(history, "scope", closed);
    api.pushPhoneHistoryRoute(history, "scope", open);
    api.pushPhoneHistoryRoute(history, "scope", closed);
    const finalNote = { ...closed, contentId: "note-2" };
    api.replacePhoneHistoryRoute(history, "scope", finalNote);
    api.replacePhoneHistoryView(history, "scope", scrollView(500));
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });
    assert.deepEqual(copiedState(api, history).route, { kind: "app", appId: "photos" });
    history.finish(api);
    assert.deepEqual(history.goCalls, [-1, -1]);
    assert.equal(history.backCalls, 2);
    assert.equal(history.entries.length, 3);
    assert.deepEqual(copiedState(api, history).previousRoute, finalNote);
    api.goBackInPhoneHistory(history, "scope");
    history.pop(api);
    assert.deepEqual(copiedState(api, history).route, finalNote);
    assert.deepEqual(copiedState(api, history).view, scrollView(500));
    api.goBackInPhoneHistory(history, "scope");
    history.pop(api);
    assert.deepEqual(copiedState(api, history).route, { kind: "home" });
  });

  test(`${mode}: 閉じるBack待機中の戻るリンクは、閉じた画面からさらに一段戻る`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note);
    api.pushPhoneHistoryRoute(history, "scope", { ...note, searchAgentOpen: true });
    api.pushPhoneHistoryRoute(history, "scope", note);
    assert.equal(api.goBackInPhoneHistory(history, "scope"), true);
    assert.deepEqual(copiedState(api, history).route, { kind: "home" });
    assert.equal(history.pop(api), true);
    assert.deepEqual(copiedState(api, history).route, { kind: "home" });
    assert.equal(history.pop(api), false);
    assert.equal(history.position, 0);
    assert.deepEqual(history.goCalls, [-1, -1]);
    assert.equal(history.entries.length, 3);
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, note);
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, { ...note, searchAgentOpen: true });
  });

  test(`${mode}: 閉じるBackとnative Backが続いても一段ずつ戻り、Forwardでパネルを再び開ける`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", { ...note, searchAgentOpen: true }, scrollView(200));
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(300));
    history.go(-1);
    assert.equal(history.pop(api), true, "閉じるためのpopは画面復元を行わない");
    assert.equal(history.pop(api), false, "利用者のnative Backは通常どおり画面を復元する");
    assert.equal(history.position, 0);
    assert.deepEqual(copiedState(api, history).route, { kind: "home" });
    assert.deepEqual(history.goCalls, [-1, -1]);
    assert.equal(history.pushCalls, 2, "閉じる処理で新しいentryを挿入しない");
    history.go(1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(300));
    history.go(1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).route, { ...note, searchAgentOpen: true });
    assert.deepEqual(copiedState(api, history).view, scrollView(200));
  });

  test(`${mode}: 通常のBackによるパネル閉じはUI復元を行い、閉じる操作と同じ一段を戻る`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", { ...note, searchAgentOpen: true }, scrollView(200));
    assert.equal(api.goBackInPhoneHistory(history, "scope"), true);
    assert.equal(history.pop(api), false);
    assert.deepEqual(history.goCalls, [-1]);
    assert.deepEqual(copiedState(api, history).route, note);
    assert.deepEqual(copiedState(api, history).view, scrollView(100));
    history.go(1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).route, { ...note, searchAgentOpen: true });
    assert.deepEqual(copiedState(api, history).view, scrollView(200));
  });

  test(`${mode}: 通常の戻る処理中の位置保存と新画面pushも失わない`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });
    api.goBackInPhoneHistory(history, "scope");
    api.replacePhoneHistoryView(history, "scope", scrollView(600));
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "radio" });
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).route, { kind: "app", appId: "radio" });
    assert.equal(history.entries.length, 3);
    api.goBackInPhoneHistory(history, "scope");
    history.pop(api);
    assert.deepEqual(copiedState(api, history).route, note);
    assert.deepEqual(copiedState(api, history).view, scrollView(600));
  });

  test(`${mode}: 別ページやブラウザ内ページの変更はパネルを閉じるBackとみなさない`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
    api.pushPhoneHistoryRoute(history, "scope", { kind: "home" });
    const browser = { kind: "app", appId: "browser", contentId: "tab-1", page: { urls: ["https://example.test/a"], index: 0 } };
    api.pushPhoneHistoryRoute(history, "scope", browser);
    api.pushPhoneHistoryRoute(history, "scope", { ...browser, searchAgentOpen: true });
    api.pushPhoneHistoryRoute(history, "scope", { ...browser, page: { urls: ["https://example.test/b"], index: 0 } });
    assert.deepEqual(history.goCalls, []);
    assert.equal(history.entries.length, 6);
  });

  test(`${mode}: 同じページでも開く操作や直前に閉じたentryがない操作ではBackしない`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes", contentId: "note-1" };
    const open = { ...note, searchAgentOpen: true };
    api.replacePhoneHistoryRoute(history, "scope", open, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(200));
    api.pushPhoneHistoryRoute(history, "scope", open, scrollView(300));
    assert.deepEqual(history.goCalls, [], "開く操作で一段戻ることはない");
    assert.equal(history.entries.length, 3);
    assert.deepEqual(copiedState(api, history).view, scrollView(300));
    const otherNote = { ...note, contentId: "note-2" };
    api.pushPhoneHistoryRoute(history, "scope", otherNote, scrollView(400));
    assert.deepEqual(history.goCalls, [], "パネルを閉じても別ページへの移動は通常のpushになる");
    assert.equal(history.entries.length, 4);
    assert.deepEqual(copiedState(api, history).route, otherNote);
  });

  test(`${mode}: 閉じるpop前にscopeが変わっても古い画面や後続操作を書かない`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes", contentId: "old-note" };
    api.replacePhoneHistoryRoute(history, "old", { kind: "home" });
    const oldRoot = history.state;
    api.pushPhoneHistoryRoute(history, "old", note);
    api.pushPhoneHistoryRoute(history, "old", { ...note, searchAgentOpen: true });
    api.pushPhoneHistoryRoute(history, "old", note);
    api.pushPhoneHistoryRoute(history, "old", { kind: "app", appId: "photos" });
    api.replacePhoneHistoryRoute(history, "new", { kind: "home" }, scrollView(700));
    api.pushPhoneHistoryRoute(history, "new", { kind: "app", appId: "radio" });
    assert.deepEqual(copiedState(api, history, "new").route, { kind: "app", appId: "radio" });
    assert.equal(history.pop(api), true);
    assert.deepEqual(copiedState(api, history, "new").route, { kind: "app", appId: "radio" });
    assert.equal(copiedState(api, history, "new").index, 1);
    assert.equal(history.entries.length, 3, "閉じるBackで越えなかった旧scopeの根元entryは残る");
    assert.deepEqual(history.entries[0].state, oldRoot);
    assert.equal(history.travels.length, 0);
    if (isMemoryStorage) assert.equal(api.phoneHistoryStateFrom(oldRoot), null);
    api.goBackInPhoneHistory(history, "new");
    history.pop(api);
    assert.deepEqual(copiedState(api, history, "new").view, scrollView(700));
    assert.equal(api.goBackInPhoneHistory(history, "new"), false, "新scopeの根元から旧scopeへは戻るリンクで越えない");
    history.go(-1);
    history.pop(api);
    assert.equal(api.currentPhoneHistoryState(history, "new"), null, "native Backで旧scopeへ到着しても新scopeの画面として復元しない");
  });

  test(`${mode}: 連続スクロールはHistory APIを書かず、route置換には最新位置を含める`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes", contentId: "note-1" };
    api.replacePhoneHistoryRoute(history, "scope", note);
    for (let top = 10; top <= 10000; top += 10) {
      api.replacePhoneHistoryView(history, "scope", scrollView(top));
    }
    assert.equal(history.replaceCalls, 1);
    assert.equal(history.pushCalls, 0);
    assert.deepEqual(copiedState(api, history).view, scrollView(10000));
    api.replacePhoneHistoryRoute(history, "scope", { ...note, contentId: "note-2" });
    assert.equal(history.replaceCalls, 2);
    assert.deepEqual(structuredClone(api.phoneHistoryStateFrom(history.state).view), scrollView(10000));
  });

  test(`${mode}: 通常のbackとforwardで、History stateより新しいタブ内の表示位置を復元する`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" }, scrollView(100));
    api.replacePhoneHistoryView(history, "scope", scrollView(200));
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" }, scrollView(300));
    api.replacePhoneHistoryView(history, "scope", scrollView(400));
    const calls = history.replaceCalls;
    history.go(-1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).view, scrollView(200));
    api.replacePhoneHistoryView(history, "scope", scrollView(220));
    history.go(1);
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).view, scrollView(400));
    history.go(-1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(220));
    assert.equal(history.replaceCalls, calls);
  });

  test(`${mode}: native pop直後の離脱位置は出発entryだけに保存し、到着entryを上書きしない`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    const photo = { kind: "app", appId: "photos" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", photo, scrollView(300));
    const calls = { replace: history.replaceCalls, push: history.pushCalls };
    let captures = 0;

    history.go(-1);
    assert.equal(history.pop(api, (eventState) => {
      assert.equal(api.phoneHistoryMarkerFrom(eventState).index, 1, "Historyは既に到着先を指している");
      assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", photo, () => {
        captures += 1;
        return { appScroll: [{ path: [0], top: 400, left: 0, bottom: false }] };
      }), true);
    }), false);
    assert.equal(captures, 1);
    assert.deepEqual(copiedState(api, history).view, scrollView(100));

    history.go(1);
    assert.equal(history.pop(api, () => {
      assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", note, () => scrollView(220)), true);
    }), false);
    assert.deepEqual(copiedState(api, history).view, {
      appScroll: [{ path: [0], top: 400, left: 0 }],
      searchAgent: scrollView(300).searchAgent
    }, "取得していない検索AI位置は維持し、取得値は既存の正規化を通す");
    history.go(-1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(220));
    assert.deepEqual({ replace: history.replaceCalls, push: history.pushCalls }, calls,
      "離脱位置の取得と保存だけではHistory APIを書かない");
  });

  test(`${mode}: 離脱位置は未管理・別scope・実表示route不一致では取得せず、取得できなければ元位置を保つ`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes", contentId: "note-1" };
    let captures = 0;
    const capture = () => { captures += 1; return scrollView(900); };
    assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", note, capture), false);
    api.replacePhoneHistoryRoute(history, "scope", note, scrollView(100));
    const calls = { replace: history.replaceCalls, push: history.pushCalls };
    assert.equal(api.savePhoneHistoryViewBeforePop(history, "other", note, capture), false);
    for (const displayedRoute of [
      { kind: "home" },
      { ...note, contentId: "note-2" }
    ]) {
      assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", displayedRoute, capture), false);
    }
    assert.equal(captures, 0, "scopeと表示routeを確認してからDOMを取得する");
    assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", note, () => {
      captures += 1;
      return undefined;
    }), false);
    assert.equal(captures, 1);
    assert.deepEqual(copiedState(api, history).view, scrollView(100));
    assert.deepEqual({ replace: history.replaceCalls, push: history.pushCalls }, calls);
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });
    history.go(-1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(100));
    assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", { ...note, searchAgentOpen: true }, capture), true,
      "パネルの開閉が履歴と異なっても、同じページの位置を保存する");
    assert.deepEqual(copiedState(api, history).view, scrollView(900));
  });

  test(`${mode}: 閉じるpopと後続queueの待機中は離脱位置を取得せず、投影済み位置を守る`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", { ...note, searchAgentOpen: true }, scrollView(200));
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(300));
    let captures = 0;
    const capture = () => { captures += 1; return scrollView(900); };
    assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", note, capture), false);
    api.replacePhoneHistoryView(history, "scope", scrollView(350));
    assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", note, capture), false);
    assert.equal(captures, 0);
    history.finish(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(350));
    api.pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });
    history.go(-1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(350));
  });

  test(`${mode}: 戻るリンクのpop待機中はDOM位置を取り直さず、要求時のsnapshotを守る`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    const photo = { kind: "app", appId: "photos" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note, scrollView(100));
    api.pushPhoneHistoryRoute(history, "scope", photo, scrollView(300));
    api.replacePhoneHistoryView(history, "scope", scrollView(400));
    assert.equal(api.goBackInPhoneHistory(history, "scope"), true);
    let captures = 0;
    assert.equal(api.savePhoneHistoryViewBeforePop(history, "scope", note, () => {
      captures += 1;
      return scrollView(900);
    }), false);
    assert.equal(captures, 0, "plannedと表示routeが同じでもpending popでは取得しない");
    assert.equal(history.pop(api), false);
    assert.deepEqual(copiedState(api, history).view, scrollView(100));
    history.go(1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(400));
  });

  test(`${mode}: 閉じる待ちの大量スクロールは最後の位置を保持し、forwardの再利用とscope変更で古い位置を混ぜない`, () => {
    const api = memoryHistoryHarness(isMemoryStorage);
    const history = new AsyncFakeHistory();
    const note = { kind: "app", appId: "notes" };
    const photo = { kind: "app", appId: "photos" };
    api.replacePhoneHistoryRoute(history, "scope", { kind: "home" });
    api.pushPhoneHistoryRoute(history, "scope", note);
    api.pushPhoneHistoryRoute(history, "scope", { ...note, searchAgentOpen: true });
    api.pushPhoneHistoryRoute(history, "scope", note);
    for (let top = 10; top <= 10000; top += 10) {
      api.replacePhoneHistoryView(history, "scope", scrollView(top));
    }
    api.pushPhoneHistoryRoute(history, "scope", photo, scrollView(600));
    history.finish(api);
    assert.equal(history.replaceCalls, 1);
    assert.equal(history.pushCalls, 3);
    history.go(-1);
    history.pop(api);
    assert.deepEqual(copiedState(api, history).view, scrollView(10000));
    // 同じindex・同じrouteへ積み直しても、破棄したforwardのviewを拾わない。
    api.pushPhoneHistoryRoute(history, "scope", photo);
    assert.equal(copiedState(api, history).view, undefined);
    history.go(-1);
    history.pop(api);
    history.go(1);
    history.pop(api);
    assert.equal(copiedState(api, history).view, undefined);
    api.replacePhoneHistoryView(history, "scope", scrollView(700));
    api.replacePhoneHistoryRoute(history, "new", photo);
    assert.equal(copiedState(api, history, "new").view, undefined);
    assert.equal(copiedState(api, history, "new").index, 0);
  });
}
