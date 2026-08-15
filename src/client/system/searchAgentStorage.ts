import { safeLocalStorage } from "./browserStorage";

export const searchAgentLocalStorageKey = "xstoryphone.searchAgent-local.v3";

export function clearSearchAgentLocalMessages() {
  safeLocalStorage.removeItem(searchAgentLocalStorageKey);
}
