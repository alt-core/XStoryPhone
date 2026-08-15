import type { PlayerState } from "../client/system/playerApi";

export type PhonePresentationMode = "focused" | "embedded" | "hidden";

export type PhonePresentation = {
  mode: PhonePresentationMode;
};

export type ProjectStageContext = {
  sessionToken: string;
  playerState: PlayerState | null;
  projectState: Readonly<Record<string, string | number | boolean>>;
  dispatchScenarioEvent: (
    eventId: string,
    fields?: Record<string, string>
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};
