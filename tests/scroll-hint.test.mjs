import assert from "node:assert/strict";
import test from "node:test";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const settle = () => new Promise(setImmediate);

async function scrollHint() {
  let mount;
  let mutationObserver;
  const listeners = new Map();
  const scrolls = [];
  const content = {
    scrollTop: 0, clientHeight: 242, scrollHeight: 242,
    classList: { contains: () => false },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    scrollBy(options) { scrolls.push(options); }
  };
  const root = { children: [content] };
  const component = componentScriptHarness(new URL("../src/client/system/ScrollHint.svelte", import.meta.url), { enabled: true }, {
    tick: async () => {}, afterUpdate() {}, onMount(callback) { mount = callback; },
    window: { addEventListener() {}, removeEventListener() {}, setTimeout() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; mutationObserver = this; }
      observe(target, options) { this.target = target; this.options = options; this.active = true; }
      disconnect() { this.active = false; }
      notify(type) {
        if (this.active && this.options[type]) this.callback();
      }
    }
  });
  component.evaluate("(element) => { root = element; }")(root);
  const destroy = mount();
  await settle();
  return {
    component, content, scrolls, destroy, listeners,
    async changeContent(height, type = "childList") {
      content.scrollHeight = height;
      mutationObserver?.notify(type);
      await settle();
    }
  };
}

test("ScrollHintは枠の高さが同じでもToDoの増減や本文更新に合わせて矢印を変える", async () => {
  const h = await scrollHint();
  assert.equal(h.component.evaluate("canScrollDown"), false);
  await h.changeContent(626);
  assert.equal(h.component.evaluate("canScrollDown"), true, "1件から12件へ増えた内容を案内する");
  await h.changeContent(242);
  assert.equal(h.component.evaluate("canScrollDown"), false, "1件へ戻れば不要な案内を消す");
  await h.changeContent(400, "characterData");
  assert.equal(h.component.evaluate("canScrollDown"), true, "件数が同じでも本文が伸びれば案内する");
  h.destroy();
});

test("ScrollHintは破棄後に内容の監視とスクロールの購読を残さない", async () => {
  const h = await scrollHint();
  h.destroy();
  assert.equal(h.listeners.size, 0);
  await h.changeContent(626);
  assert.equal(h.component.evaluate("canScrollDown"), false);
});

test("ScrollHintは狭い表示領域で1画面より先へ飛ばさず、上下へ送れる", async () => {
  const h = await scrollHint();
  for (const height of [20, 30, 100, 242]) {
    h.content.clientHeight = height;
    for (const direction of [1, -1]) {
      h.component.evaluate("scrollByPage")(direction);
      const scroll = h.scrolls.at(-1);
      assert.equal(scroll.top, Math.min(120, height) * direction);
      assert.equal(scroll.behavior, "smooth");
    }
  }
  h.destroy();
});
