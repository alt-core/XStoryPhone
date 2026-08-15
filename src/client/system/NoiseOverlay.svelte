<script lang="ts">
  import { onMount } from "svelte";

  export let visible = false;

  let canvasEl: HTMLCanvasElement;
  let shaderActive = false;
  let cleanupShader: (() => void) | undefined;

  onMount(() => {
    return () => {
      cleanupShader?.();
    };
  });

  $: if (visible && canvasEl && !cleanupShader && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cleanupShader = startShaderNoise(canvasEl);
  }

  $: if (!visible && cleanupShader) {
    cleanupShader();
    cleanupShader = undefined;
  }

  function startShaderNoise(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power"
    });

    if (!gl) {
      return undefined;
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      varying vec2 v_uv;

      void main() {
        v_uv = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision highp float;

      varying vec2 v_uv;
      uniform float u_time;
      uniform vec2 u_resolution;

      float random(vec2 value) {
        vec3 state = fract(vec3(value.xyx) * 0.1031);
        state += dot(state, state.yzx + 33.33);
        return fract((state.x + state.y) * state.z);
      }

      void main() {
        vec2 cell = floor(v_uv * u_resolution);
        float frame = floor(u_time * 60.0);
        float grain = random(cell + vec2(frame * 17.0, frame * 31.0));
        gl_FragColor = vec4(vec3(grain), 1.0);
      }
    `);

    if (!vertexShader || !fragmentShader) {
      return undefined;
    }

    const program = gl.createProgram();
    if (!program) {
      return undefined;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return undefined;
    }

    const buffer = gl.createBuffer();
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");

    if (!buffer || positionLocation < 0 || !timeLocation || !resolutionLocation) {
      gl.deleteProgram(program);
      return undefined;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    shaderActive = true;
    let animationFrame = 0;
    let stopped = false;
    const startedAt = performance.now();

    const render = (now: number) => {
      if (stopped) {
        return;
      }

      resizeShaderCanvas(canvas, gl);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(timeLocation, (now - startedAt) / 1000);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationFrame = window.requestAnimationFrame(render);
    };

    animationFrame = window.requestAnimationFrame(render);

    return () => {
      stopped = true;
      shaderActive = false;
      window.cancelAnimationFrame(animationFrame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }

  function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) {
      return undefined;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return undefined;
    }

    return shader;
  }

  function resizeShaderCanvas(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width / 2));
    const nextHeight = Math.max(1, Math.round(rect.height / 2));

    if (canvas.width === nextWidth && canvas.height === nextHeight) {
      return;
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
    gl.viewport(0, 0, nextWidth, nextHeight);
  }
</script>

{#if visible}
  <div class="noise" aria-hidden="true">
    <div class="base-noise">
      <span class="scanlines"></span>
      <span class="chroma-shift"></span>
      <span class="slice slice-a"></span>
      <span class="slice slice-b"></span>
      <span class="slice slice-c"></span>
      <span class="macroblocks"></span>
    </div>
    <canvas class="shader-noise" class:active={shaderActive} bind:this={canvasEl}></canvas>
  </div>
{/if}

<style>
  .noise {
    position: absolute;
    inset: 0;
    z-index: 8;
    contain: strict;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(4, 8, 13, 0.22)),
      rgba(4, 8, 13, 0.2);
  }

  .base-noise,
  .scanlines,
  .chroma-shift,
  .slice,
  .macroblocks {
    position: absolute;
    pointer-events: none;
  }

  .base-noise {
    inset: 0;
    overflow: hidden;
  }

  .scanlines {
    inset: 0;
    opacity: 0.36;
    background:
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.09) 0 1px, transparent 1px 4px),
      repeating-linear-gradient(0deg, transparent 0 17px, rgba(0, 0, 0, 0.2) 17px 18px);
    animation: scan-jitter 100ms steps(2, end) both;
  }

  .chroma-shift {
    inset: 0;
    opacity: 0.26;
    background:
      linear-gradient(90deg, rgba(80, 245, 255, 0.16), transparent 2% 96%, rgba(255, 56, 132, 0.14)),
      linear-gradient(180deg, transparent 0 9%, rgba(80, 245, 255, 0.14) 9% 9.8%, transparent 9.8% 34%, rgba(255, 56, 132, 0.12) 34% 34.8%, transparent 34.8% 70%, rgba(80, 245, 255, 0.1) 70% 70.8%, transparent 70.8%);
    mix-blend-mode: screen;
    animation: chroma-jump 100ms steps(2, end) both;
  }

  .slice {
    left: -8%;
    right: -8%;
    height: var(--slice-height);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-bottom: 1px solid rgba(0, 0, 0, 0.2);
    background:
      linear-gradient(90deg, rgba(80, 245, 255, 0.1), rgba(255, 255, 255, 0.07) 46%, rgba(255, 56, 132, 0.1)),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0 12px, transparent 12px 26px);
    opacity: 0;
  }

  .slice-a {
    top: 18%;
    --slice-height: 12px;
    animation: slice-a 100ms steps(2, end) both;
  }

  .slice-b {
    top: 42%;
    --slice-height: 18px;
    animation: slice-b 100ms steps(2, end) both;
  }

  .slice-c {
    top: 72%;
    --slice-height: 10px;
    animation: slice-c 100ms steps(2, end) both;
  }

  .macroblocks {
    inset: 0;
    opacity: 0.28;
  }

  .macroblocks::before,
  .macroblocks::after {
    content: "";
    position: absolute;
    display: block;
  }

  .macroblocks::before {
    top: 13%;
    left: 8%;
    width: 28px;
    height: 12px;
    background: rgba(80, 245, 255, 0.15);
    box-shadow:
      88px 42px 0 rgba(255, 255, 255, 0.12),
      202px 72px 0 rgba(255, 56, 132, 0.13),
      36px 188px 0 rgba(92, 200, 167, 0.13),
      248px 244px 0 rgba(255, 255, 255, 0.1),
      130px 352px 0 rgba(80, 245, 255, 0.12);
    animation: block-hop 100ms steps(2, end) both;
  }

  .macroblocks::after {
    top: 28%;
    right: 11%;
    width: 48px;
    height: 6px;
    background: rgba(255, 255, 255, 0.12);
    box-shadow:
      -194px 96px 0 rgba(80, 245, 255, 0.12),
      -82px 184px 0 rgba(255, 56, 132, 0.11),
      -228px 306px 0 rgba(255, 255, 255, 0.1);
    animation: block-hop 100ms steps(2, end) reverse both;
  }

  .shader-noise {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    image-rendering: pixelated;
    pointer-events: none;
    transition: opacity 20ms linear;
  }

  .shader-noise.active {
    opacity: 0.12;
  }

  @keyframes scan-jitter {
    0% {
      transform: translateY(-1px);
    }

    100% {
      transform: translateY(2px);
    }
  }

  @keyframes chroma-jump {
    0% {
      transform: translateX(-2px);
    }

    100% {
      transform: translateX(2px);
    }
  }

  @keyframes slice-a {
    0%,
    100% {
      opacity: 0;
      transform: translateX(0);
    }

    45% {
      opacity: 0.58;
      transform: translateX(12px);
    }
  }

  @keyframes slice-b {
    0%,
    100% {
      opacity: 0;
      transform: translateX(0);
    }

    55% {
      opacity: 0.62;
      transform: translateX(-16px);
    }
  }

  @keyframes slice-c {
    0%,
    100% {
      opacity: 0;
      transform: translateX(0);
    }

    50% {
      opacity: 0.5;
      transform: translateX(8px);
    }
  }

  @keyframes block-hop {
    0% {
      transform: translate3d(0, 0, 0);
    }

    100% {
      transform: translate3d(8px, -3px, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scanlines,
    .chroma-shift,
    .slice,
    .macroblocks::before,
    .macroblocks::after,
    .shader-noise {
      animation-duration: 1ms;
      animation-iteration-count: 1;
      transition-duration: 1ms;
    }
  }
</style>
