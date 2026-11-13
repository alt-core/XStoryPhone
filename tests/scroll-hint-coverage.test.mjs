import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "svelte/compiler";

// スクロールバーを隠した領域は、続きがあることを ScrollHint の▲▼で示す。
for (const [file, scrollClass] of [
  ["apps/DocumentListApp.svelte", "detail-scroll"],
  ["apps/BrowserApp.svelte", "tab-list"],
  ["apps/ShareTargetPicker.svelte", "target-list"],
  ["system/HomeScreen.svelte", "todo-list"],
  ["apps/PhoneApp.svelte", "call-history"]
]) {
  test(`${file}: .${scrollClass} は ScrollHint の直下に置く`, () => {
    const source = readFileSync(new URL(`../src/client/${file}`, import.meta.url), "utf8");
    const parents = [];
    (function visit(node, parent) {
      if (!node || typeof node !== "object") return;
      if (node.type === "RegularElement" && node.attributes.some((attribute) => attribute.name === "class"
        && source.slice(attribute.start, attribute.end).split(/["\s]/u).includes(scrollClass))) {
        parents.push(parent);
      }
      const next = node.type === "Component" || node.type === "RegularElement" ? node : parent;
      for (const [key, child] of Object.entries(node)) {
        if (key === "parent" || !child || typeof child !== "object") continue;
        for (const item of Array.isArray(child) ? child : [child]) visit(item, next);
      }
    })(parse(source, { modern: true }).fragment, null);
    assert.equal(parents.length, 1, `.${scrollClass} は1か所`);
    assert.equal(parents[0]?.type, "Component");
    assert.equal(parents[0]?.name, "ScrollHint");
  });
}
