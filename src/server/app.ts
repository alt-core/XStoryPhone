import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { workerScenario } from "../generated/workerScenario.generated.ts";
import { scenarioHookHandlers } from "../generated/scenarioHooks.generated.ts";
import { defaultScenarioRuntime } from "../worker/scenario.ts";
import { runScenarioHooks } from "../worker/services/scenarioHooks.ts";
import { createPartSession } from "../worker/partSession.ts";
import { createGeneratedAudioRuntime } from "../worker/services/generatedAudioRuntime.ts";
import { registerTalkBranchReviewRoutes } from "../worker/admin/talkBranchReviewRoutes.ts";
import { registerProjectRoutes } from "../project/routes.ts";
import { createPlayerOperations } from "./playerApp.ts";
import { parseAllowedOrigins } from "./cors.ts";
import { APP_VERSION } from "../shared/version.ts";
import { staticAudioSample } from "../shared/staticAudio.ts";
import type { AppDependencies, ServerEnv } from "./store.ts";

export function createApp(dependencies: AppDependencies) {
  // await中にも別プレイヤーの取得済partが混ざらない、request専用の定義参照。
  const outer = new Hono<ServerEnv>();
  const allowedOrigins = parseAllowedOrigins(dependencies.config.allowedOrigins);
  if (allowedOrigins.length) {
    const playerCors = cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      credentials: false,
      maxAge: 600
    });
    outer.use("/api/*", (c, next) => c.req.path === "/api/admin" || c.req.path.startsWith("/api/admin/")
      ? next() : playerCors(c, next));
  }
  outer.use("*", async (c, next) => {
    c.set("dependencies", dependencies);
    await next();
    if (workerScenario.playerMode !== "server" && c.req.path.startsWith("/api/")
      && c.req.path !== "/api/admin" && !c.req.path.startsWith("/api/admin/")
      && c.res.headers.get("content-type")?.startsWith("application/json")) {
      c.header("Cache-Control", "no-store");
    }
  });
  outer.onError((error, c) => {
    console.error("[worker]", error);
    return c.json({ ok: false, error: "server_error" }, 500);
  });
  outer.get("/api/health", c => c.json({ ok: true, version: APP_VERSION, clientRevision: workerScenario.clientRevision }));
  outer.get("/api/generated-audio/static/:filename", c => {
    const audio = workerScenario.generatedAudio.find(item => item.provider === "static" && `${item.publicId}.wav` === c.req.param("filename"));
    if (!audio) return c.json({ ok: false, error: "not_found" }, 404);
    return new Response(staticAudioSample(), { headers: { "content-type": "audio/wav", "cache-control": "public, max-age=3600" } });
  });
  const shared = createPlayerOperations(defaultScenarioRuntime, { runScenarioHooks }, undefined);
  // 同じ操作をHTTPとstaticの双方から呼ぶ。HTTP routerを内部で再dispatchしない。
  for (const key of shared.keys) {
    const [method, path] = key.split(" ");
    outer.on(method, path, async c => {
      const parts = createPartSession(workerScenario, scenarioHookHandlers);
      const operations = createPlayerOperations(parts.runtime, parts.hooks, createGeneratedAudioRuntime(parts.runtime), undefined, parts);
      const result = await operations.execute(key, {
        hostname: new URL(c.req.url).hostname,
        authorization: c.req.header("authorization"),
        body: await c.req.json().catch(() => null),
        params: c.req.param(), query: c.req.query()
      }, dependencies);
      return c.json(result.payload, result.status as ContentfulStatusCode);
    });
  }
  registerTalkBranchReviewRoutes(outer);
  registerProjectRoutes(outer);
  return outer;
}
