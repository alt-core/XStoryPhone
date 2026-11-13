import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  PHONE_STAGE_SHELL_HEIGHT,
  PHONE_STAGE_SHELL_WIDTH,
  resolvePhoneStageLayout
} from "../src/client/system/phoneStageLayout.ts";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const layoutModule = ts.transpileModule(readFileSync(new URL("../src/client/system/phoneStageLayout.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

// 作品定数だけを差し替え、共有のレイアウト関数をそのまま検証する。
function layoutForProject(projectConstants) {
  const sandbox = {
    exports: {},
    require(name) {
      assert.equal(name, "../generated/demoProjectConstants.generated.ts");
      return { demoProjectConstantsGenerated: projectConstants };
    }
  };
  vm.runInNewContext(layoutModule, sandbox);
  return sandbox.exports.resolvePhoneStageLayout;
}

test("枠付きfocusedは作品定数が未指定なら広い画面でも等倍を維持する", () => {
  assert.equal(resolvePhoneStageLayout("focused", 1920, 1920, 1080).scale, 1);
  assert.equal(layoutForProject({})("focused", 1920, 1920, 1080).scale, 1);
});

test("枠付きfocusedは作品ごとの上限まで拡大する", () => {
  for (const maxScale of [1, 1.2, 1.5]) {
    const resolve = layoutForProject({ "device.focused_max_scale": String(maxScale) });
    const layout = resolve("focused", 1920, 1920, 1080);
    assert.equal(layout.frameOnly, false);
    assert.equal(layout.scale, maxScale);
  }
  const resolve = layoutForProject({ "device.focused_max_scale": "1.2" });
  const layout = resolve("focused", 1920, 1920, 950);
  assert.equal(layout.designWidth * layout.scale, 492);
  assert.equal(layout.designHeight * layout.scale, 837.6);
});

test("拡大上限を指定してもコンテナの高さと幅に収める", () => {
  const resolve = layoutForProject({ "device.focused_max_scale": "1.2" });
  assert.equal(resolve("focused", 1440, 1440, 800).scale, 800 / PHONE_STAGE_SHELL_HEIGHT);
  assert.equal(resolve("focused", 1920, 450, 950).scale, 450 / PHONE_STAGE_SHELL_WIDTH);
  assert.equal(resolve("focused", 1440, 1440, 550).scale, 550 / PHONE_STAGE_SHELL_HEIGHT);
});

test("作品の拡大上限は枠なしfocusedとembedded・hiddenの上限に影響しない", () => {
  for (const maxScale of ["1", "1.2", "2"]) {
    const resolve = layoutForProject({ "device.focused_max_scale": maxScale });
    const mobileLayout = resolve("focused", 520, 520, 1200);
    assert.equal(mobileLayout.frameOnly, true);
    assert.equal(mobileLayout.scale, 1.15);
    for (const mode of ["embedded", "hidden"]) {
      assert.equal(resolve(mode, 1920, 1920, 1080).scale, 1);
      assert.equal(resolve(mode, 520, 520, 1200).scale, 1);
    }
  }
  const resolve = layoutForProject({ "device.focused_max_scale": "1.2" });
  assert.equal(resolve("focused", 521, 521, 1200).scale, 1.2);
});

test("PhoneStageの表示寸法と共有関数の倍率が作品設定に合わせて連動する", () => {
  const resolve = layoutForProject({ "device.focused_max_scale": "1.2" });
  const stage = componentScriptHarness(new URL("../src/client/system/PhoneStage.svelte", import.meta.url), {}, {
    PHONE_STAGE_SHELL_WIDTH, PHONE_STAGE_SHELL_HEIGHT,
    resolvePhoneStageLayout: resolve, onMount() {}, tick: async () => {}
  });
  stage.evaluate("viewportWidth = 1920; availableWidth = 1920; availableHeight = 950;");
  stage.flush();
  assert.equal(stage.evaluate("viewportStyle"), "width: 492px; height: 837.6px;");
  assert.equal(stage.evaluate("contentStyle"), "width: 410px; height: 698px; --phone-scale: 1.2;");
  stage.evaluate("viewportWidth = 1440; availableWidth = 1440; availableHeight = 800;");
  stage.flush();
  assert.equal(stage.evaluate("layout.scale"), resolve("focused", 1440, 1440, 800).scale);
  stage.update({ mode: "embedded" });
  assert.equal(stage.evaluate("viewportStyle"), "width: 410px; height: 698px;");
});

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
