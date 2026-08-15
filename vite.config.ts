import { cloudflare } from "@cloudflare/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: process.env.BUILD_PLATFORM === "aws" ? [svelte()] : [svelte(), cloudflare()],
  build: {
    ...(process.env.BUILD_PLATFORM === "aws" ? { outDir: "dist/aws" } : {}),
    sourcemap: false
  }
});
