import assert from "node:assert/strict";
import test from "node:test";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const photoAppUrl = new URL("../src/client/apps/PhotosApp.svelte", import.meta.url);
const settle = () => new Promise(setImmediate);

// 端末は0.5倍で表示し、詳細の写真(600×1200)は画面座標(30,100)から50×100で見えている。
function albumZoom({ natural = [600, 1200] } = {}) {
  const clock = { now: 1000 };
  const screen = { ratio: 0.5 };
  const focused = [];
  let component;
  component = componentScriptHarness(photoAppUrl, {
    photos: [{ id: "photo", contentId: "content_photo", imageUrl: "/photo.webp" }],
    focusContentId: "content_photo",
    focusContentRequestId: 1
  }, {
    // 実ブラウザと同じく、tickの後はリアクティブ文の更新済みの値を読む。
    tick: () => Promise.resolve().then(() => component?.flush()),
    window: new EventTarget(),
    performance: { now: () => clock.now }
  });
  component.evaluate("(stubs) => { zoomTrigger = stubs.trigger; zoomTriggerImage = stubs.triggerImage; zoomFrame = stubs.frame; zoomImage = stubs.image; }")({
    trigger: { focus() { focused.push("trigger"); } },
    triggerImage: { getBoundingClientRect: () => ({ left: 30, top: 100, width: 50, height: 100 }) },
    frame: {
      clientWidth: 300,
      clientHeight: 600,
      getBoundingClientRect: () => ({ left: 20, top: 40, width: 300 * screen.ratio, height: 600 * screen.ratio }),
      focus() {}
    },
    image: { complete: true, naturalWidth: natural[0], naturalHeight: natural[1] }
  });
  const call = (name, event) => component.evaluate(name)(event);
  const zoomed = () => component.evaluate("zoomed");
  const click = (name, x, y, detail = 1) => call(name, { clientX: x, clientY: y, detail });
  const touches = (gap, center = [100, 100]) => ({
    touches: [
      { clientX: center[0] - gap / 2, clientY: center[1] },
      { clientX: center[0] + gap / 2, clientY: center[1] }
    ]
  });
  const wheel = (init) => {
    const event = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, clientX: 60, clientY: 150, ...init };
    event.prevented = false;
    event.preventDefault = () => { event.prevented = true; };
    call("handleZoomWheel", event);
    return event;
  };
  return { component, clock, screen, focused, call, zoomed, click, touches, wheel };
}

test("アルバム: 押した点は、拡大後も画面上の同じ位置に残る", async () => {
  const z = albumZoom();
  z.clock.now += 400;
  z.click("handleZoomTriggerClick", 40, 125);
  await settle();
  assert.equal(z.zoomed(), true);
  const value = (name) => z.component.evaluate(name);
  // 枠(300×600)と同じ形の写真は、全体の2倍(600×1200)になる。
  assert.deepEqual([value("zoomImageWidth"), value("zoomImageHeight")], [600, 1200]);
  // 押した点(写真の左から20%、上から25%)の拡大後の画面座標。
  const localX = 300 / 2 + value("zoomOffsetX") - 600 / 2 + 0.2 * 600;
  const localY = 600 / 2 + value("zoomOffsetY") - 1200 / 2 + 0.25 * 1200;
  assert.deepEqual([20 + localX * 0.5, 40 + localY * 0.5], [40, 125]);
});

test("アルバム: ドラッグは縮小表示の端末でも指と同じだけ動き、2本目の指で移動とタップを止める", async () => {
  const z = albumZoom();
  z.component.evaluate("openZoom();");
  await settle();
  const capture = { setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
  const pointer = (pointerId, x, y) => ({ pointerId, clientX: x, clientY: y, currentTarget: capture, preventDefault() {} });
  z.call("startZoomDrag", pointer(1, 100, 100));
  z.call("dragZoom", pointer(1, 110, 100));
  assert.equal(z.component.evaluate("zoomOffsetX"), 20, "画面の10pxは0.5倍の端末内で20px");
  z.call("startZoomDrag", pointer(2, 200, 100));
  z.call("dragZoom", pointer(1, 150, 100));
  assert.equal(z.component.evaluate("zoomOffsetX"), 20);
  z.clock.now += 400;
  z.click("handleZoomClick", 150, 100);
  assert.equal(z.zoomed(), true, "2本指の後の離しは全体へ戻す押しにしない");
});

test("アルバム: 拡大中に端末の表示倍率が変わってもドラッグは指と同じだけ動く", async () => {
  for (const ratio of [0.25, 1, 1.2]) {
    const z = albumZoom();
    z.component.evaluate("openZoom();");
    await settle();
    z.screen.ratio = ratio;
    const capture = { setPointerCapture() {} };
    const pointer = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, currentTarget: capture, preventDefault() {} });
    z.call("startZoomDrag", pointer(100, 100));
    z.call("dragZoom", pointer(110, 88));
    assert.equal(z.component.evaluate("zoomOffsetX"), 10 / ratio, `${ratio}倍の横移動`);
    assert.equal(z.component.evaluate("zoomOffsetY"), -12 / ratio, `${ratio}倍の縦移動`);
  }
});

