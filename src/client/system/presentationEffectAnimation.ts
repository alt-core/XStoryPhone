import type { PublicPresentationEffect } from "../../shared/presentation.ts";

export type FullscreenPresentationEffect = Exclude<PublicPresentationEffect, { type: "noise" }>;

export type PresentationEffectAnimationPlan = {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
};

const FLASH_FADE_IN_EASING = "cubic-bezier(0.12, 0.76, 0.22, 1)";
const FLASH_FADE_OUT_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const BLACKOUT_FADE_IN_EASING = "cubic-bezier(0.4, 0, 0.7, 0.2)";
const BLACKOUT_FADE_OUT_EASING = "cubic-bezier(0.3, 0.8, 0.4, 1)";

/**
 * 全画面演出を、立ち上がり・保持・余韻の3相へ変換する。
 * モーション軽減時は発光を省略し、暗転だけを線形の明滅として残す。
 */
export function presentationEffectAnimationPlan(
  effect: FullscreenPresentationEffect,
  reducedMotion: boolean
): PresentationEffectAnimationPlan | null {
  if (reducedMotion && effect.type === "flash") {
    return null;
  }

  const totalMs = effect.fadeInMs + effect.holdMs + effect.fadeOutMs;
  const peakOffset = effect.fadeInMs / totalMs;
  const releaseOffset = (effect.fadeInMs + effect.holdMs) / totalMs;
  const fadeInEasing = reducedMotion
    ? "linear"
    : effect.type === "flash"
      ? FLASH_FADE_IN_EASING
      : BLACKOUT_FADE_IN_EASING;
  const fadeOutEasing = reducedMotion
    ? "linear"
    : effect.type === "flash"
      ? FLASH_FADE_OUT_EASING
      : BLACKOUT_FADE_OUT_EASING;
  const keyframes: Keyframe[] = [
    { opacity: 0, offset: 0, easing: fadeInEasing },
    {
      opacity: effect.intensity,
      offset: peakOffset,
      easing: effect.holdMs > 0 ? "linear" : fadeOutEasing
    }
  ];

  if (effect.holdMs > 0) {
    keyframes.push({
      opacity: effect.intensity,
      offset: releaseOffset,
      easing: fadeOutEasing
    });
  }
  keyframes.push({ opacity: 0, offset: 1 });

  return {
    keyframes,
    options: {
      duration: totalMs,
      easing: "linear",
      fill: "both"
    }
  };
}
