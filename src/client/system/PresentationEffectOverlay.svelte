<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type { FullscreenPresentationEffect } from "./presentationEffectAnimation.ts";
  import { presentationEffectAnimationPlan } from "./presentationEffectAnimation.ts";

  export let onActiveChange: (active: boolean) => void = () => {};

  let overlayElement: HTMLDivElement;
  let active = false;
  let effectType: FullscreenPresentationEffect["type"] = "blackout";
  let effectColor = "#fffaf2";
  let currentAnimation: Animation | undefined;
  let playbackSerial = 0;

  function setActive(nextActive: boolean) {
    if (active === nextActive) {
      return;
    }
    active = nextActive;
    onActiveChange(active);
  }

  function blockPhoneKeydown(event: KeyboardEvent) {
    if (!active || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  onMount(() => {
    window.addEventListener("keydown", blockPhoneKeydown, true);
    return () => {
      window.removeEventListener("keydown", blockPhoneKeydown, true);
    };
  });

  onDestroy(() => {
    cancel();
  });

  /** 現在の演出を破棄し、再生待ちを正常終了させる。 */
  export function cancel() {
    playbackSerial += 1;
    const animation = currentAnimation;
    currentAnimation = undefined;
    setActive(false);
    animation?.cancel();
  }

  /** 同じ種類が連続しても、毎回新しいアニメーションとして先頭から再生する。 */
  export async function play(effect: FullscreenPresentationEffect) {
    cancel();
    const playbackId = ++playbackSerial;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const plan = presentationEffectAnimationPlan(effect, reducedMotion);
    if (!plan) {
      return;
    }

    effectType = effect.type;
    if (effect.type === "flash") {
      effectColor = effect.color;
    }
    setActive(true);

    let animation: Animation | undefined;
    try {
      await tick();
      if (playbackId !== playbackSerial) {
        return;
      }
      animation = overlayElement.animate(plan.keyframes, plan.options);
      currentAnimation = animation;
      await animation.finished;
    } catch (error) {
      // Animation.cancel() による finished の拒否は、リセット時の通常終了として扱う。
      if (playbackId === playbackSerial) {
        throw error;
      }
    } finally {
      if (playbackId === playbackSerial) {
        currentAnimation = undefined;
        setActive(false);
        animation?.cancel();
      }
    }
  }
</script>

<div
  bind:this={overlayElement}
  class="presentation-effect"
  class:presentation-effect--active={active}
  class:presentation-effect--flash={effectType === "flash"}
  class:presentation-effect--blackout={effectType === "blackout"}
  style={`--presentation-effect-color: ${effectColor};`}
  aria-hidden="true"
></div>

<style>
  .presentation-effect {
    position: absolute;
    inset: 0;
    z-index: 30;
    contain: strict;
    opacity: 0;
    pointer-events: none;
  }

  .presentation-effect--active {
    pointer-events: auto;
    will-change: opacity;
  }

  .presentation-effect--flash {
    background:
      radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0) 62%),
      var(--presentation-effect-color);
  }

  .presentation-effect--blackout {
    background: #000;
  }
</style>
