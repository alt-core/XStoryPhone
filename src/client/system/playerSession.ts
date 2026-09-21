export function localPlayerMemoryKey(playerMode: "server" | "browser" | "static", sessionToken: string | undefined) {
  return playerMode !== "server" ? `${playerMode}-player` : sessionToken ?? "";
}

export function playerSessionChanged(
  playerMode: "server" | "browser" | "static",
  currentSessionToken: string | undefined,
  nextSessionToken: string | undefined,
  resumedBrowserProgress: boolean
) {
  return playerMode !== "server" ? !resumedBrowserProgress : currentSessionToken !== nextSessionToken;
}
