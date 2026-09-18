import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createApp } from "../src/server/app.ts";
import { parseAllowedOrigins } from "../src/server/cors.ts";
import { workerScenario } from "../src/worker/scenario.ts";

const allowedOrigin = "https://client.example.test";
const apiOrigin = "https://api.example.test";

function appWithOrigins(allowedOrigins = allowedOrigin, store = {}, config = {}) {
  return createApp({ store, config: { llm: {}, allowedOrigins, ...config } });
}

function assertAllowed(response, origin = allowedOrigin) {
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.match(response.headers.get("vary") ?? "", /(?:^|,\s*)Origin(?:,|$)/iu);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
}

function assertNotAllowed(response) {
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
}

test("CORS許可originは共通設定境界で解析・正規化・重複排除する", () => {
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(" \n "), []);
  assert.deepEqual(parseAllowedOrigins(
    " https://CLIENT.example.test:443/ ,https://client.example.test,http://localhost:4173,http://127.0.0.1:4174,http://[::1]:4175"
  ), [allowedOrigin, "http://localhost:4173", "http://127.0.0.1:4174", "http://[::1]:4175"]);
  for (const invalid of [
    "*", "null", "http://example.test", "https://client.example.test/game/",
    "https://user:password@client.example.test", "https://client.example.test?x=1",
    "https://client.example.test#fragment", ",", `${allowedOrigin},`, `${allowedOrigin}, ,https://second.example.test`
  ]) {
    assert.throws(() => parseAllowedOrigins(invalid), /ALLOWED_ORIGINS/u, invalid);
    assert.throws(() => appWithOrigins(invalid), /ALLOWED_ORIGINS/u, invalid);
  }
});

test("CORS未設定はOrigin付きリクエストも従来どおりヘッダーとOPTIONSを変えない", async () => {
  const app = appWithOrigins("");
  for (const method of ["GET", "OPTIONS"]) {
    const response = await app.request(`${apiOrigin}/api/health`, {
      method,
      headers: { Origin: allowedOrigin }
    });
    assert.equal(response.status, method === "GET" ? 200 : 404);
    assertNotAllowed(response);
    assert.equal(response.headers.get("vary"), null);
    assert.equal(response.headers.get("access-control-max-age"), null);
  }
});

