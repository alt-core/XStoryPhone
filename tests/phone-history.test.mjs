import assert from "node:assert/strict";
import test from "node:test";
import {
  goBackInPhoneHistory,
  goToPhoneHistoryHome,
  phoneHistoryStateFrom,
  pushPhoneHistoryRoute,
  replacePhoneHistoryRoute
} from "../src/client/system/phoneHistory.ts";

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
    route: { kind: "app", appId: "notes" }
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

test("端末ホームは管理履歴の起点へ戻り、起点では履歴を増やさない", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "notes" });
  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "photos" });

  assert.equal(goToPhoneHistoryHome(history, "scope"), true);
  assert.deepEqual(history.goCalls, [-2]);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, { kind: "home" });

  assert.equal(goToPhoneHistoryHome(history, "scope"), false);
  assert.equal(history.entries.length, 3);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, { kind: "home" });
});

test("戻るリンクは同じスコープの直前画面がある場合だけブラウザ履歴を使う", () => {
  const history = new FakeHistory();
  replacePhoneHistoryRoute(history, "scope", { kind: "home" });
  assert.equal(goBackInPhoneHistory(history, "scope"), false);

  pushPhoneHistoryRoute(history, "scope", { kind: "app", appId: "messages" });
  assert.equal(goBackInPhoneHistory(history, "scope"), true);
  assert.equal(history.backCalls, 1);
  assert.deepEqual(phoneHistoryStateFrom(history.state, "scope")?.route, { kind: "home" });
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
