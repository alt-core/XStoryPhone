import * as browser from "./browserPlayerStorage.ts";
import { localPlayerExecution } from "../generated/playerExecution.generated.ts";
export { BrowserPlayerStorageError, isBrowserPlayerStorageError } from "./playerStorageError.ts";
export { BROWSER_PLAYER_CLEARED_EVENT, BROWSER_PLAYER_STORAGE_ERROR_EVENT, BROWSER_PLAYER_MARKER } from "./browserPlayerStorage.ts";

export const loadBrowserPlayerMarker = () => localPlayerExecution ? localPlayerExecution.marker() : browser.loadBrowserPlayerMarker();
export const loadCachedBrowserPlayerState = () => localPlayerExecution ? localPlayerExecution.cachedState() : browser.loadCachedBrowserPlayerState();
export const prepareBrowserPlayerRequest = () => localPlayerExecution ? localPlayerExecution.prepare() : browser.prepareBrowserPlayerRequest();
export const clearBrowserPlayerStorage = (options: { expectedProgressToken?: string | null } = {}) => localPlayerExecution
  ? localPlayerExecution.clear(options.expectedProgressToken) : browser.clearBrowserPlayerStorage(options);
export const initializeBrowserPlayerStorage = (options: Parameters<typeof browser.initializeBrowserPlayerStorage>[0]) => localPlayerExecution
  ? localPlayerExecution.initialize() : browser.initializeBrowserPlayerStorage(options);
export const deleteBrowserPlayerDatabase = (...args: Parameters<typeof browser.deleteBrowserPlayerDatabase>) => localPlayerExecution
  ? localPlayerExecution.delete() : browser.deleteBrowserPlayerDatabase(...args);
