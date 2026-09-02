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
          accessCodeSecret: env.ACCESS_CODE_SECRET,
          playerInputLogging: env.PLAYER_INPUT_LOGGING === "true",
          llmResultRetentionDays: Number(env.LLM_RESULT_RETENTION_DAYS) || 30,
          llm: {
            LLM_API_KEY: env.LLM_API_KEY,
            LLM_MODEL: env.LLM_MODEL,
            LLM_BASE_URL: env.LLM_BASE_URL,
            LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
            LLM_REASONING_EFFORT: env.LLM_REASONING_EFFORT,
            LLM_PROFILE_FAST_MODEL: env.LLM_PROFILE_FAST_MODEL,
            LLM_PROFILE_FAST_REASONING_EFFORT: env.LLM_PROFILE_FAST_REASONING_EFFORT,
            LLM_PROFILE_FAST_TIMEOUT_MS: env.LLM_PROFILE_FAST_TIMEOUT_MS,
            LLM_PROFILE_SUPER_MODEL: env.LLM_PROFILE_SUPER_MODEL,
            LLM_PROFILE_SUPER_REASONING_EFFORT: env.LLM_PROFILE_SUPER_REASONING_EFFORT,
            LLM_PROFILE_SUPER_TIMEOUT_MS: env.LLM_PROFILE_SUPER_TIMEOUT_MS,
            LLM_PROFILE_ULTRA_MODEL: env.LLM_PROFILE_ULTRA_MODEL,
            LLM_PROFILE_ULTRA_REASONING_EFFORT: env.LLM_PROFILE_ULTRA_REASONING_EFFORT,
            LLM_PROFILE_ULTRA_TIMEOUT_MS: env.LLM_PROFILE_ULTRA_TIMEOUT_MS,
            LLM_ANALYTICS_ENABLED: env.LLM_ANALYTICS_ENABLED,
            LLM_DEBUG_LOGS: env.LLM_DEBUG_LOGS
          }
        }
      });
    }
    return cachedApp.fetch(request);
  }
};
