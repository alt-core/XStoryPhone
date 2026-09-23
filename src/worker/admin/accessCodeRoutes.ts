import type { Hono } from "hono";
import type { ServerEnv } from "../../server/store.ts";
import { authorize } from "./authorization.ts";

export function registerAccessCodeRoutes(app: Hono<ServerEnv>) {
  app.get("/api/admin/access-codes", async c => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const after = c.req.query("after") ?? "";
    const limit = Number(c.req.query("limit") ?? "100");
    if ((after && !/^\d{4}$/u.test(after)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      return c.json({ ok: false, error: "invalid_request" }, 400);
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, ...await c.var.dependencies.store.accessCodes(after, limit) });
  });
  app.post("/api/admin/access-codes/:counter", async c => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const counter = c.req.param("counter");
    const body = await c.req.json().catch(() => null);
    if (!/^\d{4}$/u.test(counter) || typeof body?.disabled !== "boolean") return c.json({ ok: false, error: "invalid_request" }, 400);
    await c.var.dependencies.store.setAccessCodeDisabled(counter, body.disabled, new Date().toISOString());
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true });
  });
}