test("許可originだけに応答を公開しOriginなしの正規リクエストも維持する", async () => {
  const app = appWithOrigins(`${allowedOrigin},https://second.example.test:8443`);
  for (const origin of [allowedOrigin, "https://second.example.test:8443"]) {
    const response = await app.request(`${apiOrigin}/api/health`, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assertAllowed(response, origin);
  }
  for (const origin of [undefined, "null", "https://evil.example.test", `${allowedOrigin}.evil.test`, `${allowedOrigin}:8443`, `${allowedOrigin}/`]) {
    const response = await app.request(`${apiOrigin}/api/health`, {
      headers: origin ? { Origin: origin } : {}
    });
    assert.equal(response.status, 200);
    assertNotAllowed(response);
  }
});

test("preflightは認証とゲーム処理へ進まずGET・POST・OPTIONSと必要ヘッダーだけを宣言する", async () => {
  let storeAccesses = 0;
  const store = new Proxy({}, {
    get() {
      storeAccesses += 1;
      throw new Error("preflightからstoreへアクセスしてはいけません。");
    }
  });
  const app = appWithOrigins(allowedOrigin, store);
  for (const origin of [allowedOrigin, "https://evil.example.test", "null"]) {
    const response = await app.request(`${apiOrigin}/api/session/start`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-not-allowed"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    if (origin === allowedOrigin) assertAllowed(response);
    else assertNotAllowed(response);
    assert.equal(response.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");
    assert.equal(response.headers.get("access-control-allow-headers"), "Authorization,Content-Type");
    assert.equal(response.headers.get("access-control-max-age"), "600");
  }
  assert.equal(storeAccesses, 0);
});

test("認証失敗・競合・拒否・制限・onErrorの応答にも許可originのCORSを付ける", async (context) => {
  const app = appWithOrigins();
  for (const status of [409, 422, 429]) {
    app.post(`/api/cors-status-${status}`, (c) => c.json({ ok: false }, status));
  }
  app.post("/api/cors-error", () => { throw new Error("CORSの500応答確認用です。"); });
  context.mock.method(console, "error", () => {});
  for (const [path, status] of [
    ["player-state", 401], ["cors-status-409", 409], ["cors-status-422", 422],
    ["cors-status-429", 429], ["cors-error", 500], ["cors-missing", 404]
  ]) {
    const response = await app.request(`${apiOrigin}/api/${path}`, {
      method: "POST", headers: { Origin: allowedOrigin, "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(response.status, status);
    assertAllowed(response);
  }
});

test("生成音声の直接ResponseにもCORSを付け静的音声のcache設定を保つ", async () => {
  const originalAudio = workerScenario.generatedAudio;
  workerScenario.generatedAudio = [...originalAudio, { provider: "static", publicId: "cors-audio" }];
  try {
    const response = await appWithOrigins().request(`${apiOrigin}/api/generated-audio/static/cors-audio.wav`, {
      headers: { Origin: allowedOrigin }
    });
    assert.equal(response.status, 200);
    assertAllowed(response);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
    assert.equal((await response.arrayBuffer()).byteLength, 4044);
  } finally {
    workerScenario.generatedAudio = originalAudio;
  }
});

test("browserの進行JSONのno-storeとCORSを同時に維持する", async () => {
  const originalMode = workerScenario.playerMode;
  workerScenario.playerMode = "browser";
  try {
    const response = await appWithOrigins().request(`${apiOrigin}/api/player-state`, {
      method: "POST", headers: { Origin: allowedOrigin, "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(response.status, 401);
    assertAllowed(response);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    workerScenario.playerMode = originalMode;
  }
});

test("監修APIの完全一致と子パスは除外するが似た名前のplayer APIは除外しない", async () => {
  const app = appWithOrigins(allowedOrigin, {}, { appEnv: "production", adminReviewSecret: "review-secret" });
  for (const path of ["/api/admin", "/api/admin/", "/api/admin/talk-branch-review", "/non-api"]) {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await app.request(`${apiOrigin}${path}`, { method, headers: { Origin: allowedOrigin } });
      assertNotAllowed(response);
      assert.equal(response.headers.get("access-control-max-age"), null);
      assert.notEqual(response.status, 204);
    }
  }
  const response = await app.request(`${apiOrigin}/api/administrator`, { headers: { Origin: allowedOrigin } });
  assert.equal(response.status, 404);
  assertAllowed(response);
});

test("外部OriginをlocalhostにしてもAPIホストの認証例外は有効にしない", async () => {
  const originalMode = workerScenario.playerMode;
  workerScenario.playerMode = "server";
  try {
    const app = appWithOrigins("http://localhost:4173", {}, { appEnv: "development" });
    const response = await app.request(`${apiOrigin}/api/session/start`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "Content-Type": "application/json" },
      body: JSON.stringify({ serialCode: "1234" })
    });
    assert.equal(response.status, 400);
    assertAllowed(response, "http://localhost:4173");
    assert.equal((await response.json()).error, "invalid");
  } finally {
    workerScenario.playerMode = originalMode;
  }
});

test("AWSとCloudflareは同じCORS設定を共通AppConfigへ渡しGatewayへ重複設定しない", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const template = source("../infra/aws/template.yaml");
  assert.match(template, /AllowedOrigins:\s+Type: String\s+Default: ""/u);
  assert.match(template, /ALLOWED_ORIGINS: !Ref AllowedOrigins/u);
  assert.doesNotMatch(template, /CorsConfiguration:/u);
  assert.match(source("../src/platform/aws/handler.ts"), /allowedOrigins: process\.env\.ALLOWED_ORIGINS/u);
  assert.match(source("../src/worker/index.ts"), /allowedOrigins: env\.ALLOWED_ORIGINS/u);
  const wrangler = JSON.parse(source("../wrangler.jsonc"));
  for (const environment of ["dev", "stg", "prod"]) {
    assert.equal(wrangler.env[environment].vars.ALLOWED_ORIGINS, "");
    assert.equal(wrangler.env[environment].assets.binding, "ASSETS");
  }
});
