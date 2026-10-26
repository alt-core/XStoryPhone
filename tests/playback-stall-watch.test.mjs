import assert from "node:assert/strict";
import test from "node:test";
import { watchPlaybackStall } from "../src/client/system/playbackStallWatch.ts";

function stallWatch(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const page = new EventTarget();
  page.hidden = false;
  let stalls = 0;
  const watch = watchPlaybackStall(() => { stalls += 1; }, page);
  return {
    watch,
    stalls: () => stalls,
    advance(milliseconds) { t.mock.timers.tick(milliseconds); },
    setHidden(hidden) {
      page.hidden = hidden;
      page.dispatchEvent(new Event("visibilitychange"));
    }
  };
}

test("再生位置が45秒進まなければ一度だけ知らせ、それより前には知らせない", (t) => {
  const s = stallWatch(t);
  s.advance(44_999);
  assert.equal(s.stalls(), 0);
  s.advance(1);
  assert.equal(s.stalls(), 1);
  s.advance(100_000);
  assert.equal(s.stalls(), 1);
});

test("再生位置が進むたびに数え直し、同じ位置の通知では数え直さない", (t) => {
  const s = stallWatch(t);
  s.advance(30_000);
  s.watch.progress(0);
  s.advance(30_000);
  s.watch.progress(1_200);
  s.advance(30_000);
  s.watch.progress(1_200);
  s.advance(14_999);
  assert.equal(s.stalls(), 0);
  s.advance(1);
  assert.equal(s.stalls(), 1);
});

test("非表示の間は数えず、表示に戻った時点から数え直す", (t) => {
  const s = stallWatch(t);
  s.advance(40_000);
  s.setHidden(true);
  s.advance(600_000);
  assert.equal(s.stalls(), 0);
  s.setHidden(false);
  s.advance(44_999);
  assert.equal(s.stalls(), 0);
  s.advance(1);
  assert.equal(s.stalls(), 1);
});

test("停止後は表示が切り替わっても知らせない", (t) => {
  const s = stallWatch(t);
  s.watch.stop();
  s.setHidden(true);
  s.setHidden(false);
  s.advance(100_000);
  assert.equal(s.stalls(), 0);
});