test("アルバム: 押下を中断した後もキーボードの最初のclickで拡大・全体を切り替えられる", async () => {
  const z = albumZoom();
  z.call("startZoomPress", { clientX: 40, clientY: 125 });
  z.call("moveZoomPress", { clientX: 60, clientY: 125 });
  // ボタン外で離し、ポインターのclickが発生しなかった状態から操作する。
  z.click("handleZoomTriggerClick", 0, 0, 0);
  assert.equal(z.zoomed(), true);
  await settle();
  z.component.evaluate("zoomDragDistance = 20;");
  z.click("handleZoomClick", 0, 0, 0);
  assert.equal(z.zoomed(), false);
  assert.deepEqual(z.focused, ["trigger"]);
});

test("アルバム: 開いた直後と切り替えた直後0.35秒の押しは数えず、キーボードの操作は受け付ける", async () => {
  const z = albumZoom();
  z.clock.now += 349;
  z.click("handleZoomTriggerClick", 40, 125);
  assert.equal(z.zoomed(), false, "詳細へ入った直後の押しは拡大しない");
  z.clock.now += 1;
  z.click("handleZoomTriggerClick", 40, 125);
  assert.equal(z.zoomed(), true);
  await settle();
  z.clock.now += 349;
  z.click("handleZoomClick", 40, 125);
  assert.equal(z.zoomed(), true, "拡大した直後の押しは全体へ戻さない");
  z.click("handleZoomClick", 0, 0, 0);
  assert.equal(z.zoomed(), false, "Enter・Spaceのclickは直後でも受け付ける");
  assert.deepEqual(z.focused, ["trigger"]);
  z.click("handleZoomTriggerClick", 0, 0, 0);
  assert.equal(z.zoomed(), true);
});

test("アルバム: 押してから10pxを超えて動かした時は、押したことにしない", async () => {
  const z = albumZoom();
  z.clock.now += 400;
  for (const [distance, expected] of [[11, false], [10, true]]) {
    z.call("startZoomPress", { clientX: 40, clientY: 125 });
    z.call("moveZoomPress", { clientX: 40 + distance, clientY: 125 });
    z.click("handleZoomTriggerClick", 40 + distance, 125);
    assert.equal(z.zoomed(), expected, `${distance}px`);
  }
  await settle();
  z.clock.now += 400;
  z.component.evaluate("zoomDragDistance = 11;");
  z.click("handleZoomClick", 40, 125);
  assert.equal(z.zoomed(), true);
  z.component.evaluate("zoomDragDistance = 10;");
  z.click("handleZoomClick", 40, 125);
  assert.equal(z.zoomed(), false);
});

test("アルバム: 2本の指で広げると拡大し、つまむと全体へ戻る。1回の操作では1段だけ変える", async () => {
  const z = albumZoom();
  z.call("startZoomPinch", z.touches(100));
  z.call("moveZoomPinch", z.touches(118));
  assert.equal(z.zoomed(), false, "1.18倍までは変えない");
  z.call("moveZoomPinch", z.touches(119, [40, 125]));
  assert.equal(z.zoomed(), true);
  await settle();
  assert.equal(z.component.evaluate("zoomOffsetY"), 170, "指の中点を拡大の基準にする");
  z.call("moveZoomPinch", z.touches(40));
  assert.equal(z.zoomed(), true, "同じ操作の中では全体へ戻さない");
  z.call("endZoomPinch", { touches: [] });

  z.call("startZoomPinch", z.touches(100));
  z.call("moveZoomPinch", z.touches(86));
  assert.equal(z.zoomed(), true, "0.85倍までは変えない");
  z.call("moveZoomPinch", z.touches(84));
  assert.equal(z.zoomed(), false);
  z.call("moveZoomPinch", z.touches(300));
  assert.equal(z.zoomed(), false, "同じ操作の中では拡大し直さない");
});

