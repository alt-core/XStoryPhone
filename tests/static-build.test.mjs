import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { build, resolveConfig } from "vite";
import { runStaticBuild, staticBuildArguments } from "../scripts/build-static.mjs";
import { finalizeStaticAssets, manifestForStaticBase, staticBuildAssets } from "../scripts/static-build-assets.ts";
import { resolveClientStorageSettings } from "../src/shared/clientStorage.ts";
import { normalizeHttpOrigin, normalizeStaticBase, pathnameKey } from "../src/shared/deploymentUrls.ts";

test("静的ビルドはVite引数と境界監査を分離し、AWS固有監査を呼ばない", () => {
  const calls = [];
  runStaticBuild(["--base=/some/path/", "--mode", "production"], (command, arguments_) => calls.push([command, arguments_]));
  assert.deepEqual(calls.map(([, arguments_]) => arguments_.slice(0, 2)), [
    ["run", "assets:build"], ["run", "scenario:build"],
    [path.resolve("node_modules/vite/bin/vite.js"), "build"], ["run", "audit:client:static"]
  ]);
  assert.deepEqual(calls[2][1].slice(2), ["--base=/some/path/", "--mode", "production"]);
  assert.deepEqual(calls[3][1], ["run", "audit:client:static"]);
  for (const arguments_ of [["--outDir", "elsewhere"], ["--config=x.ts"], ["--base"], ["--typo"]]) {
    const rejectedCalls = [];
    assert.throws(() => runStaticBuild(arguments_, (...call) => rejectedCalls.push(call)), /未知または不完全/u);
    assert.deepEqual(rejectedCalls, []);
  }
  assert.deepEqual(staticBuildArguments(["--base", "/path/"]), ["--base", "/path/"]);
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["build:static"], "node scripts/build-static.mjs");
  assert.equal(packageJson.scripts["audit:client:static"], "node scripts/audit-client-boundary.mjs dist/static");
});

test("manifestは既知のroot相対URL欄だけをbase配下へ移し、作者設定と絶対URLを保つ", () => {
  const source = {
    name: "作者の名前", description: "作者の説明", id: "/", start_url: "/?from=pwa", scope: "/",
    icons: [{ src: "/icons/one.png", purpose: "maskable" }, { src: "relative.png" }, { src: "https://media.example/icon.png" }, { src: "//media.example/icon.png" }],
    custom: { url: "/change-nothing" }
  };
  const before = structuredClone(source);
  assert.deepEqual(manifestForStaticBase(source, "/some/path/"), {
    ...source, id: "/some/path/", start_url: "/some/path/?from=pwa", scope: "/some/path/",
    icons: [{ src: "/some/path/icons/one.png", purpose: "maskable" }, ...source.icons.slice(1)]
  });
  assert.deepEqual(source, before);
  assert.deepEqual(manifestForStaticBase(source, "/"), source);
  for (const [id, expected] of [["./", "/some/path/"], ["my-game", "/some/path/my-game"], ["?app=one", "/some/path/?app=one"]]) {
    assert.equal(manifestForStaticBase({ id }, "/some/path/").id, expected);
    assert.equal(manifestForStaticBase({ id }, "/").id, id);
  }
  for (const id of ["", "https://static.example/custom-id", "//static.example/custom-id"]) {
    assert.equal(manifestForStaticBase({ id }, "/some/path/").id, id);
  }
  for (const base of ["/", "/some/path/"]) {
    assert.equal(manifestForStaticBase({ start_url: "/?from=pwa#start" }, base, true).start_url, `${base}index.html?from=pwa#start`);
    assert.equal(manifestForStaticBase({ start_url: "./" }, base, true).start_url, `${base}index.html`);
    assert.equal(manifestForStaticBase({ start_url: "custom.html" }, base, true).start_url, "custom.html");
    assert.equal(manifestForStaticBase({ start_url: "https://static.example/custom/" }, base, true).start_url, "https://static.example/custom/");
  }
});

