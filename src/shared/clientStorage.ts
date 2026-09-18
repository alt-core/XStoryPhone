export type ClientStorageSettings = Readonly<{
  mode: "persistent" | "memory";
  prefix: string;
}>;

// 配備先ではなく、クライアントの実ビルドに使う値を検証する。
export function resolveClientStorageSettings(
  playerMode: string,
  env: { VITE_XSTORYPHONE_CLIENT_STORAGE?: string; VITE_XSTORYPHONE_STORAGE_PREFIX?: string }
): ClientStorageSettings {
  const mode = env.VITE_XSTORYPHONE_CLIENT_STORAGE ?? "persistent";
  const prefix = env.VITE_XSTORYPHONE_STORAGE_PREFIX ?? "";
  if (mode !== "persistent" && mode !== "memory") {
    throw new Error("VITE_XSTORYPHONE_CLIENT_STORAGE は persistent または memory を指定してください。");
  }
  if (mode === "memory" && playerMode !== "browser") {
    throw new Error("VITE_XSTORYPHONE_CLIENT_STORAGE=memory は browser モード専用です。");
  }
  if (prefix !== prefix.trim() || /[\u0000-\u001f\u007f]/u.test(prefix)) {
    throw new Error("VITE_XSTORYPHONE_STORAGE_PREFIX に前後の空白や制御文字は使用できません。");
  }
  return { mode, prefix };
}

export function prefixStorageKey(key: string, prefix: string) {
  return prefix ? `${prefix}:${key}` : key;
}
