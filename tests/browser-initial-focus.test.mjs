import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { compile } from "svelte/compiler";
import * as serverRuntime from "svelte/internal/server";
import { render } from "svelte/server";
import ts from "typescript";
import { corruptionNoiseStyle } from "../src/client/system/corruptionNoise.ts";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const browserUrl = new URL("../src/client/apps/BrowserApp.svelte", import.meta.url);
const source = readFileSync(browserUrl, "utf8");
const tabs = [
  { id: "A", contentId: "first", title: "先頭タブ", url: "/first.html" },
  { id: "B", contentId: "second", title: "指定タブ", url: "/second.html" }
];
const windowStub = { location: { origin: "http://localhost" } };
const compiled = ts.transpileModule(compile(source, { filename: "BrowserApp.svelte", generate: "server" }).js.code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function renderBrowser(props) {
  const sandbox = {
    exports: {}, URL, window: windowStub,
    require(name) {
      if (name === "svelte/internal/server") return serverRuntime;
      if (name === "svelte") return { onDestroy() {} };
      if (name === "@lucide/svelte") return Object.fromEntries(["ArrowLeft", "Globe2", "Layers3", "Plus", "X"].map((key) => [key, () => {}]));
      if (name === "../system/corruptionNoise") return { corruptionNoiseStyle };
      if (name === "./AppShell.svelte") return { __esModule: true, default(renderer, shellProps) { shellProps.children(renderer); } };
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

for (const focusContentId of ["", "missing"]) {
  test(`初回指定が${focusContentId || "なし"}なら従来の先頭タブを開く`, () => {
    const opened = [];
    const html = renderBrowser({ tabs, focusContentId, onContentOpen(id) { opened.push(id); } });
    assert.match(html, /<iframe[^>]*src="\/first.html"/);
    assert.deepEqual(opened, ["first"]);
  });
}

test("空リストと破損した指定タブは無関係な先頭ページを開封しない", () => {
  const opened = [];
  const empty = renderBrowser({ tabs: [], focusContentId: "second", onContentOpen(id) { opened.push(id); } });
  assert.doesNotMatch(empty, /<iframe/);
  const corrupted = renderBrowser({
    tabs: [tabs[0], { ...tabs[1], corrupted: true }], focusContentId: "second",
    onContentOpen(id) { opened.push(id); }
  });
  assert.doesNotMatch(corrupted, /<iframe/);
  assert.match(corrupted, /タブ一覧/);
  assert.deepEqual(opened, []);
});

test("同じcomponentの次のfocus要求は引き続きタブを切り替える", () => {
  const opened = [];
  const harness = componentScriptHarness(browserUrl, {
    tabs, focusContentId: "second", focusContentRequestId: 8,
    onContentOpen(id) { opened.push(id); }
  }, { URL, window: windowStub, corruptionNoiseStyle });
  assert.equal(harness.evaluate("frameSourceUrl"), "/second.html");
  harness.update({ focusContentId: "first", focusContentRequestId: 9 });
  harness.flush();
  assert.equal(harness.evaluate("frameSourceUrl"), "/first.html");
  assert.deepEqual(opened, ["second", "first"]);
});
