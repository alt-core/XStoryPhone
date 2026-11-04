import assert from "node:assert/strict";
import test from "node:test";
import {
  capturePhoneHistoryScroll,
  restorePhoneHistoryScroll,
  trackPhoneHistoryScroll
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

function eventSurface(options = {}) {
  const listeners = new Map();
  return {
    addEventListener(name, handler, capture) {
      assert.equal(capture, true);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler, capture) {
      assert.equal(capture, true);
      listeners.get(name)?.delete(handler);
    },
    fire(name, target = this) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener({ target });
    },
    listenerCount(name) { return listeners.get(name)?.size ?? 0; },
    ...options
  };
}

test("親要素と既存 iframe 内の scroll を通知する", () => {
  const document = eventSurface();
  const iframe = frame(document);
  const root = eventSurface(element({ children: [element({ children: [iframe] })] }));
  let changes = 0;
  const action = trackPhoneHistoryScroll(root, () => { changes += 1; });
  root.fire("scroll");
  root.fire("scroll", root.children[0]);
  document.fire("scroll");
  assert.equal(changes, 3);
  assert.equal(document.listenerCount("scroll"), 1);
  action.destroy();
});

test("追加 iframe の load を拾い、再読み込みと destroy で以前の監視を解除する", () => {
  const root = eventSurface(element());
  let changes = 0;
  const action = trackPhoneHistoryScroll(root, () => { changes += 1; });
  const firstDocument = eventSurface();
  const iframe = frame(firstDocument);
  root.children.push(iframe);
  root.fire("load", iframe);
  root.fire("load", iframe);
  firstDocument.fire("scroll");
  assert.equal(changes, 1);
  assert.equal(firstDocument.listenerCount("scroll"), 1);

  const nextDocument = eventSurface();
  iframe.contentDocument = nextDocument;
  root.fire("load", iframe);
  assert.equal(firstDocument.listenerCount("scroll"), 0);
  firstDocument.fire("scroll");
  nextDocument.fire("scroll");
  assert.equal(changes, 2);

  action.destroy();
  assert.equal(root.listenerCount("scroll"), 0);
  assert.equal(root.listenerCount("load"), 0);
  assert.equal(nextDocument.listenerCount("scroll"), 0);
  root.fire("scroll");
  nextDocument.fire("scroll");
  iframe.contentDocument = eventSurface();
  root.fire("load", iframe);
  iframe.contentDocument.fire("scroll");
  assert.equal(changes, 2);
});

test("iframe がアクセス不可に変わっても古い文書の scroll 監視を残さない", () => {
  const document = eventSurface();
  const iframe = frame(document);
  const root = eventSurface(element({ children: [iframe] }));
  let changes = 0;
  const action = trackPhoneHistoryScroll(root, () => { changes += 1; });
  Object.defineProperty(iframe, "contentDocument", { get() { throw new Error("SecurityError"); } });
  assert.doesNotThrow(() => root.fire("load", iframe));
  assert.equal(document.listenerCount("scroll"), 0);
  document.fire("scroll");
  root.fire("scroll");
  assert.equal(changes, 1);
  action.destroy();
  assert.doesNotThrow(() => trackPhoneHistoryScroll(root, () => {}).destroy());
});

test("iframe 要素の置換後の load で、取り除かれた文書の監視を解除する", () => {
  const oldDocument = eventSurface();
  const root = eventSurface(element({ children: [frame(oldDocument)] }));
  const action = trackPhoneHistoryScroll(root, () => {});
  const nextDocument = eventSurface();
  root.children[0] = frame(nextDocument);
  root.fire("load", root.children[0]);
  assert.equal(oldDocument.listenerCount("scroll"), 0);
  assert.equal(nextDocument.listenerCount("scroll"), 1);
  action.destroy();
  assert.equal(nextDocument.listenerCount("scroll"), 0);
});

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
