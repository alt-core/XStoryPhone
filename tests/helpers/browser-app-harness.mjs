import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { pathnameKey } from "../../src/shared/deploymentUrls.ts";
import { BROWSER_PAGE_HISTORY_LIMIT } from "../../src/client/system/phoneHistory.ts";
import { componentScriptHarness } from "./component-script-harness.mjs";

const browserPagesUrl = new URL("../../src/client/system/browserPages.ts", import.meta.url);
const browserAppUrl = new URL("../../src/client/apps/BrowserApp.svelte", import.meta.url);

// 実moduleを試験ごとの静的baseとoriginで評価する。
export function browserPagesModule({ resourceUrl, window }) {
  const sandbox = {
    exports: {},
    URL,
    window,
    require(name) {
      if (name === "../../shared/deploymentUrls.ts") return { pathnameKey };
      if (name === "./phoneHistory.ts") return { BROWSER_PAGE_HISTORY_LIMIT };
      if (name === "./resourceUrls.ts") return { resourceUrl };
      throw new Error(`想定外の依存: ${name}`);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(readFileSync(browserPagesUrl, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, sandbox);
  return sandbox.exports;
}

// BrowserAppの実scriptを動かし、タブ内ページ履歴を持つAppの役割だけを模倣する。
// 表示指定を省いた場合は、Appがホームから開く時と同じく先頭のタブを指定する。
export function browserAppHarness(props, { resourceUrl, origin = "http://localhost", ...globals } = {}) {
  const window = { location: { origin } };
  const pageEvents = [];
  let pages = {};
  let harness;
  const firstTab = props.tabs?.[0];
  harness = componentScriptHarness(browserAppUrl, {
    pages,
    focusContentId: firstTab?.contentId ?? firstTab?.id ?? "",
    focusContentRequestId: 1,
    ...props,
    onNavigatePage(contentId, page, mode) {
      pageEvents.push({ contentId, page: structuredClone(page), mode });
      pages = { ...pages, [contentId]: page };
      harness.update({ pages });
    }
  }, {
    URL,
    window,
    tick: () => Promise.resolve(),
    corruptionNoiseStyle: () => "",
    ...browserPagesModule({ resourceUrl, window }),
    ...globals
  });
  return {
    harness,
    pageEvents,
    get pages() { return pages; },
    setPages(next) {
      pages = next;
      harness.update({ pages });
    }
  };
}
