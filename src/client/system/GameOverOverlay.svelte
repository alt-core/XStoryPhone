<script lang="ts">
  import { onDestroy } from "svelte";
  import { resourceUrl } from "./resourceUrls";

  type GlitchBand = {
    id: number;
    top: number;
    height: number;
    offset: number;
    duration: number;
    opacity: number;
  };

  export let visible = false;
  export let imageUrl = "";
  export let titleText = "";
  export let reasonMessage = "";
  export let label = "やりなおす";
  export let ariaLabel = "";
  export let returning = false;
  export let onDismiss: () => void = () => {};

  let glitchBands: GlitchBand[] = [];
  let nextGlitchBandId = 0;
  let nextGlitchTimer: number | undefined;
  let cleanupGlitchTimers: number[] = [];

  function randomRange(min: number, max: number) {
    return min + Math.random() * (max - min);
  }

  function clearNextGlitchTimer() {
    if (nextGlitchTimer === undefined) {
      return;
    }

    window.clearTimeout(nextGlitchTimer);
    nextGlitchTimer = undefined;
  }

  function clearGlitchTimers() {
    clearNextGlitchTimer();
    cleanupGlitchTimers.forEach((timer) => window.clearTimeout(timer));
    cleanupGlitchTimers = [];
  }

  function scheduleGlitch() {
    clearNextGlitchTimer();

    if (!visible || returning) {
      return;
    }

    nextGlitchTimer = window.setTimeout(() => {
      if (!visible || returning) {
        return;
      }

      const band = {
        id: nextGlitchBandId++,
        top: randomRange(8, 88),
        height: Math.random() < 0.7 ? 1 : 2,
        offset: randomRange(-22, 22),
        duration: randomRange(120, 260),
        opacity: randomRange(0.36, 0.7),
      };

      glitchBands = [...glitchBands, band];

      const cleanupTimer = window.setTimeout(() => {
        glitchBands = glitchBands.filter((item) => item.id !== band.id);
        cleanupGlitchTimers = cleanupGlitchTimers.filter((timer) => timer !== cleanupTimer);
      }, band.duration + 90);

      cleanupGlitchTimers = [...cleanupGlitchTimers, cleanupTimer];
      scheduleGlitch();
    }, randomRange(260, 620));
  }

  function dismiss() {
    if (!visible || returning) {
      return;
    }

    onDismiss();
  }

  function defaultAriaLabel() {
    if (returning) {
      return "ゲームオーバーから復帰中";
    }
    if (reasonMessage) {
      const reason = reasonMessage.trimEnd();
      const separator = /[。！？.!?]$/.test(reason) ? "" : "。";
      return `ゲームオーバー。${reason}${separator}ゲームオーバーから復帰`;
    }
    return "ゲームオーバーから復帰";
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!visible || returning) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dismiss();
    }
  }

  $: if (visible) {
    window.addEventListener("keydown", handleKeydown);
    if (returning) {
      clearGlitchTimers();
      glitchBands = [];
    } else if (nextGlitchTimer === undefined) {
      scheduleGlitch();
    }
  } else {
    window.removeEventListener("keydown", handleKeydown);
    clearGlitchTimers();
    glitchBands = [];
  }

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
    clearGlitchTimers();
  });
</script>

