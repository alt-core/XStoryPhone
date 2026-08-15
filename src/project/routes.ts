import type { Hono } from "hono";
import type { ServerEnv } from "../server/store.ts";

// 作品固有のAPIは、この関数内で登録する。
export function registerProjectRoutes(_app: Hono<ServerEnv>) {}
