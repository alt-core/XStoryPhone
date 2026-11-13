import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "svelte/compiler";
import { keepTextInputFocus, prefersKeyboardFocus, releaseTextInputAfterSend } from "../src/client/system/textInputFocus.ts";

test("送信後、タッチが主の端末だけ入力欄から離れてキーボードを閉じる", () => {
  try {
    for (const [label, keyboard, blurs] of [["PC", true, 0], ["スマートフォン", false, 1]]) {
      const queries = [];
      globalThis.window = { matchMedia(query) { queries.push(query); return { matches: keyboard }; } };
      let blurred = 0;
      releaseTextInputAfterSend({ blur() { blurred += 1; } });
      assert.equal(blurred, blurs, label);
      assert.deepEqual(queries, ["(hover: hover) and (pointer: fine)"]);
      assert.equal(prefersKeyboardFocus(), keyboard);
      releaseTextInputAfterSend(undefined);
    }
  } finally {
    delete globalThis.window;
  }
});

test("マウスで送信ボタンを押しても、入力欄からフォーカスを移さない", () => {
  let prevented = false;
  keepTextInputFocus({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

// 送信中に入力欄を無効化すると、ブラウザがフォーカスを外す。
for (const [file, busy] of [
  ["apps/MessagesApp.svelte", "sending"],
  ["apps/ChatApp.svelte", "sending"],
  ["system/SearchAgent.svelte", "pending"]
]) {
  test(`${file}: 送信中の入力欄は読み取り専用にして無効化せず、送信ボタンはマウスでフォーカスを奪わない`, () => {
    const source = readFileSync(new URL(`../src/client/${file}`, import.meta.url), "utf8");
    const forms = [];
    (function visit(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "RegularElement" && node.name === "form") forms.push(node);
      for (const child of Object.values(node)) {
        if (child && typeof child === "object") for (const item of Array.isArray(child) ? child : [child]) visit(item);
      }
    })(parse(source, { modern: true }).fragment);
    const elements = (node, name, found = []) => {
      if (!node || typeof node !== "object") return found;
      if (node.type === "RegularElement" && node.name === name) found.push(node);
      for (const child of Object.values(node)) {
        if (child && typeof child === "object") for (const item of Array.isArray(child) ? child : [child]) elements(item, name, found);
      }
      return found;
    };
    const attribute = (element, name) => {
      const found = element.attributes.find((item) => item.name === name);
      return found && source.slice(found.start, found.end);
    };
    const composer = forms.map((form) => ({
      input: elements(form, "input").find((input) => attribute(input, "value")?.startsWith("bind:value")),
      submit: elements(form, "button").find((button) => attribute(button, "type") === 'type="submit"')
    })).find((item) => item.input && item.submit);
    assert.ok(composer, "入力欄と送信ボタンのフォーム");
    assert.equal(attribute(composer.input, "readonly"), `readonly={${busy}}`);
    assert.doesNotMatch(attribute(composer.input, "disabled"), new RegExp(`\\b${busy}\\b`));
    assert.equal(attribute(composer.submit, "mousedown"), "on:mousedown={keepTextInputFocus}");
  });
}
