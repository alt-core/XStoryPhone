import type { PlayerRecord, StoredPlayerState } from "./store.ts";
import { normalizeStoredPlayerState } from "./store.ts";

const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 8 * 1024;

export class BrowserProgressTooLargeError extends Error {
  constructor(length: number) {
    super(`browser_progress_too_large:${length}`);
    this.name = "BrowserProgressTooLargeError";
  }
}

type BrowserProgressPayload = {
  version: typeof TOKEN_VERSION;
  projectId: string;
  scenarioRevision: string;
  playerId: string;
  stateVersion: number;
  state: StoredPlayerState;
};

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signature(secret: string, body: string) {
  const signed = await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(body));
  return new Uint8Array(signed);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validPayload(value: unknown): value is BrowserProgressPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<BrowserProgressPayload>;
  return payload.version === TOKEN_VERSION
    && typeof payload.scenarioRevision === "string"
    && typeof payload.projectId === "string"
    && payload.projectId.length > 0
    && typeof payload.playerId === "string"
    && payload.playerId.length > 0
    && typeof payload.stateVersion === "number"
    && Number.isInteger(payload.stateVersion)
    && payload.stateVersion >= 0
    && Boolean(payload.state && typeof payload.state === "object" && !Array.isArray(payload.state));
}

export async function encodeBrowserProgress(secret: string, projectId: string, scenarioRevision: string, player: PlayerRecord) {
  if (!secret) throw new Error("BROWSER_STATE_SECRETが設定されていません。");
  const payload: BrowserProgressPayload = {
    version: TOKEN_VERSION,
    projectId,
    scenarioRevision,
    playerId: player.id,
    stateVersion: player.stateVersion,
    state: player.state
  };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const token = `${body}.${base64UrlEncode(await signature(secret, body))}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new BrowserProgressTooLargeError(token.length);
  return token;
}

export async function decodeBrowserProgress(secret: string, projectId: string, token: string): Promise<PlayerRecord | null> {
  if (!secret || !token || token.length > MAX_TOKEN_LENGTH) return null;
  const [body, encodedSignature, ...rest] = token.split(".");
  if (!body || !encodedSignature || rest.length) return null;
  try {
    const actual = base64UrlDecode(encodedSignature);
    const expected = await signature(secret, body);
    if (!bytesEqual(actual, expected)) return null;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as unknown;
    if (!validPayload(parsed) || parsed.projectId !== projectId) return null;
    const normalized = normalizeStoredPlayerState(parsed.state);
    return {
      id: parsed.playerId,
      stateVersion: parsed.stateVersion,
      state: normalized.state,
      ...(normalized.legacyTranscripts.length ? { legacyTranscripts: normalized.legacyTranscripts } : {})
    };
  } catch {
    return null;
  }
}
