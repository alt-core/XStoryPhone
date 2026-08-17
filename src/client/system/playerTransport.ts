export function browserPlayerRequestInit(
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  progressToken: string
): RequestInit {
  let payload: Record<string, unknown> = {};
  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body !== "string") {
      throw new Error("browserモードのplayer APIはJSON bodyだけを扱えます。");
    }
    const parsed = JSON.parse(init.body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("browserモードのplayer API bodyはJSON objectである必要があります。");
    }
    payload = parsed as Record<string, unknown>;
  }
  return {
    ...init,
    method: "POST",
    headers: { ...init.headers, "content-type": "application/json" },
    body: JSON.stringify({ ...payload, progressToken })
  };
}
