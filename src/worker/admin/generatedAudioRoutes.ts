import type { Hono } from "hono";
import type { ServerEnv } from "../../server/store.ts";
import { authorize } from "./authorization.ts";
import { defaultScenarioRuntime } from "../scenario.ts";
import { createGeneratedAudioRuntime } from "../services/generatedAudioRuntime.ts";

export function registerGeneratedAudioRoutes(app: Hono<ServerEnv>) {
  const runtime = createGeneratedAudioRuntime(defaultScenarioRuntime);
  const path = "/api/admin/generated-audio/:playerId/:audioId";
  app.get(path, async c => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const job = await c.var.dependencies.store.generatedAudioJob(c.req.param("playerId"), c.req.param("audioId"));
    c.header("Cache-Control", "no-store");
    return job ? c.json({ ok: true, job }) : c.json({ ok: false, error: "not_found" }, 404);
  });
  app.post(`${path}/retry`, async c => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.expectedJobId !== "string" || !body.expectedJobId || body.confirm !== true)
      return c.json({ ok: false, error: "retry_confirmation_required" }, 400);
    c.header("Cache-Control", "no-store");
    const job = await runtime.retryGeneratedAudio(c.var.dependencies.store, c.req.param("playerId"), c.req.param("audioId"), body.expectedJobId);
    return job ? c.json({ ok: true, job }) : c.json({ ok: false, error: "not_retryable" }, 409);
  });
}
