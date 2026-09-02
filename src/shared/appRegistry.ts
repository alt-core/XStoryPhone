import { PROJECT_APP_IDS, type ProjectAppId } from "../generated/projectAppIds.generated.ts";

export const ENGINE_APPS = [
  { id: "phone", defaultIcon: "phone" },
  { id: "messages", defaultIcon: "message_circle" },
  { id: "photos", defaultIcon: "album" },
  { id: "chat", defaultIcon: "message_square_text" },
  { id: "notes", defaultIcon: "notebook_pen" },
  { id: "mail", defaultIcon: "mail" },
  { id: "calendar", defaultIcon: "calendar_days" },
  { id: "radio", defaultIcon: "radio" },
  { id: "browser", defaultIcon: "globe_2" }
] as const;

export const APP_REGISTRY = ENGINE_APPS;
export type EngineAppId = (typeof ENGINE_APPS)[number]["id"];
export type AppId = EngineAppId | ProjectAppId;

const engineAppIdSet = new Set<string>(ENGINE_APPS.map((app) => app.id));
const projectAppIdSet = new Set<string>(PROJECT_APP_IDS);

export function isAppId(value: unknown): value is AppId {
  return typeof value === "string" && (engineAppIdSet.has(value) || projectAppIdSet.has(value));
}

export function isProjectAppId(value: unknown): value is ProjectAppId {
  return typeof value === "string" && projectAppIdSet.has(value);
}
