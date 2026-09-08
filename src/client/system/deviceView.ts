import type { DeviceView } from "../../project/projectStage";
import type { AppId } from "../../shared/appRegistry";

type DeviceViewInput = {
  locked: boolean;
  appId: AppId | null;
  searchAgentOpen: boolean;
  notificationShadeOpen: boolean;
  incomingCallActive: boolean;
  effectActive: boolean;
};

export function deviceViewFor(input: DeviceViewInput): DeviceView {
  // 通知トーストは含めず、端末の前景を占有する画面だけを返す。
  const screen: DeviceView["screen"] = input.incomingCallActive ? "incoming_call"
    : input.effectActive ? "effect"
    : input.locked ? "lock"
    : input.searchAgentOpen ? "search_agent"
    : input.notificationShadeOpen ? "notification_shade"
    : input.appId ? "app"
    : "home";
  return Object.freeze({ screen, appId: screen === "app" ? input.appId : null });
}
