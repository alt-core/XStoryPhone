import type { PhonePresentationMode } from "../../project/projectStage";

export const PHONE_STAGE_SHELL_WIDTH = 410;
export const PHONE_STAGE_SHELL_HEIGHT = 698;
const SCREEN_WIDTH = 384;
const SCREEN_HEIGHT = 672;

export function resolvePhoneStageLayout(
  mode: PhonePresentationMode,
  viewportWidth: number,
  availableWidth: number,
  availableHeight: number
) {
  const interactive = mode === "focused";
  const frameOnly = interactive && viewportWidth <= 520;
  const designWidth = frameOnly ? SCREEN_WIDTH : PHONE_STAGE_SHELL_WIDTH;
  const designHeight = frameOnly ? SCREEN_HEIGHT : PHONE_STAGE_SHELL_HEIGHT;
  const maxScale = frameOnly ? 1.15 : 1;

  return {
    interactive,
    hidden: mode === "hidden",
    frameOnly,
    designWidth,
    designHeight,
    scale: Math.min(availableWidth / designWidth, availableHeight / designHeight, maxScale)
  };
}