test("最終HTMLからlogoutとテスト専用reset入口を生成し、元のmanifestは変更しない", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "xstoryphone-static-assets-"));
  const originalManifest = readFileSync("public/manifest.webmanifest", "utf8");
  const html = '<html><script src="/some/path/assets/main.js"></script></html>';
  try {
    for (const [name, base, entries, reset] of [["root", "/", false, false], ["static-root", "/", true, false], ["prod", "/some/path/", true, false], ["dev", "/some/path/", true, true]]) {
      const directory = path.join(root, name);
      mkdirSync(directory);
      writeFileSync(path.join(directory, "manifest.webmanifest"), originalManifest);
      writeFileSync(path.join(directory, "index.html"), html);
      await finalizeStaticAssets(directory, base, entries, reset);
      assert.equal(readFileSync(path.join(directory, "index.html"), "utf8"), html);
      assert.equal(existsSync(path.join(directory, "logout/index.html")), entries);
      assert.equal(existsSync(path.join(directory, "reset-for-testing/index.html")), entries && reset);
      if (entries) assert.equal(readFileSync(path.join(directory, "logout/index.html"), "utf8"), html);
      if (reset) assert.equal(readFileSync(path.join(directory, "reset-for-testing/index.html"), "utf8"), html);
      const manifest = readFileSync(path.join(directory, "manifest.webmanifest"), "utf8");
      if (base === "/" && !entries) assert.equal(manifest, originalManifest);
      else {
        assert.equal(JSON.parse(manifest).id, base);
        assert.equal(JSON.parse(manifest).icons[0].src, `${base}icons/icon-192.png`);
        assert.equal(JSON.parse(manifest).start_url, `${base}index.html`);
      }
    }
    assert.equal(readFileSync("public/manifest.webmanifest", "utf8"), originalManifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function clientConfig(platform) {
  const source = readFileSync("vite.config.ts", "utf8");
  const sandbox = {
    exports: {}, process: { env: { BUILD_PLATFORM: platform } },
    require(name) {
      if (name === "vite") return { defineConfig: (config) => config };
      if (name === "@sveltejs/vite-plugin-svelte") return { svelte: () => ({ name: "test-svelte" }) };
      if (name === "@cloudflare/vite-plugin") return { cloudflare: () => ({ name: "test-cloudflare" }) };
      if (name.endsWith("/demoProjectConstants.generated.ts")) return { demoProjectConstantsGenerated: { "player.mode": "server" } };
      if (name.endsWith("/clientStorage.ts")) return { resolveClientStorageSettings };
      if (name.endsWith("/deploymentUrls.ts")) return { normalizeHttpOrigin, normalizeStaticBase };
      if (name.endsWith("/static-build-assets.ts")) return { staticBuildAssets };
      if (name.endsWith("/static-execution-assets.ts")) return { staticExecutionAssets: () => ({ name: "test-static-execution" }) };
      throw new Error(`未定義のimport: ${name}`);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, sandbox);
  return sandbox.exports.default;
}

test("AWSとstaticはCloudflare pluginを使わず既存の出力を維持する", () => {
  for (const platform of ["aws", "static"]) {
    const config = clientConfig(platform);
    assert.equal(config.build.outDir, `dist/${platform}`);
    assert.ok(!config.plugins.some((plugin) => plugin.name === "test-cloudflare"));
  }
  const cloudflare = clientConfig(undefined);
  assert.equal(cloudflare.build.outDir, undefined);
  assert.ok(cloudflare.plugins.some((plugin) => plugin.name === "test-cloudflare"));
});

test("API originの.env値とshell優先値を実際のVite envで検証する", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xstoryphone-deployment-env-"));
  const key = "VITE_XSTORYPHONE_API_BASE_URL";
  const original = process.env[key];
  delete process.env[key];
  const resolve = (base = "/") => resolveConfig({
    ...clientConfig("static"), base, configFile: false, root: directory, logLevel: "silent"
  }, "build");
  try {
    writeFileSync(path.join(directory, ".env"), `${key}=https://api.example/api\n`);
    await assert.rejects(resolve(), /origin|オリジン/u);
    process.env[key] = "https://api.example";
    assert.equal((await resolve("/some/path/")).env[key], "https://api.example");
    process.env[key] = "http://api.example";
    await assert.rejects(resolve(), /HTTPS|https/u);
    process.env[key] = "http://127.0.0.1:8787";
    assert.equal((await resolve()).env[key], "http://127.0.0.1:8787");
    delete process.env[key];
    writeFileSync(path.join(directory, ".env"), `${key}=https://api.example\n`);
    for (const base of ["./", "https://static.example/", "/some/path/?query"]) await assert.rejects(resolve(base));
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("日本語・空白・予約文字のbaseは生表記と符号化表記で同じ実体URLを生成する", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xstoryphone-base-encoding-"));
  const segment = "作品 space@:+,;&=$";
  const expected = pathnameKey(`/${segment}/`);
  const pathKey = (value) => pathnameKey(new URL(value.replaceAll("&amp;", "&"), "https://static.example").pathname);
  try {
    mkdirSync(path.join(directory, "public"));
    writeFileSync(path.join(directory, "index.html"), '<!doctype html><link rel="manifest" href="/manifest.webmanifest"><script type="module" src="/main.js"></script>');
    writeFileSync(path.join(directory, "main.js"), 'import "./style.css"; document.body.dataset.ready = "yes";');
    writeFileSync(path.join(directory, "style.css"), 'body { background-image: url("/icon.svg"); }');
    writeFileSync(path.join(directory, "public/icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    writeFileSync(path.join(directory, "public/manifest.webmanifest"), JSON.stringify({ id: "/", start_url: "/", scope: "/", icons: [{ src: "/icon.svg" }] }));
    for (const base of [`/${segment}/`, `/${encodeURIComponent(segment)}/`]) {
      const result = await build({
        ...clientConfig("static"), root: directory, configFile: false, envDir: false, envPrefix: "TEST_ONLY_", base,
        logLevel: "silent", build: { outDir: "dist", emptyOutDir: true }
      });
      const html = readFileSync(path.join(directory, "dist/index.html"), "utf8");
      const htmlUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1]);
      assert.ok(htmlUrls.length >= 3);
      assert.ok(htmlUrls.every((url) => pathKey(url)?.startsWith(expected)), html);
      const output = Array.isArray(result) ? result[0].output : result.output;
      const css = output.find((item) => item.type === "asset" && item.fileName.endsWith(".css")).source;
      const imageUrl = String(css).match(/url\(([^)]+)\)/u)[1].replace(/^["']|["']$/gu, "");
      assert.equal(pathKey(imageUrl), `${expected}icon.svg`);
      const manifest = JSON.parse(readFileSync(path.join(directory, "dist/manifest.webmanifest"), "utf8"));
      assert.equal(pathKey(manifest.id), expected);
      assert.equal(pathKey(manifest.start_url), `${expected}index.html`);
      assert.equal(pathKey(manifest.icons[0].src), `${expected}icon.svg`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
