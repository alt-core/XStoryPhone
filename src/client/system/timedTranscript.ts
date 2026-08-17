import type { CallTranscriptCue } from "../scenario-runtime/types";

export function captionAt(transcript: readonly CallTranscriptCue[] | undefined, currentMs: number) {
  let caption = "";
  for (const cue of transcript ?? []) {
    if (cue.atMs > currentMs) break;
    caption = cue.text;
  }
  return caption;
}
