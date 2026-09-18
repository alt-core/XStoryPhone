import { cloudflare } from "@cloudflare/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { demoProjectConstantsGenerated as projectConstants } from "./src/client/generated/demoProjectConstants.generated.ts";
import { resolveClientStorageSettings } from "./src/shared/clientStorage.ts";
import { normalizeHttpOrigin, normalizeStaticBase } from "./src/shared/deploymentUrls.ts";
import { staticBuildAssets } from "./scripts/static-build-assets.ts";

const standaloneClient = process.env.BUILD_PLATFORM === "aws" || process.env.BUILD_PLATFORM === "static";

export default defineConfig({
  plugins: [
    {
      name: "xstoryphone-client-storage-settings",
      config(config) {
        // Viteが相対baseや絶対URLを補正する前に、入力そのものを検証する。
        if (config.base !== undefined) {
          // Viteにはpathそのものを渡す。符号化済みの予約文字を二重encodeさせない。
          return { base: decodeURIComponent(normalizeStaticBase(config.base)) };
        }
      },
      configResolved(config) {
        // shellと.envを解決した、実際のクライアント設定を起動・ビルド前に検証する。
        resolveClientStorageSettings(String(projectConstants["player.mode"] ?? "server"), config.env);
        normalizeStaticBase(config.base);
        if (config.env.VITE_XSTORYPHONE_API_BASE_URL) {
          normalizeHttpOrigin(config.env.VITE_XSTORYPHONE_API_BASE_URL, "VITE_XSTORYPHONE_API_BASE_URL");
        }
      }
    },
    staticBuildAssets({ operationEntrypoints: process.env.BUILD_PLATFORM === "static" }),
    ...(standaloneClient ? [svelte()] : [svelte(), cloudflare()])
  ],
  build: {
    ...(standaloneClient ? { outDir: `dist/${process.env.BUILD_PLATFORM}` } : {}),
    sourcemap: false
  }
});
