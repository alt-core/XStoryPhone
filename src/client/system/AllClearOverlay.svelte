<script lang="ts">
  import { onDestroy } from "svelte";

  export let visible = false;
  export let imageUrl = "";
  export let titleText = "ALL CLEAR";
  export let label = "次へ";
  export let ariaLabel = "";
  export let returning = false;
  export let onDismiss: () => void = () => {};

  function dismiss() {
    if (!visible || returning) {
      return;
    }

    onDismiss();
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
  } else {
    window.removeEventListener("keydown", handleKeydown);
  }

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
  });
</script>

{#if visible}
  <button
    class:returning
    class="all-clear-overlay"
    type="button"
    aria-label={ariaLabel || (returning ? "オールクリア後の移動中" : "オールクリア後に移動")}
    disabled={returning}
    on:click={dismiss}
  >
    <span class="stage-light" aria-hidden="true"></span>
    {#if imageUrl}
      <img class="all-clear-logo" src={imageUrl} alt="" aria-hidden="true" />
    {:else if titleText}
      <span class="all-clear-title" aria-hidden="true">{titleText}</span>
    {/if}
    <span class="continue-label">{label}</span>
    <span class="whiteout-fade" aria-hidden="true"></span>
  </button>
{/if}

<style>
  .all-clear-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 0;
    border: 0;
    color: #2e5360;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(246, 254, 255, 0.98) 48%, rgba(255, 249, 238, 0.98) 100%),
      #fff;
    cursor: pointer;
    isolation: isolate;
    animation: all-clear-in 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .all-clear-overlay:disabled {
    cursor: default;
  }

  .all-clear-overlay::before,
  .all-clear-overlay::after {
    position: absolute;
    right: 0;
    left: 0;
    content: "";
    pointer-events: none;
  }

  .all-clear-overlay::before {
    top: 0;
    height: 36%;
    background: linear-gradient(180deg, rgba(212, 252, 255, 0.52), rgba(255, 255, 255, 0));
  }

  .all-clear-overlay::after {
    bottom: 0;
    height: 34%;
    background: linear-gradient(0deg, rgba(255, 232, 174, 0.24), rgba(255, 255, 255, 0));
  }

  .stage-light {
    position: absolute;
    top: 49%;
    left: 50%;
    z-index: 1;
    width: min(94vw, 980px);
    height: clamp(156px, 28dvh, 300px);
    background:
      linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 241, 181, 0.44) 24%, rgba(198, 252, 255, 0.54) 50%, rgba(255, 238, 181, 0.36) 76%, rgba(255, 255, 255, 0));
    filter: blur(28px);
    opacity: 0.86;
    transform: translate(-50%, -50%);
  }

  .all-clear-logo {
    position: relative;
    z-index: 2;
    display: block;
    width: min(90vw, 86dvh, 920px);
    max-height: 54dvh;
    object-fit: contain;
    object-position: center center;
    opacity: 0.98;
    filter:
      drop-shadow(0 2px 0 rgba(132, 93, 0, 0.24))
      drop-shadow(0 12px 30px rgba(38, 144, 162, 0.22))
      drop-shadow(0 0 28px rgba(255, 255, 255, 0.86))
      saturate(1.04)
      contrast(1.04);
    animation: all-clear-logo-in 620ms cubic-bezier(0.2, 1, 0.22, 1) both;
  }

  .all-clear-title {
    position: relative;
    z-index: 2;
    display: block;
    color: #1f6c77;
    font-size: clamp(3.2rem, 13vw, 9rem);
    font-weight: 920;
    line-height: 0.92;
    letter-spacing: 0;
    text-align: center;
    text-shadow:
      0 2px 0 rgba(255, 255, 255, 0.9),
      0 16px 34px rgba(52, 139, 151, 0.2);
    animation: all-clear-logo-in 620ms cubic-bezier(0.2, 1, 0.22, 1) both;
  }

  .continue-label {
    position: absolute;
    left: 50%;
    bottom: clamp(48px, 14vh, 120px);
    z-index: 3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 160px;
    max-width: calc(100vw - 48px);
    padding: 10px 22px;
    border: 1px solid rgba(45, 159, 172, 0.34);
    border-radius: 8px;
    color: #315967;
    background: rgba(255, 255, 255, 0.72);
    box-shadow:
      0 12px 30px rgba(58, 151, 166, 0.16),
      inset 0 0 18px rgba(255, 255, 255, 0.66);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0;
    text-align: center;
    white-space: nowrap;
    transform: translateX(-50%);
    backdrop-filter: blur(12px);
    animation: continue-in 360ms ease-out 520ms both;
  }

  .whiteout-fade {
    position: absolute;
    inset: 0;
    z-index: 8;
    background: #fff;
    opacity: 0;
    pointer-events: none;
    transition: opacity 220ms ease;
  }

  .all-clear-overlay.returning .all-clear-logo,
  .all-clear-overlay.returning .all-clear-title,
  .all-clear-overlay.returning .continue-label,
  .all-clear-overlay.returning .stage-light {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .all-clear-overlay.returning .whiteout-fade {
    opacity: 1;
  }

  @supports not (height: 100dvh) {
    .stage-light {
      height: clamp(156px, 28vh, 300px);
    }

    .all-clear-logo {
      width: min(90vw, 86vh, 920px);
      max-height: 54vh;
    }
  }

  @keyframes all-clear-in {
    from {
      opacity: 0.01;
      filter: blur(5px);
    }

    to {
      opacity: 1;
      filter: blur(0);
    }
  }

  @keyframes all-clear-logo-in {
    0% {
      opacity: 0;
      transform: translateY(10px) scale(1.035);
      filter:
        drop-shadow(0 2px 0 rgba(132, 93, 0, 0.18))
        drop-shadow(0 18px 38px rgba(38, 144, 162, 0.18))
        blur(5px)
        saturate(1.02)
        contrast(1.02);
    }

    100% {
      opacity: 0.98;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes continue-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }

    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
