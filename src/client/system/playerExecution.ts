import type { PlayerState } from "./playerApi.ts";

// 通常版はHTTP、完全静的版だけは同じ操作をページ内で実行する。
export type LocalPlayerExecution = {
  initialize(): Promise<void>;
  marker(): string | undefined;
  cachedState(): PlayerState | null;
  prepare(): Promise<string | null>;
  clear(expected?: string | null): Promise<void>;
  delete(): Promise<void>;
  request(path: string, init?: RequestInit): Promise<Response>;
};
