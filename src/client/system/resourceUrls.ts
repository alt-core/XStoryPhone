import { isStaticEntryPath, normalizeHttpOrigin, normalizeStaticBase, pathnameKey, resolveApiUrl, resolveResourceUrl, resolveStaticUrl } from "../../shared/deploymentUrls.ts";

export const appBaseUrl = normalizeStaticBase(import.meta.env?.BASE_URL ?? "/");
const configuredApiOrigin = import.meta.env?.VITE_XSTORYPHONE_API_BASE_URL ?? "";
const apiOrigin = configuredApiOrigin ? normalizeHttpOrigin(configuredApiOrigin, "VITE_XSTORYPHONE_API_BASE_URL") : "";

export const apiUrl = (path: string) => resolveApiUrl(path, apiOrigin);
export const staticUrl = (path: string) => resolveStaticUrl(path, appBaseUrl);
export const isAppEntryPath = (pathname: string, entry: "/logout" | "/reset-for-testing") => isStaticEntryPath(pathname, entry, appBaseUrl);
// directory indexのないホストでは、操作入口と同様に実体ファイルへ戻る。
export const appReturnUrl = (pathname: string) => pathnameKey(pathname.replace(/\/+$/u, ""))?.endsWith("/index.html") ? `${appBaseUrl}index.html` : appBaseUrl;

export function resourceUrl(url: string): string;
export function resourceUrl(url: null | undefined): undefined;
export function resourceUrl(url: string | null | undefined): string | undefined;
export function resourceUrl(url: string | null | undefined) {
  return url == null ? undefined : resolveResourceUrl(url, appBaseUrl, apiOrigin);
}
