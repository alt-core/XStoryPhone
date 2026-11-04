import assert from "node:assert/strict";
import test from "node:test";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

function webglHarness({ failure, extension = true, contextLost = false } = {}) {
  const allocated = new Set();
  const deleted = [];
  const calls = [];
  let shaderCount = 0;
  let lost = contextLost;
  const resource = (kind) => {
    const value = { kind };
    allocated.add(value);
    return value;
  };
  const release = (value) => {
    if (value) deleted.push(value);
  };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, COLOR_BUFFER_BIT: 7, FLOAT: 8, TRIANGLES: 9,
    createShader(type) {
      shaderCount += 1;
      return failure === `createShader:${shaderCount}` ? null : resource(`shader:${type}`);
    },
    shaderSource() {}, compileShader() {},
    getShaderParameter(shader) { return failure !== `compile:${shader.kind}`; },
    deleteShader: release,
    createProgram() { return failure === "program" ? null : resource("program"); },
    attachShader() {}, linkProgram() {},
    getProgramParameter() { return failure !== "link"; },
    deleteProgram: release,
    createBuffer() { return failure === "buffer" ? null : resource("buffer"); },
    getAttribLocation() { return failure === "position" ? -1 : 0; },
    getUniformLocation(_program, name) { return failure === name ? null : {}; },
    deleteBuffer: release,
    bindBuffer() {}, bufferData() {}, viewport() {}, clearColor() {}, clear() {},
    useProgram() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, uniform1f() {}, uniform2f() {},
    drawArrays() { calls.push("draw"); },
    isContextLost() { return lost; },
    getExtension(name) {
      assert.equal(name, "WEBGL_lose_context");
      calls.push("extension");
      return extension ? { loseContext() { lost = true; calls.push("lose"); } } : null;
    }
  };
  return { gl, allocated, deleted, calls, isLost: () => lost };
}

function overlayHarness({ noWebgl = false, reducedMotion = false, ...glOptions } = {}) {
  const frames = new Map();
  let frameId = 0;
  let getContextCount = 0;
  let unmount;
  const component = componentScriptHarness(new URL("../src/client/system/NoiseOverlay.svelte", import.meta.url), {}, {
    performance: { now: () => 0 },
    onMount(callback) { unmount = callback(); },
    window: {
      matchMedia() { return { matches: reducedMotion }; },
      requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
      cancelAnimationFrame(id) { frames.delete(id); }
    }
  });

  function show() {
    const context = webglHarness(glOptions);
    const canvas = {
      width: 300, height: 150,
      getContext(type) {
        assert.equal(type, "webgl");
        getContextCount += 1;
        return noWebgl ? null : context.gl;
      },
      getBoundingClientRect() { return { width: 400, height: 800 }; }
    };
    // canvasのbindは明示し、DOM生成自体を模倣しない。
    component.evaluate("canvasEl = undefined;");
    component.update({ visible: true });
    // 実componentのリアクティブ文を、canvasのbind後に再評価する。
    component.evaluate("(value) => { canvasEl = value; }")(canvas);
    component.flush();
    return context;
  }

  function runFrame() {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(16);
    return callback;
  }

  return { component, frames, show, hide: () => component.update({ visible: false }), unmount: () => unmount(), runFrame, getContextCount: () => getContextCount };
}

function assertResourcesDeleted(context) {
  assert.equal(context.deleted.length, context.allocated.size, "確保した資源を重複なくすべて削除する");
  assert.deepEqual(new Set(context.deleted), context.allocated);
}

test("ノイズ: 表示終了で描画と文脈を終了し、遅れたフレームでも再開しない", () => {
  const overlay = overlayHarness();
  const context = overlay.show();
  assert.equal(overlay.component.evaluate("shaderActive"), true);
  assert.equal(overlay.frames.size, 1);
  const lateFrame = overlay.runFrame();
  assert.deepEqual(context.calls, ["draw"]);

  overlay.hide();
  assert.equal(overlay.component.evaluate("shaderActive"), false);
  assert.equal(overlay.frames.size, 0);
  assert.equal(context.isLost(), true);
  assertResourcesDeleted(context);
  lateFrame(32);
  overlay.unmount();
  assert.deepEqual(context.calls, ["draw", "extension", "lose"]);
  assert.equal(overlay.frames.size, 0);
});

test("ノイズ: 再表示は新しい文脈だけを使い、終了を重複しても再解放しない", () => {
  const overlay = overlayHarness();
  const first = overlay.show();
  overlay.hide();
  const second = overlay.show();
  const cleanup = overlay.component.evaluate("cleanupShader");
  overlay.unmount();
  cleanup();
  assert.notEqual(first.gl, second.gl);
  assert.equal(overlay.getContextCount(), 2);
  for (const context of [first, second]) {
    assertResourcesDeleted(context);
    assert.deepEqual(context.calls, ["extension", "lose"]);
  }
  assert.equal(overlay.frames.size, 0);
});

test("ノイズ: 初期化の各失敗でも確保済み資源と文脈を片付ける", () => {
  for (const failure of ["createShader:1", "createShader:2", "compile:shader:1", "compile:shader:2", "program", "link", "buffer", "position", "u_time", "u_resolution"]) {
    const overlay = overlayHarness({ failure });
    const context = overlay.show();
    assert.equal(overlay.component.evaluate("shaderActive"), false, failure);
    assert.equal(overlay.component.evaluate("cleanupShader"), undefined, failure);
    assert.equal(overlay.frames.size, 0, failure);
    assertResourcesDeleted(context);
    assert.deepEqual(context.calls, ["extension", "lose"], failure);
    overlay.hide();
    overlay.unmount();
    assert.deepEqual(context.calls, ["extension", "lose"], failure);
  }
});

test("ノイズ: 文脈終了の拡張が無くても描画と既存の資源解放を維持する", () => {
  for (const failure of [undefined, "link"]) {
    const overlay = overlayHarness({ extension: false, failure });
    const context = overlay.show();
    if (!failure) overlay.runFrame();
    overlay.hide();
    assertResourcesDeleted(context);
    assert.equal(overlay.frames.size, 0);
    assert.equal(overlay.component.evaluate("shaderActive"), false);
    assert.equal(context.calls.includes("lose"), false);
  }
});

test("ノイズ: WebGLなしと動き軽減設定ではCSS演出用の表示を保ち、描画を開始しない", () => {
  for (const options of [{ noWebgl: true }, { reducedMotion: true }]) {
    const overlay = overlayHarness(options);
    const context = overlay.show();
    assert.equal(overlay.component.evaluate("visible"), true);
    assert.equal(overlay.component.evaluate("shaderActive"), false);
    assert.equal(overlay.frames.size, 0);
    assert.equal(overlay.getContextCount(), options.reducedMotion ? 0 : 1);
    overlay.hide();
    overlay.unmount();
    assert.deepEqual(context.calls, []);
  }
});

test("ノイズ: すでに失われた文脈は再び終了しない", () => {
  const overlay = overlayHarness({ contextLost: true });
  const context = overlay.show();
  overlay.hide();
  assertResourcesDeleted(context);
  assert.deepEqual(context.calls, []);
  assert.equal(overlay.frames.size, 0);
});