{#if visible}
  <div
    class:returning
    class={`game-over-overlay${reasonMessage ? " with-reason" : ""}`}
  >
    <button
      class="game-over-scroll"
      type="button"
      aria-label={ariaLabel || defaultAriaLabel()}
      disabled={returning}
      on:click={dismiss}
    >
      <span class="game-over-content">
        {#if imageUrl}
          <img class="game-over-logo" src={resourceUrl(imageUrl)} alt="" aria-hidden="true" />
        {:else if titleText}
          <span class="game-over-title" aria-hidden="true">{titleText}</span>
        {/if}
        {#if reasonMessage}
          <span class="game-over-reason">
            {#each reasonMessage.split(/\r\n?|\n/) as paragraph, index}
              <span class="reason-paragraph" class:guidance={index > 0}>{paragraph}</span>
            {/each}
          </span>
          <span class="retry-label">{label}</span>
        {/if}
      </span>
      {#if !reasonMessage}
        <span class="retry-label">{label}</span>
      {/if}
    </button>
    {#each glitchBands as band (band.id)}
      <span
        class="glitch-band"
        style={`--top: ${band.top}%; --height: ${band.height}px; --offset: ${band.offset}px; --duration: ${band.duration}ms; --opacity: ${band.opacity};`}
        aria-hidden="true"
      ></span>
    {/each}
    <span class="return-fade" aria-hidden="true"></span>
  </div>
{/if}

<style>
  .game-over-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 0;
    border: 0;
    color: rgba(238, 247, 244, 0.86);
    background:
      radial-gradient(circle at 50% 45%, rgba(18, 31, 34, 0.08), rgba(2, 6, 8, 0.38) 58%, rgba(0, 0, 0, 0.6)),
      linear-gradient(120deg, rgba(0, 255, 219, 0.08), transparent 34%, rgba(255, 60, 82, 0.08)),
      rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(0.45px) brightness(0.78) saturate(0.72);
    cursor: pointer;
    isolation: isolate;
    animation: game-over-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  /* 暗転とグリッチの外枠は固定し、操作ボタン内だけをスクロールさせる。 */
  .game-over-scroll {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    cursor: inherit;
  }

  .game-over-scroll:disabled {
    cursor: default;
  }

  .game-over-overlay.with-reason .game-over-scroll {
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow-y: auto;
    padding: max(24px, env(safe-area-inset-top)) 0 max(24px, env(safe-area-inset-bottom));
    box-sizing: border-box;
  }

  .game-over-overlay::before,
  .game-over-overlay::after {
    position: absolute;
    inset: 0;
    content: "";
    pointer-events: none;
  }

  .game-over-overlay::before {
    z-index: 1;
    background:
      repeating-linear-gradient(
        0deg,
        rgba(255, 255, 255, 0.035) 0,
        rgba(255, 255, 255, 0.035) 1px,
        transparent 1px,
        transparent 5px
      ),
      linear-gradient(90deg, rgba(0, 255, 219, 0.08), transparent 26%, transparent 74%, rgba(255, 65, 83, 0.08));
    mix-blend-mode: screen;
    opacity: 0.5;
    animation: scanline-drift 1900ms linear infinite;
  }

  .game-over-overlay::after {
    z-index: 3;
    border: 1px solid rgba(255, 255, 255, 0.06);
    box-shadow:
      inset 0 0 112px rgba(0, 0, 0, 0.48),
      inset 0 0 26px rgba(255, 55, 70, 0.14);
  }

  .glitch-band {
    position: absolute;
    top: var(--top);
    right: -5vw;
    left: -5vw;
    z-index: 4;
    height: var(--height);
    pointer-events: none;
    background:
      linear-gradient(90deg, transparent, rgba(0, 255, 219, 0.34) 18%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 53, 80, 0.34) 82%, transparent),
      repeating-linear-gradient(90deg, transparent 0, transparent 9px, rgba(255, 255, 255, 0.22) 9px, rgba(255, 255, 255, 0.22) 12px);
    mix-blend-mode: screen;
    opacity: 0;
    filter: contrast(1.85) saturate(1.5);
    backdrop-filter: hue-rotate(22deg) brightness(1.35) contrast(1.65) saturate(1.7);
    animation: glitch-band-flicker var(--duration) steps(3, end) both;
  }

  .game-over-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: min(88vw, 760px);
    max-width: calc(100vw - 32px);
    padding: 0 16px clamp(34px, 7vh, 72px);
    box-sizing: border-box;
    gap: clamp(14px, 2.6vh, 24px);
    pointer-events: none;
  }

  .game-over-logo {
    position: relative;
    z-index: 2;
    display: block;
    width: min(84vw, 72dvh, 760px);
    max-height: 58dvh;
    object-fit: contain;
    object-position: center center;
    opacity: 0.96;
    filter:
      drop-shadow(0 0 20px rgba(0, 255, 219, 0.2))
      drop-shadow(0 10px 34px rgba(0, 0, 0, 0.72))
      saturate(1.02)
      contrast(1.05);
    animation: logo-strike 720ms cubic-bezier(0.2, 1, 0.22, 1) both;
  }

  .game-over-overlay.with-reason .game-over-logo {
    width: min(84vw, 62dvh, 720px);
    max-height: 48dvh;
  }

  .game-over-overlay.with-reason .game-over-content {
    flex-shrink: 0;
    margin: auto;
    padding: 0 16px;
  }

  .game-over-title {
    position: relative;
    z-index: 2;
    display: block;
    color: rgba(235, 255, 249, 0.94);
    font-size: clamp(3.4rem, 14vw, 9.4rem);
    font-weight: 920;
    line-height: 0.92;
    letter-spacing: 0;
    text-align: center;
    text-shadow:
      0 0 22px rgba(0, 255, 219, 0.26),
      0 10px 34px rgba(0, 0, 0, 0.72),
      2px 0 0 rgba(255, 53, 80, 0.35),
      -2px 0 0 rgba(0, 255, 219, 0.28);
    filter: saturate(1.05) contrast(1.05);
    animation: logo-strike 720ms cubic-bezier(0.2, 1, 0.22, 1) both;
  }

  .game-over-reason {
    position: relative;
    z-index: 2;
    display: block;
    width: min(100%, 420px);
    padding: 16px 20px;
    border: 1px solid rgba(230, 247, 244, 0.2);
    border-radius: 12px;
    box-sizing: border-box;
    color: rgba(238, 247, 244, 0.9);
    background: rgba(2, 7, 10, 0.8);
    font-size: clamp(0.9375rem, 3.6vw, 1rem);
    font-weight: 400;
    line-height: 1.75;
    letter-spacing: 0;
    text-align: left;
    overflow-wrap: anywhere;
    word-break: auto-phrase;
    text-wrap: pretty;
    text-shadow:
      0 0 18px rgba(0, 255, 219, 0.18),
      0 8px 28px rgba(0, 0, 0, 0.76);
    backdrop-filter: blur(12px);
    animation: reason-in 360ms ease-out 380ms both;
  }

  .reason-paragraph {
    display: block;
    min-height: 1.75em;
    white-space: pre-wrap;
  }

  .reason-paragraph + .reason-paragraph {
    margin-top: 0.6em;
  }

  .reason-paragraph.guidance {
    color: #8ff3e1;
    font-weight: 700;
  }

  @supports not (height: 100dvh) {
    .game-over-logo {
      width: min(84vw, 72vh, 760px);
      max-height: 58vh;
    }

    .game-over-overlay.with-reason .game-over-logo {
      width: min(84vw, 62vh, 720px);
      max-height: 48vh;
    }
  }

  .retry-label {
    --retry-offset-x: -50%;
    position: absolute;
    left: 50%;
    bottom: clamp(46px, 14vh, 118px);
    z-index: 5;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 128px;
    max-width: calc(100vw - 48px);
    padding: 10px 22px;
    border: 1px solid rgba(230, 247, 244, 0.28);
    border-radius: 8px;
    color: rgba(238, 247, 244, 0.9);
    background: rgba(2, 7, 10, 0.5);
    box-shadow:
      0 0 18px rgba(0, 255, 219, 0.1),
      inset 0 0 18px rgba(255, 255, 255, 0.04);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0;
    text-align: center;
    white-space: nowrap;
    transform: translateX(var(--retry-offset-x));
    backdrop-filter: blur(12px);
    animation: retry-in 360ms ease-out 560ms both;
  }

  .game-over-overlay.with-reason .retry-label {
    --retry-offset-x: 0%;
    position: static;
    box-sizing: border-box;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  @media (max-height: 480px) {
    .game-over-overlay.with-reason .game-over-logo {
      max-height: 30vh;
      max-height: 30dvh;
    }
  }

  .return-fade {
    position: absolute;
    inset: 0;
    z-index: 8;
    background: #000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
  }

  .game-over-overlay.returning .game-over-content,
  .game-over-overlay.returning .retry-label {
    opacity: 0;
    transition: opacity 100ms ease;
  }

  .game-over-overlay.returning .return-fade {
    opacity: 1;
  }

  @keyframes glitch-band-flicker {
    0% {
      opacity: 0;
      transform: translateX(calc(var(--offset) * -0.25));
      clip-path: inset(0 100% 0 0);
    }

    18% {
      opacity: var(--opacity);
      transform: translateX(calc(var(--offset) * -0.8));
      clip-path: inset(0 0 0 0);
    }

    46% {
      opacity: 0.3;
      transform: translateX(var(--offset));
    }

    72% {
      opacity: var(--opacity);
      transform: translateX(calc(var(--offset) * 0.38));
    }

    100% {
      opacity: 0;
      transform: translateX(calc(var(--offset) * 0.14));
      clip-path: inset(0 0 0 100%);
    }
  }

  @keyframes game-over-in {
    from {
      opacity: 0.01;
      transform: scale(1.018);
      filter: blur(6px);
    }

    to {
      opacity: 1;
      transform: scale(1);
      filter: blur(0);
    }
  }

  @keyframes logo-strike {
    0% {
      opacity: 0;
      transform: translateY(8px) scale(1.08);
      filter:
        drop-shadow(0 0 34px rgba(255, 65, 83, 0.28))
        drop-shadow(0 10px 34px rgba(0, 0, 0, 0.72))
        saturate(1.18)
        contrast(1.16)
        blur(5px);
    }

    54% {
      opacity: 1;
      transform: translateY(0) scale(0.985);
      filter:
        drop-shadow(0 0 26px rgba(0, 255, 219, 0.26))
        drop-shadow(0 10px 34px rgba(0, 0, 0, 0.72))
        saturate(1.08)
        contrast(1.12)
        blur(0);
    }

    100% {
      opacity: 0.96;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes reason-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes retry-in {
    from {
      opacity: 0;
      transform: translate(var(--retry-offset-x), 8px);
    }

    to {
      opacity: 1;
      transform: translate(var(--retry-offset-x), 0);
    }
  }

  @keyframes scanline-drift {
    from {
      transform: translateY(-5px);
    }

    to {
      transform: translateY(0);
    }
  }
</style>