test("アルバム: 2本指を離した直後0.35秒の押しは数えない", async () => {
  const z = albumZoom();
  z.clock.now += 400;
  z.call("startZoomPinch", z.touches(100));
  z.call("moveZoomPinch", z.touches(130));
  assert.equal(z.zoomed(), true);
  await settle();
  // 拡大した後も指を置いたまま1秒たってから、1本ずつ離す。
  z.clock.now += 1000;
  z.call("endZoomPinch", { touches: [{ clientX: 100, clientY: 100 }] });
  z.call("moveZoomPinch", z.touches(40));
  assert.equal(z.zoomed(), true, "1本だけ残した指では切り替えない");
  z.clock.now += 200;
  z.call("endZoomPinch", { touches: [] });
  z.clock.now += 349;
  z.click("handleZoomClick", 100, 100);
  assert.equal(z.zoomed(), true, "最後の指を離した直後の押しは全体へ戻さない");
  z.clock.now += 1;
  z.click("handleZoomClick", 100, 100);
  assert.equal(z.zoomed(), false);

  // 切り替えに至らなかった2本指の後も同じ。
  z.clock.now += 400;
  z.call("startZoomPinch", z.touches(100));
  z.call("moveZoomPinch", z.touches(105));
  z.call("endZoomPinch", { touches: [] });
  z.click("handleZoomTriggerClick", 40, 125);
  assert.equal(z.zoomed(), false);
});

test("アルバム: SafariのトラックパッドのピンチはgestureイベントでCtrl+ホイールと同じ2段を切り替える", async () => {
  const z = albumZoom();
  const node = new EventTarget();
  const action = z.component.evaluate("zoomGestures")(node);
  const gesture = (type, scale) => node.dispatchEvent(Object.assign(new Event(type), { scale }));
  gesture("gesturestart", 1);
  gesture("gesturechange", 1.1);
  assert.equal(z.zoomed(), false);
  gesture("gesturechange", 1.3);
  assert.equal(z.zoomed(), true);
  await settle();
  gesture("gesturechange", 0.5);
  assert.equal(z.zoomed(), true, "1回の操作では1段だけ");
  gesture("gesturestart", 1);
  gesture("gesturechange", 0.8);
  assert.equal(z.zoomed(), false);

  z.call("startZoomPinch", z.touches(100));
  gesture("gesturestart", 1);
  gesture("gesturechange", 2);
  assert.equal(z.zoomed(), false, "指のピンチ中はtouchの処理に任せる");
  action.destroy();
});

test("アルバム: Ctrl+ホイールは0.45秒あけて1段ずつ切り替え、ページの拡大を止める", async () => {
  const z = albumZoom();
  z.clock.now += 449;
  assert.equal(z.wheel({ ctrlKey: true, deltaY: -5 }).prevented, true);
  assert.equal(z.zoomed(), false, "詳細へ入った直後は切り替えない");
  z.clock.now += 1;
  z.wheel({ ctrlKey: true, deltaY: -5 });
  assert.equal(z.zoomed(), true);
  await settle();
  z.clock.now += 449;
  z.wheel({ ctrlKey: true, deltaY: 5 });
  assert.equal(z.zoomed(), true);
  z.clock.now += 1;
  z.wheel({ ctrlKey: true, deltaY: -5 });
  assert.equal(z.zoomed(), true, "拡大中の広げる方向は何もしない");
  z.wheel({ ctrlKey: true, deltaY: 5 });
  assert.equal(z.zoomed(), false);
});

test("アルバム: 拡大中のホイールは表示位置を動かし、Shiftで横、行単位の量も扱う", async () => {
  const z = albumZoom();
  const offset = () => [z.component.evaluate("zoomOffsetX"), z.component.evaluate("zoomOffsetY")];
  assert.equal(z.wheel({ deltaY: 30 }).prevented, false, "全体ではホイールを使わない");
  z.component.evaluate("openZoom();");
  await settle();
  assert.equal(z.wheel({ deltaY: 30 }).prevented, true);
  assert.deepEqual(offset(), [0, -30]);
  z.wheel({ deltaY: 40, shiftKey: true });
  assert.deepEqual(offset(), [-40, -30]);
  z.wheel({ deltaX: -2, deltaMode: 1 });
  assert.deepEqual(offset(), [-8, -30]);
});
