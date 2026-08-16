import assert from "node:assert/strict";
import test from "node:test";
import {
  PHONE_STAGE_SHELL_HEIGHT,
  PHONE_STAGE_SHELL_WIDTH,
  resolvePhoneStageLayout
} from "../src/client/system/phoneStageLayout.ts";

test("focusedは狭幅時だけ端末画面をフレームなしで表示する", () => {
  const layout = resolvePhoneStageLayout("focused", 390, 390, 844);

  assert.equal(layout.interactive, true);
  assert.equal(layout.hidden, false);
  assert.equal(layout.frameOnly, true);
  assert.equal(layout.designWidth, 384);
  assert.equal(layout.designHeight, 672);
  assert.equal(layout.scale, 390 / 384);
});

test("focusedは主要iPhone Safariの表示領域で横幅いっぱいまで拡大できる", () => {
  const layout = resolvePhoneStageLayout("focused", 393, 393, 697);

  assert.equal(layout.frameOnly, true);
  assert.equal(layout.scale, 393 / 384);
});

test("focusedは高さが足りない場合に固定画面全体を縮小する", () => {
  const layout = resolvePhoneStageLayout("focused", 375, 375, 550);

  assert.equal(layout.frameOnly, true);
  assert.equal(layout.designHeight, 672);
  assert.equal(layout.scale, 550 / 672);
});

test("embeddedは狭幅でも端末フレームを保ち、小型コンテナへ収める", () => {
  const mobileLayout = resolvePhoneStageLayout("embedded", 390, 390, 844);
  const smallLayout = resolvePhoneStageLayout("embedded", 800, 300, 260);

  assert.equal(mobileLayout.interactive, false);
  assert.equal(mobileLayout.hidden, false);
  assert.equal(mobileLayout.frameOnly, false);
  assert.equal(mobileLayout.designWidth, PHONE_STAGE_SHELL_WIDTH);
  assert.equal(mobileLayout.designHeight, PHONE_STAGE_SHELL_HEIGHT);
  assert.equal(smallLayout.scale, 260 / PHONE_STAGE_SHELL_HEIGHT);
});

test("hiddenは端末を操作不能かつ非表示として扱う", () => {
  const layout = resolvePhoneStageLayout("hidden", 390, 390, 844);

  assert.equal(layout.interactive, false);
  assert.equal(layout.hidden, true);
  assert.equal(layout.frameOnly, false);
});
