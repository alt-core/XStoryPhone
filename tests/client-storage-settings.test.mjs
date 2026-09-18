import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resolveConfig } from "vite";
import { prefixStorageKey, resolveClientStorageSettings } from "../src/shared/clientStorage.ts";
import { normalizeHttpOrigin, normalizeStaticBase } from "../src/shared/deploymentUrls.ts";
import { staticBuildAssets } from "../scripts/static-build-assets.ts";

test("クライアント保存は未指定なら現行の保存名とpersistentを維持する", () => {
  for (const playerMode of ["server", "browser"]) {
    assert.deepEqual(resolveClientStorageSettings(playerMode, {}), { mode: "persistent", prefix: "" });
    assert.deepEqual(resolveClientStorageSettings(playerMode, {
      VITE_XSTORYPHONE_CLIENT_STORAGE: "persistent",
      VITE_XSTORYPHONE_STORAGE_PREFIX: ""
    }), { mode: "persistent", prefix: "" });
  }
  assert.equal(prefixStorageKey("xstoryphone.ui", ""), "xstoryphone.ui");
});

test("memoryはbrowser専用とし、未知値や空白を黙って補正しない", () => {
  assert.deepEqual(resolveClientStorageSettings("browser", {
    VITE_XSTORYPHONE_CLIENT_STORAGE: "memory",
    VITE_XSTORYPHONE_STORAGE_PREFIX: "作品-prod"
  }), { mode: "memory", prefix: "作品-prod" });
  assert.throws(() => resolveClientStorageSettings("server", {
    VITE_XSTORYPHONE_CLIENT_STORAGE: "memory"
  }), /browser モード専用/u);
  for (const mode of ["", "Memory", "persist", " memory", "memory ", "persistent\n"]) {
    assert.throws(() => resolveClientStorageSettings("browser", {
      VITE_XSTORYPHONE_CLIENT_STORAGE: mode
    }), /persistent または memory/u);
  }
});

test("prefixはそのまま保存名の前に付け、前後空白や制御文字は拒否する", () => {
  const settings = resolveClientStorageSettings("server", { VITE_XSTORYPHONE_STORAGE_PREFIX: "作者 作品-prod" });
  assert.equal(prefixStorageKey("xstoryphone.ui", settings.prefix), "作者 作品-prod:xstoryphone.ui");
  for (const prefix of [" prefix", "prefix ", "\tprefix", "prefix\n", "pre\u0000fix", "pre\u007ffix"]) {
    assert.throws(() => resolveClientStorageSettings("browser", {
      VITE_XSTORYPHONE_STORAGE_PREFIX: prefix
    }), /前後の空白や制御文字/u);
  }
});

// 配備プラグインは起動せず、実vite.configの設定検証をViteのenv解決へ接続する。
function configForPlayer(playerMode) {
  const source = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const sandbox = {
    exports: {},
    process: { env: { BUILD_PLATFORM: "aws" } },
    require(name) {
      if (name === "vite") return { defineConfig: (config) => config };
      if (name === "@sveltejs/vite-plugin-svelte") return { svelte: () => ({ name: "test-svelte" }) };
      if (name === "@cloudflare/vite-plugin") return { cloudflare() { throw new Error("配備プラグインは起動しない"); } };
      if (name.endsWith("/demoProjectConstants.generated.ts")) {
        return { demoProjectConstantsGenerated: { "player.mode": playerMode } };
      }
      if (name.endsWith("/shared/clientStorage.ts")) return { resolveClientStorageSettings };
      if (name.endsWith("/shared/deploymentUrls.ts")) return { normalizeHttpOrigin, normalizeStaticBase };
      if (name.endsWith("/static-build-assets.ts")) return { staticBuildAssets };
      throw new Error(`未定義のimport: ${name}`);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, sandbox);
  return sandbox.exports.default;
}

test("Viteが実際に読む.envとshell値を、生成projectのplayer.modeと照合する", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xstoryphone-storage-settings-"));
  const keys = ["VITE_XSTORYPHONE_CLIENT_STORAGE", "VITE_XSTORYPHONE_STORAGE_PREFIX"];
  const originalEnvironment = new Map(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  const resolve = (playerMode, command = "build") => resolveConfig({
    ...configForPlayer(playerMode), configFile: false, root: directory, logLevel: "silent"
  }, command);
  try {
    writeFileSync(path.join(directory, ".env"), "VITE_XSTORYPHONE_CLIENT_STORAGE=memory\nVITE_XSTORYPHONE_STORAGE_PREFIX=env-project\n");
    for (const command of ["serve", "build"]) {
      await assert.rejects(resolve("server", command), /browser モード専用/u);
    }
    const browserConfig = await resolve("browser");
    assert.equal(browserConfig.env.VITE_XSTORYPHONE_CLIENT_STORAGE, "memory");
    assert.equal(browserConfig.env.VITE_XSTORYPHONE_STORAGE_PREFIX, "env-project");

    process.env.VITE_XSTORYPHONE_CLIENT_STORAGE = "persistent";
    assert.equal((await resolve("server")).env.VITE_XSTORYPHONE_CLIENT_STORAGE, "persistent");
    process.env.VITE_XSTORYPHONE_CLIENT_STORAGE = "unknown";
    await assert.rejects(resolve("browser"), /persistent または memory/u);
    delete process.env.VITE_XSTORYPHONE_CLIENT_STORAGE;
    writeFileSync(path.join(directory, ".env"), "VITE_XSTORYPHONE_CLIENT_STORAGE=unknown\n");
    await assert.rejects(resolve("browser"), /persistent または memory/u);
  } finally {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
