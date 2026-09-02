import assert from "node:assert/strict";
import test from "node:test";
import { presentationEffectAnimationPlan } from "../src/client/system/presentationEffectAnimation.ts";

test("flashは短い立ち上がりと長い余韻を指定どおり再生する", () => {
  const plan = presentationEffectAnimationPlan({
    type: "flash",
    fadeInMs: 24,
    holdMs: 36,
    fadeOutMs: 240,
    intensity: 0.92,
    color: "#fffaf2"
  }, false);

  assert.ok(plan);
  assert.equal(plan.options.duration, 300);
  assert.equal(plan.options.fill, "both");
  assert.deepEqual(plan.keyframes.map(({ opacity, offset }) => ({ opacity, offset })), [
    { opacity: 0, offset: 0 },
    { opacity: 0.92, offset: 0.08 },
    { opacity: 0.92, offset: 0.2 },
    { opacity: 0, offset: 1 }
  ]);
  assert.notEqual(plan.keyframes[0].easing, "linear");
  assert.notEqual(plan.keyframes[2].easing, "linear");
});

test("保持時間0では重複offsetを作らず、ピークから直接フェードアウトする", () => {
  const plan = presentationEffectAnimationPlan({
    type: "blackout",
    fadeInMs: 200,
    holdMs: 0,
    fadeOutMs: 300,
    intensity: 1
  }, false);

  assert.ok(plan);
  assert.equal(plan.keyframes.length, 3);
  assert.equal(plan.keyframes[1].offset, 0.4);
  assert.notEqual(plan.keyframes[1].easing, "linear");
});

test("モーション軽減時はflashを省略する", () => {
  const plan = presentationEffectAnimationPlan({
    type: "flash",
    fadeInMs: 24,
    holdMs: 36,
    fadeOutMs: 240,
    intensity: 0.92,
    color: "#fffaf2"
  }, true);

  assert.equal(plan, null);
});

test("モーション軽減時のblackoutは線形フェードだけを使う", () => {
  const plan = presentationEffectAnimationPlan({
    type: "blackout",
    fadeInMs: 220,
    holdMs: 180,
    fadeOutMs: 300,
    intensity: 0.88
  }, true);

  assert.ok(plan);
  assert.equal(plan.options.duration, 700);
  assert.ok(plan.keyframes.slice(0, -1).every((keyframe) => keyframe.easing === "linear"));
  assert.deepEqual(plan.keyframes.map((keyframe) => keyframe.opacity), [0, 0.88, 0.88, 0]);
});
