import type { Context } from "hono";
import type { ServerEnv } from "../../server/store.ts";
import { isProductionEnvironment } from "../../server/environment.ts";

export async function authorize(c: Context<ServerEnv>) {
  const expected = c.var.dependencies.config.adminReviewSecret?.trim() ?? "";
  if (!expected) {
    const hostname = new URL(c.req.url).hostname;
    return ["127.0.0.1", "localhost", "::1"].includes(hostname) && !isProductionEnvironment(c.var.dependencies.config.appEnv)
      ? { ok: true as const } : { ok: false as const, status: 503 as const, error: "admin_unavailable" };
  }
  const provided = (c.req.header("authorization")?.replace(/^Bearer\s+/iu, "").trim()
    || c.req.header("x-admin-review-secret")?.trim() || "").slice(0, 4096);
  if (!provided || provided.length !== expected.length) return { ok: false as const, status: 401 as const, error: "unauthorized" };
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`xstoryphone-review:v1:${value}`)));
  const [left, right] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0 ? { ok: true as const } : { ok: false as const, status: 401 as const, error: "unauthorized" };
}
