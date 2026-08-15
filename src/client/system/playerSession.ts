export function localPlayerMemoryKey(playerMode: "server" | "browser", sessionToken: string | undefined) {
  return playerMode === "browser" ? "browser-player" : sessionToken ?? "";
}

export function playerSessionChanged(
  playerMode: "server" | "browser",
  currentSessionToken: string | undefined,
  nextSessionToken: string | undefined,
  resumedBrowserProgress: boolean
) {
  return playerMode === "browser" ? !resumedBrowserProgress : currentSessionToken !== nextSessionToken;
}
