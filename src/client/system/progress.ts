import type { AppId } from "../scenario-runtime/types";
import { safeLocalStorage } from "./browserStorage";

const STORAGE_KEY = "xstoryphone.ui";
const START_CONFIRMATION_STORAGE_KEY = "xstoryphone.start-confirmation";
const currentVersion = 5;
const startConfirmationVersion = 3;
const appIds = new Set<string>(["phone", "messages", "photos", "chat", "notes", "mail", "calendar", "radio", "browser"]);

export type PersistedUiState = {
  version: 5;
  locked: boolean;
  lockMethod?: "player-passcode" | "fixed-pin" | "none";
  sessionToken?: string;
  serialCounter?: string;
  openedAppIds: AppId[];
  lastContentByAppId: Partial<Record<AppId, string>>;
  localTalkReadCursors: Record<string, string>;
  pendingTalkReadCursors: Record<string, string>;
};

type StoredUiState = {
  version?: unknown;
  locked?: unknown;
  lockMethod?: unknown;
  sessionToken?: unknown;
  serialCounter?: unknown;
  openedAppIds?: unknown;
  lastContentByAppId?: unknown;
  localTalkReadCursors?: unknown;
  pendingTalkReadCursors?: unknown;
};

type StoredStartConfirmation = {
  version?: unknown;
  confirmed?: unknown;
};

export const defaultUiState: PersistedUiState = {
  version: currentVersion,
  locked: true,
  openedAppIds: [],
  lastContentByAppId: {},
  localTalkReadCursors: {},
  pendingTalkReadCursors: {}
};

function openedAppIdsFrom(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is AppId => typeof item === "string" && appIds.has(item)) : [];
}

function lastContentByAppIdFrom(value: unknown): Partial<Record<AppId, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([appId, contentId]) => appIds.has(appId) && typeof contentId === "string" && contentId.trim())
      .map(([appId, contentId]) => [appId, contentId])
  ) as Partial<Record<AppId, string>>;
}

function talkReadCursorsFrom(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([talkId, messageId]) => typeof talkId === "string" && talkId.trim() && typeof messageId === "string" && messageId.trim())
      .map(([talkId, messageId]) => [talkId, messageId])
  );
}

export function loadUiState(): PersistedUiState {
  const rawValue = safeLocalStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return defaultUiState;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredUiState;

    if (parsed.version !== currentVersion) {
      safeLocalStorage.removeItem(STORAGE_KEY);
      return defaultUiState;
    }

    return {
      version: currentVersion,
      locked: Boolean(parsed.locked),
      lockMethod: ["player-passcode", "fixed-pin", "none"].includes(String(parsed.lockMethod))
        ? parsed.lockMethod as PersistedUiState["lockMethod"]
        : undefined,
      sessionToken: typeof parsed.sessionToken === "string" ? parsed.sessionToken : undefined,
      serialCounter: typeof parsed.serialCounter === "string" ? parsed.serialCounter : undefined,
      openedAppIds: openedAppIdsFrom(parsed.openedAppIds),
      lastContentByAppId: lastContentByAppIdFrom(parsed.lastContentByAppId),
      localTalkReadCursors: talkReadCursorsFrom(parsed.localTalkReadCursors),
      pendingTalkReadCursors: talkReadCursorsFrom(parsed.pendingTalkReadCursors)
    };
  } catch {
    safeLocalStorage.removeItem(STORAGE_KEY);
    return defaultUiState;
  }
}

export function saveUiState(state: PersistedUiState) {
  safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function hasStartConfirmation() {
  const rawValue = safeLocalStorage.getItem(START_CONFIRMATION_STORAGE_KEY);

  if (!rawValue) {
    return false;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredStartConfirmation;
    if (parsed.version !== startConfirmationVersion || parsed.confirmed !== true) {
      safeLocalStorage.removeItem(START_CONFIRMATION_STORAGE_KEY);
      return false;
    }

    return true;
  } catch {
    safeLocalStorage.removeItem(START_CONFIRMATION_STORAGE_KEY);
    return false;
  }
}

export function saveStartConfirmation() {
  safeLocalStorage.setItem(
    START_CONFIRMATION_STORAGE_KEY,
    JSON.stringify({
      version: startConfirmationVersion,
      confirmed: true,
      confirmedAt: new Date().toISOString()
    })
  );
}

export function clearStartConfirmation() {
  safeLocalStorage.removeItem(START_CONFIRMATION_STORAGE_KEY);
}
