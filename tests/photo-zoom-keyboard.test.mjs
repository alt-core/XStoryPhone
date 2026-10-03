import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "svelte/compiler";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const photoAppUrl = new URL("../src/client/apps/PhotosApp.svelte", import.meta.url);
const source = readFileSync(photoAppUrl, "utf8");
const windowNode = parse(source).html.children.find((node) => node.type === "Window");
const keydownBinding = windowNode?.attributes.find((attribute) => attribute.type === "EventHandler" && attribute.name === "keydown");

function photoZoomHarness() {
  const window = new EventTarget();
  const component = componentScriptHarness(photoAppUrl, {
    photos: [{ id: "photo", contentId: "content_photo", imageUrl: "/photo.webp" }],
    focusContentId: "content_photo",
    focusContentRequestId: 1
  }, { tick: () => Promise.resolve(), window });

  // 実テンプレートのイベント接続も使い、フレーム内だけのEscape処理へ戻す変更を検出する。
  assert.ok(keydownBinding?.expression, "拡大のEscape操作をwindowへ接続する");
  window.addEventListener("keydown", component.evaluate(source.slice(keydownBinding.expression.start, keydownBinding.expression.end)));

  function pressWindowKey(key, targetClass) {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperties(event, {
      key: { value: key },
      target: { value: { className: targetClass } }
    });
    window.dispatchEvent(event);
    return event;
  }

  return { component, pressWindowKey };
}

test("アルバム: 拡大フレームと閉じるボタンのどちらからでもEscapeで閉じる", () => {
  for (const targetClass of ["zoom-frame", "zoom-close"]) {
    const { component, pressWindowKey } = photoZoomHarness();
    component.evaluate("openZoom();");
    assert.equal(component.evaluate("zoomed"), true);
    const event = pressWindowKey("Escape", targetClass);
    assert.equal(component.evaluate("zoomed"), false, `${targetClass}のEscapeでも閉じる`);
    assert.equal(event.defaultPrevented, true);
  }
});

test("アルバム: 拡大中以外のEscapeとwindowへ届いた矢印キーを妨げない", () => {
  const { component, pressWindowKey } = photoZoomHarness();
  assert.equal(pressWindowKey("Escape", "app-list-button").defaultPrevented, false);
  component.evaluate("openZoom();");
  assert.equal(pressWindowKey("ArrowRight", "zoom-close").defaultPrevented, false);
  assert.equal(component.evaluate("zoomed"), true);
  assert.equal(component.evaluate("zoomOffsetX"), 0);
});

test("アルバム: 拡大フレームの上下左右キーは引き続き表示位置を動かす", () => {
  for (const [key, width, height, naturalWidth, naturalHeight, expectedX, expectedY] of [
    ["ArrowLeft", 300, 600, 1200, 800, 36, 0],
    ["ArrowRight", 300, 600, 1200, 800, -36, 0],
    ["ArrowUp", 600, 300, 800, 1200, 0, 36],
    ["ArrowDown", 600, 300, 800, 1200, 0, -36]
  ]) {
    const { component } = photoZoomHarness();
    component.evaluate(`openZoom(); zoomFrameWidth = ${width}; zoomFrameHeight = ${height}; zoomNaturalWidth = ${naturalWidth}; zoomNaturalHeight = ${naturalHeight};`);
    component.flush();
    let prevented = false;
    component.evaluate("handleZoomKeydown")({ key, preventDefault() { prevented = true; } });
    assert.equal(component.evaluate("zoomOffsetX"), expectedX, key);
    assert.equal(component.evaluate("zoomOffsetY"), expectedY, key);
    assert.equal(component.evaluate("zoomed"), true);
    assert.equal(prevented, true);
  }
});
