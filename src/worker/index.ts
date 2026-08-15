import { D1Store } from "../platform/cloudflare/d1Store.ts";
import { createApp } from "../server/app.ts";
import type { Bindings } from "./bindings.ts";

let cachedDatabase: D1Database | null = null;
let cachedApp: ReturnType<typeof createApp> | null = null;

export default {
  fetch(request: Request, env: Bindings) {
    if (!cachedApp || cachedDatabase !== env.DB) {
      cachedDatabase = env.DB;
      cachedApp = createApp({
        store: new D1Store(env.DB),
        config: {
          appEnv: env.APP_ENV,
          adminReviewSecret: env.ADMIN_REVIEW_SECRET,
          browserStateSecret: env.BROWSER_STATE_SECRET,
          playerInputLogging: env.PLAYER_INPUT_LOGGING === "true",
          llm: {
            LLM_API_KEY: env.LLM_API_KEY,
            LLM_MODEL: env.LLM_MODEL,
            LLM_BASE_URL: env.LLM_BASE_URL,
            LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS
          }
        }
      });
    }
    return cachedApp.fetch(request);
  }
};
