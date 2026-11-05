import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  consumeConversationScroll,
  rememberConversationScrollForLink,
  restoreConversationScrollAfterTick,
  scrollConversationToBottomAfterTick
} from "../src/client/apps/conversationScrollMemory.ts";
import {
  capturePhoneHistoryScroll,
  restorePhoneHistoryScroll
} from "../src/client/system/phoneHistoryScroll.ts";

function element(options = {}) {
  return {
    tagName: "DIV",
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 100,
    clientHeight: 100,
    scrollWidth: 100,
    clientWidth: 100,
    children: [],
    getAttribute(name) { return this.attributes?.[name] ?? null; },
    hasAttribute(name) { return this.getAttribute(name) !== null; },
    contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
    ...options
  };
}

function frame(document, source = "/page.html") {
  const listeners = new Set();
  return element({
    tagName: "IFRAME",
    contentDocument: document,
    getAttribute: (name) => name === "src" ? source : null,
    hasAttribute: () => false,
    addEventListener: (_name, handler) => listeners.add(handler),
    removeEventListener: (_name, handler) => listeners.delete(handler),
    load() {
      for (const listener of [...listeners]) listener();
    },
    listeners
  });
}

test("ルートと子要素のスクロール位置を要素のパスで保存・復元する", () => {
  const inner = element({ scrollTop: 360, scrollLeft: 25 });
  const root = element({
    scrollTop: 10,
    children: [element(), element({ scrollHeight: 200, children: [inner] })]
  });
  const positions = capturePhoneHistoryScroll(root);
  assert.deepEqual(positions, [
    { path: [], top: 10, left: 0 },
    { path: [1], top: 0, left: 0 },
    { path: [1, 0], top: 360, left: 25 }
  ]);

  root.scrollTop = 0;
  root.children[1].scrollTop = 35;
  inner.scrollTop = 0;
  inner.scrollLeft = 0;
  restorePhoneHistoryScroll(root, [...positions, { path: [9, 0], top: 99, left: 0 }]);
  assert.equal(root.scrollTop, 10);
  assert.equal(root.children[1].scrollTop, 0);
  assert.equal(inner.scrollTop, 360);
  assert.equal(inner.scrollLeft, 25);
  assert.deepEqual(capturePhoneHistoryScroll(null), []);
  assert.doesNotThrow(restorePhoneHistoryScroll(null, positions));
});

test("同一オリジンの iframe を保存し、読み込み完了時にも一度だけ復元する", () => {
  const oldPage = element({ scrollTop: 440, scrollLeft: 20 });
  const iframe = frame({ scrollingElement: oldPage, readyState: "loading" });
  const root = element({ children: [iframe] });
  const positions = capturePhoneHistoryScroll(root);
  assert.deepEqual(positions, [{ path: [0], top: 440, left: 20, frame: true }]);
  oldPage.scrollTop = 0;
  const cleanup = restorePhoneHistoryScroll(root, positions);
  assert.equal(oldPage.scrollTop, 440);

  const loadedPage = element();
  iframe.contentDocument = { scrollingElement: loadedPage, readyState: "complete" };
  iframe.load();
  assert.equal(loadedPage.scrollTop, 440);
  assert.equal(loadedPage.scrollLeft, 20);
  loadedPage.scrollTop = 700;
  iframe.load();
  assert.equal(loadedPage.scrollTop, 700);
  assert.equal(iframe.listeners.size, 0);
  cleanup();
});

test("location.replace 直後に旧 document が完了済みでも次の load で復元する", () => {
  const iframe = frame({ scrollingElement: element(), readyState: "complete", URL: "/page.html" });
  restorePhoneHistoryScroll(element({ children: [iframe] }), [{ path: [0], top: 90, left: 0, frame: true }]);
  assert.equal(iframe.contentDocument.scrollingElement.scrollTop, 90);
  iframe.contentDocument = { scrollingElement: element(), readyState: "complete", URL: "/returned-page.html" };
  iframe.load();
  assert.equal(iframe.contentDocument.scrollingElement.scrollTop, 90);
  assert.equal(iframe.listeners.size, 0);
});

test("挿入直後の about:blank は実際のページの読み込みを待つ", () => {
  const iframe = frame({ scrollingElement: element(), readyState: "complete", URL: "about:blank" });
  restorePhoneHistoryScroll(element({ children: [iframe] }), [{ path: [0], top: 90, left: 0, frame: true }]);
  iframe.contentDocument = { scrollingElement: element(), readyState: "complete", URL: "/page.html" };
  iframe.load();
  assert.equal(iframe.contentDocument.scrollingElement.scrollTop, 90);
});

test("アクセス不可の iframe は保存・復元を妨げない", () => {
  const iframe = frame(null);
  Object.defineProperty(iframe, "contentDocument", { get() { throw new Error("SecurityError"); } });
  const root = element({ children: [iframe] });
  assert.deepEqual(capturePhoneHistoryScroll(root), []);
  const cleanup = restorePhoneHistoryScroll(root, [{ path: [0], top: 90, left: 0, frame: true }]);
  assert.doesNotThrow(() => iframe.load());
  cleanup();
});

test("cleanup または画面要素の置換後は以前の iframe の load を適用しない", () => {
  const iframe = frame({ scrollingElement: element(), readyState: "loading" });
  const root = element({ children: [iframe] });
  const positions = [{ path: [0], top: 90, left: 0, frame: true }];
  const cleanup = restorePhoneHistoryScroll(root, positions);
  cleanup();
  iframe.contentDocument = { scrollingElement: element() };
  iframe.load();
  assert.equal(iframe.contentDocument.scrollingElement.scrollTop, 0);
  assert.equal(iframe.listeners.size, 0);

  restorePhoneHistoryScroll(root, positions);
  root.children[0] = element();
  iframe.contentDocument = { scrollingElement: element() };
  iframe.load();
  assert.equal(iframe.contentDocument.scrollingElement.scrollTop, 0);
});

