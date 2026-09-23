import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { compile } from "svelte/compiler";
import * as serverRuntime from "svelte/internal/server";
import { render } from "svelte/server";
import ts from "typescript";
import { pathnameKey, resolveResourceUrl, resolveStaticUrl } from "../src/shared/deploymentUrls.ts";
import { componentFunctionHarness, componentScriptHarness } from "./helpers/component-script-harness.mjs";
import { noticeTextSegments } from "../src/client/system/noticeText.ts";

const staticBase = "/works/story/";
const staticOrigin = "https://site.example.test";
const apiOrigin = "https://api.example.test";
const resourceUrl = (url) => resolveResourceUrl(url, staticBase, apiOrigin);
const staticUrl = (url) => resolveStaticUrl(url, staticBase);
const browserFile = new URL("../src/client/apps/BrowserApp.svelte", import.meta.url);
const radioFile = new URL("../src/client/apps/RadioApp.svelte", import.meta.url);

function renderComponent(relative, props = {}, resolveUrl = resourceUrl) {
  const source = readFileSync(new URL(`../src/client/${relative}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(compile(source, { filename: relative, generate: "server" }).js.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const componentStub = (renderer, componentProps) => componentProps.children?.(renderer);
  const sandbox = {
    exports: {}, URL,
    window: { addEventListener() {}, removeEventListener() {}, setTimeout() { return 1; }, clearTimeout() {} },
    require(name) {
      if (name === "svelte/internal/server") return serverRuntime;
      if (name === "svelte") return { onDestroy() {}, onMount() {}, tick: async () => {} };
      if (name === "@lucide/svelte") return new Proxy({}, { get: () => componentStub });
      if (name.endsWith("/resourceUrls")) return { resourceUrl: resolveUrl, staticUrl };
      if (name.endsWith("/noticeText")) return { noticeTextSegments };
      if (name.endsWith("/audioEngine")) return { stopAudioPlayback() {} };
      if (name.endsWith("/appCatalog")) return { appCatalog: [] };
      if (name.endsWith("/corruptionNoise")) return { corruptionNoiseStyle: () => "" };
      if (name.endsWith(".svelte")) return { __esModule: true, default: componentStub };
      throw new Error(`想定外の依存: ${name}`);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(compiled, sandbox);
  return render(sandbox.exports.default, { props }).body;
}

test("開始告知は実Svelte描画でもHTMLを実行せず、対応した強調だけを表示する", () => {
  const html = renderComponent("system/StartConfirmationScreen.svelte", { notices: '<img src=x onerror=alert(1)>\n**確認事項**\n**未閉鎖' });
  assert.doesNotMatch(html, /<img src=x/u);
  assert.match(html, /&lt;img/u);
  assert.match(html, /<strong>確認事項<\/strong>/u);
  assert.match(html, /\*\*未閉鎖/u);
});

for (const [component, props, expected] of [
  ["system/AttachmentImageFrame.svelte", { src: "/media/attachment.webp" }, "/works/story/media/attachment.webp"],
  ["system/UserAvatar.svelte", { src: "/media/avatar.webp" }, "/works/story/media/avatar.webp"],
  ["system/VideoStillFrame.svelte", {}, "/works/story/system/audio-only-video-thumbnail.png"],
  ["system/GameOverOverlay.svelte", { visible: true, imageUrl: "/media/game-over.webp" }, "/works/story/media/game-over.webp"],
  ["system/AllClearOverlay.svelte", { visible: true, imageUrl: "/media/all-clear.webp" }, "/works/story/media/all-clear.webp"],
  ["system/HomeScreen.svelte", { deviceState: {}, apps: [{ id: "locked", available: false }] }, "/works/story/system/broken-app-icon-noise.png"],
  ["apps/PhotoMessagePicker.svelte", { open: true, photos: [{ id: "photo", imageUrl: "/media/photo.webp" }] }, "/works/story/media/photo.webp"],
  ["apps/PhotosApp.svelte", { photos: [{ id: "photo", imageUrl: "/media/photo.webp" }] }, "/works/story/media/photo.webp"]
]) {
  test(`${component}は表示境界で静的画像のサブパスを解決する`, () => {
    assert.ok(renderComponent(component, props).includes(`src="${expected}"`));
  });
}

test("動画のsrcとposterを別々に解決し、外部の絶対URLは維持する", () => {
  const html = renderComponent("system/VideoPlayback.svelte", {
    src: "/media/video.mp4", poster: "/media/poster.webp"
  });
  assert.ok(html.includes('src="/works/story/media/video.mp4"'));
  assert.ok(html.includes('poster="/works/story/media/poster.webp"'));
  const external = renderComponent("system/VideoPlayback.svelte", {
    src: "https://media.example.test/video.mp4", poster: "https://media.example.test/poster.webp"
  });
  assert.ok(external.includes('src="https://media.example.test/video.mp4"'));
  assert.ok(external.includes('poster="https://media.example.test/poster.webp"'));
});

test("素材の先頭名がbaseと同じ場合も画像・動画は一度だけ配置先を前置する", () => {
  const resolveUrl = (url) => resolveResourceUrl(url, "/demo/", apiOrigin);
  for (const component of ["AttachmentImageFrame", "UserAvatar", "VideoStillFrame"]) {
    const html = renderComponent(`system/${component}.svelte`, { src: "/demo/image.webp" }, resolveUrl);
    assert.ok(html.includes('src="/demo/demo/image.webp"'));
    assert.ok(!html.includes("/demo/demo/demo/"));
  }
  const video = renderComponent("system/VideoPlayback.svelte", {
    src: "/demo/video.mp4", poster: "/demo/poster.webp"
  }, resolveUrl);
  assert.ok(video.includes('src="/demo/demo/video.mp4"'));
  assert.ok(video.includes('poster="/demo/demo/poster.webp"'));
});

test("壁紙のCSSカスタムプロパティも静的base配下を参照する", () => {
  const html = renderComponent("system/PhoneFrame.svelte", { deviceState: {}, wallpaperUrl: "/media/wallpaper.webp" });
  assert.ok(html.includes("/works/story/media/wallpaper.webp"));
});

for (const [component, props, fragment] of [
  ["system/GlobalErrorScreen.svelte", {}, ""],
  ["system/StartConfirmationScreen.svelte", {}, ""],
  ["system/NotificationShade.svelte", { open: true }, "#contact"],
  ["system/NotificationShade.svelte", { open: true }, "#privacy"]
]) {
  test(`${component}のprivacyリンク${fragment}は静的baseとfragmentを保つ`, () => {
    assert.ok(renderComponent(component, props).includes(`href="/works/story/privacy-policy.html${fragment}"`));
  });
}

test("Browserは作品HTMLとallowedUrlsを同じ静的baseへ解決し、ページ内リンク・戻るを維持する", () => {
  const navigations = [];
  const noisy = [];
  const tabs = [{ id: "first", title: "作品ページ", url: "/pages/first.html", allowedUrls: ["/pages/details.html"] }];
  const original = structuredClone(tabs);
  const harness = componentScriptHarness(browserFile, { tabs, onNoise: () => noisy.push(true) }, {
    URL, pathnameKey, window: { location: { origin: staticOrigin } }, resourceUrl, corruptionNoiseStyle: () => "",
    frame: { contentWindow: { location: { replace(url) { navigations.push(url); } } } }
  });
  assert.equal(harness.evaluate("frameSourceUrl"), "/works/story/pages/first.html");
  harness.evaluate("frameElement = frame;");
  harness.evaluate(`navigateWithinTab(selectedTab, ${JSON.stringify(`${staticOrigin}/works/story/pages/details.html#note`)});`);
  assert.equal(navigations.at(-1), `${staticOrigin}/works/story/pages/details.html#note`);
  harness.evaluate("navigateBack();");
  assert.equal(navigations.at(-1), `${staticOrigin}/works/story/pages/first.html`);
  harness.evaluate(`navigateWithinTab(selectedTab, ${JSON.stringify(`${staticOrigin}/works/story/pages/blocked.html`)});`);
  harness.evaluate('navigateWithinTab(selectedTab, "https://outside.example.test/works/story/pages/details.html");');
  assert.equal(navigations.length, 2);
  assert.equal(noisy.length, 2);
  assert.deepEqual(tabs, original);
});

test("BrowserはページのDOM・title・相対リンクを読み、許可した静的ページだけへ遷移する", () => {
  const navigations = [];
  const listenerEvents = [];
  const document = {
    location: { href: `${staticOrigin}/works/story/pages/first.html` }, title: " ページから得た見出し ",
    addEventListener(...args) { listenerEvents.push(args); }, removeEventListener() {}
  };
  const frame = { contentDocument: document, contentWindow: { location: { replace(url) { navigations.push(url); } } } };
  const harness = componentScriptHarness(browserFile, {
    tabs: [{ id: "first", title: "作品ページ", url: "/pages/first.html", allowedUrls: ["/pages/details.html"] }]
  }, { URL, pathnameKey, window: { location: { origin: staticOrigin } }, resourceUrl, corruptionNoiseStyle: () => "", frame });
  harness.evaluate("frameElement = frame; handleFrameLoad();");
  assert.equal(harness.evaluate("pageTitle"), "ページから得た見出し");
  assert.equal(listenerEvents[0][0], "click");
  let prevented = false;
  listenerEvents[0][1]({
    preventDefault() { prevented = true; },
    target: { closest: () => ({ href: new URL("details.html", document.location.href).href, target: "", hasAttribute: () => false }) }
  });
  assert.equal(prevented, true);
  assert.equal(navigations.at(-1), `${staticOrigin}/works/story/pages/details.html`);
});

test("Browserはbaseと同名の作品pathを保持し、DOM由来URLや戻る履歴へ再度baseを加えない", () => {
  const navigations = [];
  const tabs = [{ id: "first", title: "作品ページ", url: "/demo/first.html", allowedUrls: ["/demo/details.html"] }];
  const frame = { contentWindow: { location: { replace(url) { navigations.push(url); } } } };
  const harness = componentScriptHarness(browserFile, { tabs }, {
    URL, pathnameKey, window: { location: { origin: staticOrigin } }, frame,
    resourceUrl: (url) => resolveResourceUrl(url, "/demo/", apiOrigin), corruptionNoiseStyle: () => ""
  });
  assert.equal(harness.evaluate("frameSourceUrl"), "/demo/demo/first.html");
  harness.evaluate("frameElement = frame;");
  harness.evaluate(`navigateWithinTab(selectedTab, ${JSON.stringify(`${staticOrigin}/demo/demo/details.html`)});`);
  harness.evaluate("navigateBack();");
  assert.deepEqual(navigations, [
    `${staticOrigin}/demo/demo/details.html`, `${staticOrigin}/demo/demo/first.html`
  ]);
  assert.equal(harness.evaluate("currentHistoryUrl(selectedTab)"), "/demo/demo/first.html");
  assert.equal(harness.evaluate("browserUrlAllowed(selectedTab, '/demo/details.html')"), false);
});

test("Browserは符号化表記だけが異なるloadやリンクで履歴を増やさず、元のURLへ戻る", () => {
  for (const [base, loadedBase] of [
    ["/%e4%bd%9c%e5%93%81/", "/%E4%BD%9C%E5%93%81/"],
    ["/%64emo/", "/demo/"]
  ]) {
    const navigations = [];
    const document = {
      location: { href: `${staticOrigin}${loadedBase}pages/first.html` }, title: "作品ページ",
      addEventListener() {}, removeEventListener() {}
    };
    const frame = { contentDocument: document, contentWindow: { location: { replace(url) { navigations.push(url); } } } };
    const harness = componentScriptHarness(browserFile, {
      tabs: [{ id: "first", title: "作品ページ", url: "/pages/first.html", allowedUrls: ["/pages/details.html"] }]
    }, {
      URL, pathnameKey, window: { location: { origin: staticOrigin } }, frame,
      resourceUrl: (url) => resolveResourceUrl(url, base, apiOrigin), corruptionNoiseStyle: () => ""
    });
    harness.evaluate("frameElement = frame; handleFrameLoad();");
    assert.equal(harness.evaluate("historiesByTabId.first.length"), 1);
    assert.equal(harness.evaluate("frameSourceUrl"), `${base}pages/first.html`);
    harness.evaluate(`navigateWithinTab(selectedTab, ${JSON.stringify(document.location.href)});`);
    assert.equal(navigations.length, 0);
    harness.evaluate(`navigateWithinTab(selectedTab, ${JSON.stringify(`${staticOrigin}${loadedBase}pages/%64etails.html#note`)});`);
    assert.equal(harness.evaluate("historiesByTabId.first.length"), 2);
    assert.equal(navigations.at(-1), `${staticOrigin}${loadedBase}pages/%64etails.html#note`);
    harness.evaluate("navigateBack(); handleFrameLoad();");
    assert.equal(navigations.at(-1), `${staticOrigin}${base}pages/first.html`);
    assert.equal(harness.evaluate("historyIndexByTabId.first"), 0);
    assert.equal(harness.evaluate("historiesByTabId.first.length"), 2);
  }
});

test("Browserのpath比較は符号化slash・query・hashを混同せず、不正URIを拒否する", () => {
  const noisy = [];
  const navigations = [];
  const frame = { contentWindow: { location: { replace(url) { navigations.push(url); } } } };
  const harness = componentScriptHarness(browserFile, {
    tabs: [{ id: "first", title: "作品ページ", url: "/pages/first.html", allowedUrls: ["/pages/a%2Fb.html?x=%41"] }],
    onNoise: () => noisy.push(true)
  }, { URL, pathnameKey, window: { location: { origin: staticOrigin } }, resourceUrl, corruptionNoiseStyle: () => "", frame });
  harness.evaluate("frameElement = frame;");
  for (const path of ["/pages/a/b.html?x=%41", "/pages/a%2fb.html?x=A", "/pages/%E0%A4%A", "http://["]) {
    const target = path.startsWith("http:") ? path : `${staticOrigin}${staticBase}${path.slice(1)}`;
    harness.evaluate(`navigateWithinTab(selectedTab, ${JSON.stringify(target)});`);
  }
  assert.equal(navigations.length, 0);
  assert.equal(noisy.length, 4);
  for (const hash of ["#one", "#two"]) {
    harness.evaluate(`navigateWithinTab(selectedTab, ${JSON.stringify(`${staticOrigin}${staticBase}pages/a%2fb.html?x=%41${hash}`)});`);
  }
  assert.equal(navigations.length, 2);
  assert.equal(harness.evaluate("historiesByTabId.first.length"), 3);
});

test("Radioフォームのopaque sandboxとsource/requestId照合はAPI originから独立する", async () => {
  const source = readFileSync(radioFile, "utf8");
  assert.match(source, /src=\{resourceUrl\(selectedRadioForm\.url\)\}/);
  assert.match(source, /sandbox="allow-forms allow-scripts"/);
  const submissions = [];
  const replies = [];
  const frameWindow = { postMessage(message, origin) { replies.push({ message, origin }); } };
  const context = componentFunctionHarness(radioFile, ["handleRadioFormMessage"], {
    broadcastFrameElement: { contentWindow: frameWindow },
    async submitCurrentRadioForm(fields) { submissions.push({ ...fields }); return { ok: true }; }
  });
  const valid = {
    origin: "null", source: frameWindow,
    data: { type: "xstoryphone:submitRadioForm", requestId: "request-1", fields: { body: "投稿本文", ignored: 1 } }
  };
  await context.handleRadioFormMessage({ ...valid, source: { postMessage() { assert.fail("別iframeへ返信してはいけません"); } } });
  await context.handleRadioFormMessage({ ...valid, data: { ...valid.data, requestId: 1 } });
  assert.equal(submissions.length, 0);
  await context.handleRadioFormMessage(valid);
  assert.deepEqual(submissions, [{ body: "投稿本文" }]);
  assert.equal(replies[0].origin, "*");
  assert.equal(replies[0].message.requestId, "request-1");
  assert.equal(replies[0].message.type, "xstoryphone:submitRadioForm:result");
  assert.deepEqual(Object.keys(replies[0].message.result), ["ok"]);
});
