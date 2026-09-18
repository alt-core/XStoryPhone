import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { normalizeStaticBase, resolveStaticUrl } from "../src/shared/deploymentUrls.ts";

// publicはViteによってそのまま複製されるため、配布manifestの既知のURL欄だけを補正する。
export function manifestForStaticBase(source: Record<string, unknown>, base: string, fileEntrypoint = false): Record<string, unknown> {
  const normalizedBase = normalizeStaticBase(base);
  const resolve = (value: unknown) => typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? resolveStaticUrl(value, normalizedBase)
    : value;
  const manifest = { ...source };
  for (const key of ["id", "start_url", "scope"]) {
    if (key in manifest) manifest[key] = resolve(manifest[key]);
  }
  // idだけはmanifestの場所ではなくorigin基準で解釈されるため、相対指定も配置baseへ固定する。
  if (normalizedBase !== "/" && typeof source.id === "string" && source.id
    && !/^(?:[a-z][a-z\d+.-]*:|\/)/iu.test(source.id)) {
    const id = new URL(source.id, `https://manifest.invalid${normalizedBase}`);
    manifest.id = `${id.pathname}${id.search}${id.hash}`;
  }
  if (Array.isArray(source.icons)) {
    manifest.icons = source.icons.map((icon: unknown) => icon && typeof icon === "object" && !Array.isArray(icon)
      ? { ...icon, ...("src" in icon ? { src: resolve(icon.src) } : {}) }
      : icon);
  }
  // ファイル配置だけのホストでもPWAを開始できるよう、ルート入口は実体HTMLへ向ける。
  if (fileEntrypoint && typeof manifest.start_url === "string") {
    const start = new URL(manifest.start_url, `https://manifest.invalid${normalizedBase}`);
    if (start.origin === "https://manifest.invalid" && start.pathname === normalizedBase) {
      manifest.start_url = `${normalizedBase}index.html${start.search}${start.hash}`;
    }
  }
  return manifest;
}

export async function finalizeStaticAssets(directory: string, base: string, operationEntrypoints: boolean, resetForTesting: boolean) {
  const manifestPath = path.join(directory, "manifest.webmanifest");
  try {
    const source = await readFile(manifestPath, "utf8");
    // 従来のroot配備は整形も含めて元のmanifestをそのまま保つ。
    if (normalizeStaticBase(base) !== "/" || operationEntrypoints) {
      await writeFile(manifestPath, `${JSON.stringify(manifestForStaticBase(JSON.parse(source), base, operationEntrypoints), null, 2)}\n`);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (!operationEntrypoints) return;
  const html = await readFile(path.join(directory, "index.html"));
  for (const entry of ["logout", ...(resetForTesting ? ["reset-for-testing"] : [])]) {
    const entryDirectory = path.join(directory, entry);
    await mkdir(entryDirectory, { recursive: true });
    await writeFile(path.join(entryDirectory, "index.html"), html);
  }
}

export function staticBuildAssets(options: { operationEntrypoints: boolean }): Plugin {
  let config: ResolvedConfig;
  return {
    name: "xstoryphone-static-build-assets",
    apply: "build",
    configResolved(resolved) { config = resolved; },
    async writeBundle(output, bundle) {
      // Cloudflareのworker側buildには触れず、最終client HTMLがある成果物だけを処理する。
      if (!("index.html" in bundle)) return;
      const directory = path.resolve(config.root, output.dir ?? config.build.outDir);
      await finalizeStaticAssets(directory, config.base, options.operationEntrypoints,
        config.env.VITE_XSTORYPHONE_RESET_FOR_TESTING === "true");
    }
  };
}
