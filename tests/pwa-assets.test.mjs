import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function pngSize(path) {
  const data = readFileSync(path);
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test("PWA manifestはstandalone表示と汎用アイコンを定義する", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.deepEqual(manifest.icons.map((icon) => [icon.src, icon.sizes]), [
    ["/icons/icon-192.png", "192x192"],
    ["/icons/icon-512.png", "512x512"]
  ]);
  assert.deepEqual(pngSize("public/icons/icon-192.png"), [192, 192]);
  assert.deepEqual(pngSize("public/icons/icon-512.png"), [512, 512]);
  assert.deepEqual(pngSize("public/icons/apple-touch-icon.png"), [180, 180]);
});

test("HTMLはmanifestとホーム画面用メタ情報を参照する", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/u);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/u);
  assert.match(html, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/u);
});
