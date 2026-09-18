// 配置設定だけを検証する。Originにpathを指定しても許可範囲を黙って広げない。
export function normalizeHttpOrigin(value: string, label = "origin") {
  let url: URL;
  try {
    if (!/^https?:\/\/[^/?#\\@*\s\u0000-\u001f\u007f]+\/?$/iu.test(value)) throw new Error();
    url = new URL(value);
  } catch {
    throw new Error(`${label} は https://example.com のようなoriginを指定してください。`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} はpath・query・fragment・認証情報のないHTTPS originを指定してください（HTTPはlocalhostのみ）。`);
  }
  return url.origin;
}

export function normalizeStaticBase(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || /[?#\\\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("静的baseは / または /some/path/ のような固定サブパスを指定してください。");
  }
  try {
    if (value.split("/").some((part) => {
      const decoded = decodeURIComponent(part);
      return decoded === "." || decoded === ".." || /[/\\#?%\u0000-\u001f\u007f]/u.test(decoded);
    })) throw new Error();
  } catch {
    throw new Error("静的baseに不正なエンコード、相対階層、#・?・%を含む配置名は指定できません。");
  }
  return new URL(value.endsWith("/") ? value : `${value}/`, "https://static.invalid").pathname;
}

function absoluteOrDocumentUrl(url: string) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/iu.test(url);
}

export function resolveStaticUrl(url: string, base: string) {
  if (!url || absoluteOrDocumentUrl(url)) return url;
  // 原素材のpathと配置baseが同じ名前でも省略しない。URLは描画・読込の入口で一度だけ解決する。
  return `${base}${url.replace(/^\.?\//u, "")}`;
}

export function resolveApiUrl(path: string, apiOrigin: string) {
  if (path !== "/api" && !path.startsWith("/api/")) throw new Error("APIのpathは /api/ から指定してください。");
  return `${apiOrigin}${path}`;
}

export function resolveResourceUrl(url: string, base: string, apiOrigin: string) {
  return url.startsWith("/api/") || url === "/api"
    ? resolveApiUrl(url, apiOrigin)
    : resolveStaticUrl(url, base);
}

// 比較だけに使い、実際のURLは変えない。符号化されたslashをpathの区切りへ展開しない。
export function pathnameKey(pathname: string): string | null {
  try {
    return pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/");
  } catch {
    return null;
  }
}

export function isStaticEntryPath(pathname: string, entry: "/logout" | "/reset-for-testing", base: string) {
  const path = pathnameKey(pathname.replace(/\/+$/u, ""));
  const target = pathnameKey(`${base}${entry.slice(1)}`);
  if (path === null || target === null) return false;
  return path === target || path === `${target}/index.html`;
}
