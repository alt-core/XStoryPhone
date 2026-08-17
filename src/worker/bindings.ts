import type { LlmProviderEnv } from "./providers/structuredOutput";

export type Bindings = LlmProviderEnv & {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_REVIEW_SECRET?: string;
  BROWSER_STATE_SECRET?: string;
  ACCESS_CODE_SECRET?: string;
  APP_ENV?: string;
  PLAYER_INPUT_LOGGING?: string;
};
