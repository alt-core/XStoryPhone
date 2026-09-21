import { normalizeAnswer } from "./talkCriteria.ts";

export type { StaticAnswerIndex } from "./scenario.ts";
export class StaticResourceError extends Error {
  constructor(message: string) { super(message); this.name = "StaticResourceError"; }
}
export type StaticAnswerSettings = { salt: string; iterations: number };
export const STATIC_ANSWER_PREFIX_LENGTH = 16;
export const STATIC_ANSWER_ITERATIONS = 100_000;

// 同じ入力の重い処理だけを操作内で共有し、入口ごとに用途を分ける。
export function createAnswerDeriver(settings: StaticAnswerSettings) {
  const memo = new Map<string, Promise<ArrayBuffer>>();
  return async (input: string, entryId: string, fixedPin = false) => {
    const value = fixedPin ? input : normalizeAnswer(input);
    let base = memo.get(value);
    if (!base) {
      base = (async () => {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
        return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(settings.salt), iterations: settings.iterations }, key, 256);
      })();
      memo.set(value, base);
    }
    const domain = new TextEncoder().encode(`xstoryphone-answer:${entryId}\0`);
    const bytes = new Uint8Array(domain.length + 32);
    bytes.set(domain); bytes.set(new Uint8Array(await base), domain.length);
    const result = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  };
}
