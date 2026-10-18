import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import { serve } from "@hono/node-server";
import ts from "typescript";
import { createApp } from "../src/server/app.ts";
import { workerScenario } from "../src/worker/scenario.ts";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/platform/aws/server.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function loadEntry(env, listener, appFactory = createApp) {
  const store = {
    async generatedAudioJob() { return null; },
    async playerForSession() { return null; }
  };
  const sandbox = { exports: {}, process: { env: { TABLE_NAME: "fixture", ...env }, once() {} }, require(name) {
    if (name === "@hono/node-server") return { serve: listener };
    if (name === "@aws-sdk/client-dynamodb") return { DynamoDBClient: class { destroy() {} } };
    if (name === "./dynamoStore") return { DynamoStore: class { constructor() { return store; } } };
    if (name === "../../server/app") return { createApp: appFactory };
    throw new Error(`未対応import: ${name}`);
  } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
}

async function startFixture(t, env = {}, appFactory = createApp) {
  let server;
  loadEntry({ AWS_LAMBDA_HTTP_ENDPOINT: "127.0.0.1:3000", ...env }, options => {
    // 本番のlisten指定は別試験で検証し、実通信ではOSへ空きportを割り当ててもらう。
    server = serve({ ...options, port: 0 });
    return server;
  }, appFactory);
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, "listening");
  return (path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method,
      headers: { host: "public.example.test", ...headers } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("AWS listen先は必須で、不正なhost:portを暗黙のlocalhostへ置き換えない", () => {
  for (const address of [undefined, "", "localhost", "http://127.0.0.1:3000", "127.0.0.1:0", "127.0.0.1:65536", "local host:3000", "127.0.0.1:3000/path"]) {
    assert.throws(() => loadEntry({ AWS_LAMBDA_HTTP_ENDPOINT: address }, () => assert.fail("不正設定でlistenしない")), /AWS_LAMBDA_HTTP_ENDPOINT/u);
  }
  for (const [address, hostname, port] of [["127.0.0.1:80", "127.0.0.1", 80], ["[::1]:3000", "::1", 3000]]) {
    loadEntry({ AWS_LAMBDA_HTTP_ENDPOINT: address }, options => {
      assert.equal(options.hostname, hostname);
      assert.equal(options.port, port);
      return {};
    });
  }
});

test("実HTTPでHost・Bearer・JSON・HEAD・CORS・binaryとエラーstatusを保つ", async t => {
  const request = await startFixture(t, { APP_ENV: "prod", ALLOWED_ORIGINS: "https://static.example.test" }, dependencies => {
    const app = createApp(dependencies);
    app.post("/api/fixture", async c => c.json({
      hostname: new URL(c.req.url).hostname,
      authorization: c.req.header("authorization"),
      input: await c.req.json(),
      requestDeadlineMs: dependencies.config.llm.requestDeadlineMs
    }, 422));
    app.get("/api/fixture-binary", () => new Response(new Uint8Array([0, 1, 255]), { headers: { "content-type": "audio/wav" } }));
    app.get("/api/fixture-csv", () => new Response("項目,値\n確認,1\n", { headers: { "content-type": "text/csv; charset=utf-8" } }));
    return app;
  });
  const before = Date.now();
  const posted = await request("/api/fixture", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer fixture" }, body: JSON.stringify({ message: "入力" }) });
  assert.equal(posted.status, 422);
  const payload = JSON.parse(posted.body);
  assert.equal(payload.hostname, "public.example.test");
  assert.equal(payload.authorization, "Bearer fixture");
  assert.deepEqual(payload.input, { message: "入力" });
  assert.ok(payload.requestDeadlineMs >= before + 27_000 && payload.requestDeadlineMs <= Date.now() + 27_000);

  const head = await request("/api/health", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.match(head.headers["content-type"], /application\/json/u);
  const preflight = await request("/api/fixture", { method: "OPTIONS", headers: { origin: "https://static.example.test", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "https://static.example.test");
  const binary = await request("/api/fixture-binary");
  assert.equal(binary.headers["content-type"], "audio/wav");
  assert.deepEqual(binary.body, Buffer.from([0, 1, 255]));
  const html = await request("/api/admin/talk-branch-review");
  assert.equal(html.status, 200);
  assert.match(html.headers["content-type"], /text\/html/u);
  assert.match(html.body.toString(), /<html/u);
  const csv = await request("/api/fixture-csv");
  assert.match(csv.headers["content-type"], /text\/csv/u);
  assert.equal(csv.body.toString(), "項目,値\n確認,1\n");
});

test("loopbackでlistenしても公開Hostをlocal扱いにせず、監修・resetの例外を開けない", async t => {
  const previousMode = workerScenario.playerMode;
  workerScenario.playerMode = "server";
  t.after(() => { workerScenario.playerMode = previousMode; });
  const request = await startFixture(t);
  const review = await request("/api/admin/generated-audio/player/audio", { headers: { "x-forwarded-host": "localhost" } });
  assert.equal(review.status, 503);
  assert.equal(JSON.parse(review.body).error, "admin_unavailable");
  const reset = await request("/api/reset-for-testing", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(reset.status, 404);
  const localReview = await request("/api/admin/generated-audio/player/audio", { headers: { host: "localhost" } });
  assert.equal(localReview.status, 404, "明示したlocal要求だけは既存の開発用認証省略に入る");
  assert.equal(JSON.parse(localReview.body).error, "not_found");
  const localReset = await request("/api/reset-for-testing", { method: "POST", headers: { host: "localhost" } });
  assert.equal(localReset.status, 401, "local要求だけresetの認証判定まで進む");
});

test("設定済み監修secretは実HTTPのBearerで検証し、公開Hostでも省略しない", async t => {
  const request = await startFixture(t, { APP_ENV: "prod", ADMIN_REVIEW_SECRET: "fixture-secret" });
  assert.equal((await request("/api/admin/generated-audio/player/audio")).status, 401);
  const authorized = await request("/api/admin/generated-audio/player/audio", { headers: { authorization: "Bearer fixture-secret" } });
  assert.equal(authorized.status, 404);
  assert.equal(JSON.parse(authorized.body).error, "not_found");
});
