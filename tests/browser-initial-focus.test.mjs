import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { compile } from "svelte/compiler";
import * as serverRuntime from "svelte/internal/server";
import { render } from "svelte/server";
import ts from "typescript";
import { browserAppHarness, browserPagesModule } from "./helpers/browser-app-harness.mjs";

const browserUrl = new URL("../src/client/apps/BrowserApp.svelte", import.meta.url);
const source = readFileSync(browserUrl, "utf8");
const tabs = [
  { id: "A", contentId: "first", title: "先頭タブ", url: "/first.html", allowedUrls: ["/first-next.html"] },
  { id: "B", contentId: "second", title: "指定タブ", url: "/second.html" }
];
const resourceUrl = (url) => url;
const windowStub = { location: { origin: "http://localhost" } };
const compiled = ts.transpileModule(compile(source, { filename: "BrowserApp.svelte", generate: "server" }).js.code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function renderBrowser(props) {
  const childStub = (renderer, componentProps) => componentProps.children?.(renderer);
  const sandbox = {
    exports: {}, URL, window: windowStub,
    require(name) {
      if (name === "svelte/internal/server") return serverRuntime;
      if (name === "svelte") return { onDestroy() {}, tick: async () => {} };
      if (name === "@lucide/svelte") return Object.fromEntries(["ArrowLeft", "Globe2"].map((key) => [key, () => {}]));
      if (name === "../system/browserPages.ts") return browserPagesModule({ resourceUrl, window: windowStub });
      if (name === "../system/corruptionNoise") return { corruptionNoiseStyle: () => "" };
      if (name.endsWith(".svelte")) return { __esModule: true, default: childStub };
      throw new Error(`想定外の依存: ${name}`);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(compiled, sandbox);
  return render(sandbox.exports.default, { props }).body;
}

for (const focusContentId of ["second", "B"]) {
  test(`初回指定${focusContentId}ではBのiframeと開封通知だけを生成する`, () => {
    const opened = [];
    const html = renderBrowser({ tabs, focusContentId, focusContentRequestId: 8, onContentOpen(id) { opened.push(id); } });
    assert.match(html, /<iframe[^>]*src="\/second.html"/);
    assert.doesNotMatch(html, /<iframe[^>]*src="\/first.html"/);
    assert.deepEqual(opened, ["second"]);
  });
}

test("一覧の指定や見つからないタブの指定では、無関係なタブを開封せずタブ一覧を出す", () => {
  for (const focusContentId of ["", "missing"]) {
    const opened = [];
    const html = renderBrowser({ tabs, focusContentId, onContentOpen(id) { opened.push(id); } });
    assert.doesNotMatch(html, /<iframe/);
    assert.match(html, /aria-label="タブ一覧"/);
    assert.deepEqual(opened, []);
  }
});

test("空リストと破損した指定タブは無関係な先頭ページを開封しない", () => {
  const opened = [];
  const blocked = [];
  const empty = renderBrowser({ tabs: [], focusContentId: "second", onContentOpen(id) { opened.push(id); } });
  assert.doesNotMatch(empty, /<iframe/);
  const corrupted = renderBrowser({
    tabs: [tabs[0], { ...tabs[1], corrupted: true }], focusContentId: "second",
    onContentOpen(id) { opened.push(id); }, onBlockedContentOpen(id) { blocked.push(id); }
  });
  assert.doesNotMatch(corrupted, /<iframe/);
  assert.match(corrupted, /aria-label="タブ一覧"/);
  assert.deepEqual(opened, []);
  assert.deepEqual(blocked, ["second"]);
});

test("同じcomponentの次のfocus要求は引き続きタブを切り替える", () => {
  const opened = [];
  const { harness } = browserAppHarness({
    tabs, focusContentId: "second", focusContentRequestId: 8,
    onContentOpen(id) { opened.push(id); }
  }, { resourceUrl });
  assert.equal(harness.evaluate("frameSourceUrl"), "/second.html");
  harness.update({ focusContentId: "first", focusContentRequestId: 9 });
  assert.equal(harness.evaluate("frameSourceUrl"), "/first.html");
  assert.deepEqual(opened, ["second", "first"]);
});

test("タブ一覧を挟んで同じタブを開き直すたびに開封し、一覧と詳細の操作を報告する", () => {
  const opened = [];
  const navigations = [];
  const displayed = [];
  const { harness } = browserAppHarness({
    tabs, focusContentId: "first", focusContentRequestId: 1,
    onContentOpen(id) { opened.push(id); },
    onNavigate(id) { navigations.push(id); },
    onDisplayedContentChange(id) { displayed.push(id); }
  }, { resourceUrl });
  harness.evaluate("returnToTabList();");
  harness.flush();
  harness.evaluate("selectTab(tabs[0]);");
  harness.flush();
  assert.deepEqual(opened, ["first", "first"]);
  assert.deepEqual(navigations, ["", "first"]);
  assert.deepEqual(displayed, ["first", "", "first"]);
});

test("破損タブを選んでも開かず、ノイズと案内のための報告だけを出す", () => {
  const opened = [];
  const navigations = [];
  const blocked = [];
  const { harness } = browserAppHarness({
    tabs: [tabs[0], { ...tabs[1], corrupted: true }], focusContentId: "",
    onContentOpen(id) { opened.push(id); },
    onNavigate(id) { navigations.push(id); },
    onBlockedContentOpen(id) { blocked.push(id); }
  }, { resourceUrl });
  harness.evaluate("selectTab(tabs[1]);");
  harness.flush();
  assert.equal(harness.evaluate("openTabId"), "");
  assert.deepEqual(opened, []);
  assert.deepEqual(navigations, []);
  assert.deepEqual(blocked, ["second"]);
});

test("タブ一覧から開き直したタブは前のページ履歴を保ち、アプリ内の戻るボタンで元のページへ戻れる", () => {
  const navigations = [];
  const frame = { contentWindow: { location: { replace(url) { navigations.push(url); } } } };
  const browser = browserAppHarness({ tabs, focusContentId: "first", focusContentRequestId: 1 }, { resourceUrl, frame });
  const { harness, pageEvents } = browser;
  harness.evaluate("frameElement = frame;");
  harness.evaluate('navigateWithinTab(openTab, "http://localhost/first-next.html");');
  assert.equal(harness.evaluate("canGoBack"), true);
  harness.evaluate("returnToTabList();");
  harness.flush();
  harness.evaluate("selectTab(tabs[1]);");
  harness.flush();
  harness.evaluate("returnToTabList();");
  harness.flush();
  harness.evaluate("selectTab(tabs[0]);");
  harness.flush();
  assert.equal(harness.evaluate("openUrl"), "/first-next.html");
  assert.equal(harness.evaluate("canGoBack"), true, "別タブを経由しても戻るボタンを出す");
  harness.evaluate("frameElement = frame;");
  harness.evaluate("navigateBack();");
  assert.equal(harness.evaluate("openUrl"), "/first.html");
  assert.equal(harness.evaluate("canGoBack"), false);
  assert.deepEqual(pageEvents.map((event) => [event.contentId, event.mode, event.page.index]), [["first", "push", 1], ["first", "push", 0]]);
});

test("履歴の復元でページ履歴が変わると、同じタブのまま表示とアプリ内の戻るボタンを合わせる", () => {
  const navigations = [];
  const frame = { contentWindow: { location: { replace(url) { navigations.push(url); } } } };
  const browser = browserAppHarness({ tabs, focusContentId: "first", focusContentRequestId: 1 }, { resourceUrl, frame });
  const { harness } = browser;
  harness.evaluate("frameElement = frame;");
  browser.setPages({ first: { urls: ["/first.html", "/first-next.html"], index: 1 } });
  assert.equal(navigations.at(-1), "http://localhost/first-next.html");
  assert.equal(harness.evaluate("canGoBack"), true);
  browser.setPages({ first: { urls: ["/first.html", "/first-next.html"], index: 0 } });
  assert.equal(navigations.at(-1), "http://localhost/first.html");
  assert.equal(harness.evaluate("canGoBack"), false);
});

// load後のDocumentへのクリックを、実scriptの捕捉処理へ渡す。
function pageDocument(path, title = "ページの題名") {
  const listeners = new Set();
  const document = {
    location: { href: `http://localhost${path}` }, title, added: 0, removed: 0,
    addEventListener(name, callback, capture) {
      assert.equal(name, "click"); assert.equal(capture, true);
      listeners.add(callback); document.added += 1;
    },
    removeEventListener(name, callback, capture) {
      assert.equal(name, "click"); assert.equal(capture, true);
      listeners.delete(callback); document.removed += 1;
    },
    click(path, { target = "", download = false } = {}) {
      let prevented = false;
      const anchor = { href: new URL(path, document.location.href).href, target, hasAttribute: (name) => name === "download" && download };
      for (const callback of listeners) callback({ target: { closest: () => anchor }, preventDefault() { prevented = true; } });
      return prevented;
    }
  };
  return document;
}

function frameFor(document = null) {
  const frame = {
    contentDocument: document,
    contentWindow: { location: { replace(url) {
      const current = frame.contentDocument;
      const next = new URL(url);
      const previous = current && new URL(current.location.href);
      if (previous && next.origin === previous.origin && next.pathname === previous.pathname && next.search === previous.search) current.location.href = url;
    } } }
  };
  return { frame };
}

test("許可された転送先のloadは現在の段を置換し、元URLへ戻るループを作らない", () => {
  const { frame } = frameFor(pageDocument("/first-next.html", "転送先の題名"));
  const browser = browserAppHarness({ tabs }, { resourceUrl, frame });
  browser.harness.evaluate("frameElement = frame; handleFrameLoad();");
  assert.deepEqual(structuredClone(browser.pages.first), { urls: ["/first-next.html"], index: 0 });
  assert.deepEqual(browser.pageEvents.map((event) => event.mode), ["replace"]);
  assert.equal(browser.harness.evaluate("canGoBack"), false);
  assert.equal(browser.harness.evaluate("pageTitle"), "転送先の題名");
  browser.harness.destroy();
});

test("hash移動と戻るはクリック捕捉とHTMLの題名を保ち、その後も許可したリンクだけを履歴へ積む", () => {
  const noise = [];
  const document = pageDocument("/first.html", "HTMLの題名");
  const { frame } = frameFor(document);
  const browser = browserAppHarness({ tabs, onNoise: () => noise.push(true) }, { resourceUrl, frame });
  browser.harness.evaluate("frameElement = frame; handleFrameLoad();");
  assert.equal(document.click("#one"), true);
  assert.equal(document.click("#two"), true);
  browser.harness.evaluate("navigateBack();");
  assert.equal(browser.harness.evaluate("openUrl"), "/first.html#one");
  assert.equal(document.removed, 0);
  assert.equal(document.added, 1);
  assert.equal(browser.harness.evaluate("pageTitle"), "HTMLの題名");

  assert.equal(document.click("/blocked.html"), true);
  assert.equal(document.click("https://outside.example.test/page"), true);
  assert.equal(document.click("/first-next.html", { target: "_blank" }), true);
  assert.equal(document.click("/first-next.html", { download: true }), true);
  assert.equal(noise.length, 4);
  assert.equal(browser.pageEvents.length, 3, "許可外のクリックでは履歴を増やさない");

  assert.equal(document.click("/first-next.html"), true, "hash移動の後も次のリンクを捕捉する");
  assert.deepEqual(structuredClone(browser.pages.first), { urls: ["/first.html", "/first.html#one", "/first-next.html"], index: 2 });
  frame.contentDocument = pageDocument("/first-next.html", "次ページの題名");
  browser.harness.evaluate("handleFrameLoad();");
  assert.equal(document.removed, 1);
  assert.equal(browser.harness.evaluate("pageTitle"), "次ページの題名");
  assert.deepEqual(browser.pageEvents.map((event) => event.mode), ["push", "push", "push", "push"], "通常のリンクをloadで置き換えない");
  browser.harness.evaluate("navigateBack();");
  frame.contentDocument = document;
  browser.harness.evaluate("handleFrameLoad();");
  assert.equal(browser.harness.evaluate("openUrl"), "/first.html#one");
  assert.equal(browser.harness.evaluate("pageTitle"), "HTMLの題名");
  assert.equal(document.click("#three"), true, "別ページから戻った後もリンクを捕捉する");
  browser.harness.destroy();
});