function conversationList(scrollHeight, scrollTop) {
  const list = element({
    attributes: { "data-phone-history-scroll": "conversation" },
    scrollHeight,
    clientHeight: 500,
    dispatchEvent() { return true; }
  });
  let top = 0;
  // scrollTopにscrollHeightを代入しても、実DOMでは最大位置で止まる。
  Object.defineProperty(list, "scrollTop", {
    get() { return top; },
    set(value) { top = Math.max(0, Math.min(value, list.scrollHeight - list.clientHeight)); }
  });
  list.scrollTop = scrollTop;
  return list;
}

for (const appId of ["messages", "chat"]) {
  test(`${appId}の実会話履歴だけに会話用の位置復元方針を付ける`, () => {
    const name = appId === "messages" ? "MessagesApp" : "ChatApp";
    const source = readFileSync(new URL(`../src/client/apps/${name}.svelte`, import.meta.url), "utf8");
    const historyTag = source.match(/<div\b[^>]*bind:this=\{historyList\}[^>]*>/)?.[0] ?? "";
    assert.match(historyTag, /data-phone-history-scroll="conversation"/);
    assert.equal(source.match(/data-phone-history-scroll="conversation"/g)?.length, 1);
  });

  for (const departure of ["home", "link"]) {
    test(`${appId}: ${departure}経由で不在中に返信が増えても、末尾付近は最新、途中は元の位置を表示する`, async (t) => {
      const previousWindow = globalThis.window;
      globalThis.window = { requestAnimationFrame(callback) { callback(); } };
      t.after(() => {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      });

      for (const distanceFromBottom of [0, 120, 121, 500]) {
        const oldTop = 1218 - distanceFromBottom;
        const oldList = conversationList(1718, oldTop);
        const saved = capturePhoneHistoryScroll(element({ children: [oldList] }));
        assert.deepEqual(saved, [{
          path: [0], top: oldTop, left: 0,
          ...(distanceFromBottom <= 120 ? { bottom: true } : {})
        }]);
        const threadId = `phone-history-${departure}-${distanceFromBottom}`;
        if (departure === "link") rememberConversationScrollForLink(appId, threadId, oldList);

        const returnedList = conversationList(2018, 0);
        const root = element({ children: [returnedList] });
        const remembered = consumeConversationScroll(appId, threadId);
        if (remembered === undefined) scrollConversationToBottomAfterTick(() => returnedList);
        else restoreConversationScrollAfterTick(() => returnedList, remembered);
        await new Promise(setImmediate);

        // 会話自身の初期表示後に、Appの汎用復元が二度走っても新着を隠さない。
        restorePhoneHistoryScroll(root, saved);
        restorePhoneHistoryScroll(root, saved);
        assert.equal(returnedList.scrollTop, distanceFromBottom <= 120 ? 1518 : oldTop, `末尾から${distanceFromBottom}px`);
      }
    });
  }
}

test("会話DOMを作り直さない検索パネルの戻る・進むでも、保存した末尾表示を復元する", () => {
  for (const [height, top, laterHeight, readingTop] of [[1718, 1218, 1718, 500], [500, 0, 900, 100]]) {
    const list = conversationList(height, top);
    const root = element({ children: [list] });
    const panelOpenView = capturePhoneHistoryScroll(root);

    // 最初は短い会話も後で伸び得る。上読み後の進むでは、初期表示helperを実行しない。
    list.scrollHeight = laterHeight;
    list.scrollTop = readingTop;
    restorePhoneHistoryScroll(root, panelOpenView);
    assert.equal(list.scrollTop, laterHeight - list.clientHeight, `検索を開いた時の会話の高さ${height}px`);
  }
});

test("会話の末尾を記録しても、横スクロールしたQuick Replyの子要素を保存・復元する", () => {
  const list = conversationList(1718, 1218);
  const replies = element({ scrollWidth: 500, clientWidth: 100, scrollLeft: 80 });
  list.children = [replies];
  const saved = capturePhoneHistoryScroll(list);
  assert.deepEqual(saved, [
    { path: [], top: 1218, left: 0, bottom: true },
    { path: [0], top: 0, left: 80 }
  ]);
  list.scrollTop = 500;
  replies.scrollLeft = 0;
  restorePhoneHistoryScroll(list, saved);
  assert.equal(list.scrollTop, 1218);
  assert.equal(replies.scrollLeft, 80);
});

test("無印の文書は末尾100px手前でも、内容が増えた後に元の絶対位置を復元する", () => {
  const document = element({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1400 });
  const saved = capturePhoneHistoryScroll(document);
  document.scrollHeight = 2300;
  document.scrollTop = 1800;
  restorePhoneHistoryScroll(document, saved);
  assert.equal(document.scrollTop, 1400);
});

test("iframeは末尾100px手前でも、読み込み直後の元の絶対位置を復元する", () => {
  const oldPage = element({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1400 });
  const iframe = frame({ scrollingElement: oldPage });
  const root = element({ children: [iframe] });
  const saved = capturePhoneHistoryScroll(root);
  restorePhoneHistoryScroll(root, saved);

  const loadedPage = element({ scrollHeight: 2300, clientHeight: 500, scrollTop: 1800 });
  iframe.contentDocument = { scrollingElement: loadedPage };
  iframe.load();
  assert.equal(loadedPage.scrollTop, 1400);
});
