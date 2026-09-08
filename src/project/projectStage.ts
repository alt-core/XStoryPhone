import type { PlayerState } from "../client/system/playerApi";
import type { AppId } from "../shared/appRegistry";

export type PhonePresentationMode = "focused" | "embedded" | "hidden";

export type PhonePresentation = {
  mode: PhonePresentationMode;
};

export type DeviceView = Readonly<{
  screen: "lock" | "home" | "app" | "search_agent" | "notification_shade" | "incoming_call" | "effect";
  appId: AppId | null;
}>;

export type ProjectStageContext = {
  playerReady: boolean;
  playerState: PlayerState | null;
  projectState: Readonly<Record<string, string | number | boolean>>;
  deviceView: DeviceView;
  dispatchScenarioEvent: (
    eventId: string,
    fields?: Record<string, string>
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};
