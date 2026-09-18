import assert from "node:assert/strict";
import test from "node:test";
import { appReturnUrl } from "../src/client/system/resourceUrls.ts";
import { isStaticEntryPath, normalizeHttpOrigin, normalizeStaticBase, resolveApiUrl, resolveResourceUrl, resolveStaticUrl } from "../src/shared/deploymentUrls.ts";

test("配信originはHTTPSかローカルHTTPに限定し、path等を正規化で隠さない", () => {
  assert.equal(normalizeHttpOrigin("https://EXAMPLE.com:443/"), "https://example.com");
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(normalizeHttpOrigin(`http://${host}:5173/`), `http://${host}:5173`);
  }
  for (const value of ["", "null", "*", "https://*.example.com", "http://example.com", "https://example.com/api",
    "https://example.com/../", "https://example.com/?", "https://example.com/#", "https://@example.com",
    "https://user:pass@example.com", "https://example.com?x=1", "https://example.com#x", " https://example.com",
    "https://example.com\\", "https://example.com\n", "https://example.com\u0000"]) {
    assert.throws(() => normalizeHttpOrigin(value, "設定値"), /設定値/u, value);
  }
});

test("固定baseはルートとサブパスを扱い、相対階層や別originへのbaseを拒否する", () => {
  assert.equal(normalizeStaticBase("/"), "/");
  assert.equal(normalizeStaticBase("/works/demo"), "/works/demo/");
  assert.equal(normalizeStaticBase("/作品/"), "/%E4%BD%9C%E5%93%81/");
  assert.equal(normalizeStaticBase("/works space/"), "/works%20space/");
  for (const value of ["", "./", "demo/", "https://cdn.example/", "//cdn.example/", "/a/../", "/a/%2e%2e/",
    "/a/%2f/", "/a/%5c/", "/a/%00/", "/a/%23/", "/a/%3f/", "/a/%25/", "/a?x", "/a#x", "/a\\b/", "/bad%/"]) {
    assert.throws(() => normalizeStaticBase(value), /静的base/u, value);
  }
});

test("静的素材とAPI生成素材を分け、外部URL・data・blob・文書内リンクは変えない", () => {
  const base = "/works/demo/";
  const api = "https://api.example.com";
  assert.equal(resolveResourceUrl("/system/icon.png", base, api), `${base}system/icon.png`);
  assert.equal(resolveResourceUrl("demo/image.png", base, api), `${base}demo/image.png`);
  assert.equal(resolveResourceUrl("./demo/image.png", base, api), `${base}demo/image.png`);
  assert.equal(resolveResourceUrl("/api/generated-audio/static/id?x=1", base, api), `${api}/api/generated-audio/static/id?x=1`);
  assert.equal(resolveApiUrl("/api/session/start", ""), "/api/session/start");
  assert.equal(resolveStaticUrl("/demo/site/index.html", "/demo/"), "/demo/demo/site/index.html");
  assert.equal(resolveStaticUrl("/system/icon.png", "/system/"), "/system/system/icon.png");
  assert.equal(resolveStaticUrl("/privacy-policy.html", "/"), "/privacy-policy.html");
  for (const url of ["", "https://media.example/image.png", "//media.example/image.png", "data:image/png;base64,abc", "blob:https://example.com/id", "#section", "?page=2"]) {
    assert.equal(resolveResourceUrl(url, base, api), url);
  }
  assert.throws(() => resolveApiUrl("https://other.example/api/state", api), /APIのpath/u);
});

test("logout/resetは当該baseの通常URLと実体index.htmlだけを認識する", () => {
  for (const base of ["/", "/works/demo/", normalizeStaticBase("/作品/")]) {
    for (const entry of ["/logout", "/reset-for-testing"]) {
      for (const ending of [entry.slice(1), `${entry.slice(1)}/`, `${entry.slice(1)}/index.html`]) {
        assert.equal(isStaticEntryPath(`${base}${ending}`, entry, base), true);
      }
      assert.equal(isStaticEntryPath(`/different${entry}`, entry, base), false);
      assert.equal(isStaticEntryPath(`${base}extra${entry}`, entry, base), false);
    }
  }
});

test("logout/resetはpathの符号化表記を同一視し、不正URIや符号化slashは区別する", () => {
  for (const entry of ["/logout", "/reset-for-testing"]) {
    for (const [base, path] of [
      ["/%e4%bd%9c%e5%93%81/", `/作品${entry}/index.html`],
      ["/作品/", `/%e4%bd%9c%e5%93%81${entry}/`],
      ["/%64emo/", `/demo${entry}`],
      ["/demo/", `/%64emo${entry}/index.html`]
    ]) {
      const pathname = new URL(path, "https://static.example").pathname;
      assert.equal(isStaticEntryPath(pathname, entry, normalizeStaticBase(base)), true);
    }
    for (const path of [`/works%2fstory${entry}`, `/works/%73tory%2f${entry.slice(1)}`, `/works/%E0%A4%A${entry}`]) {
      assert.equal(isStaticEntryPath(path, entry, "/works/story/"), false);
    }
  }
});

test("実体入口のindex.htmlが符号化されてもdirectory indexのあるURLへ戻さない", () => {
  assert.equal(appReturnUrl("/logout/%69ndex.html"), "/index.html");
  assert.equal(appReturnUrl("/reset-for-testing/index.html/"), "/index.html");
  assert.equal(appReturnUrl("/logout"), "/");
});
