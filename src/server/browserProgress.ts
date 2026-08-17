import type { PlayerRecord, StoredPlayerState } from "./store.ts";
import { normalizeStoredState } from "./store.ts";

const MAX_TOKEN_LENGTH = 64 * 1024;

export class BrowserProgressTooLargeError extends Error {
  constructor(length: number) {
    super(`browser_progress_too_large:${length}`);
    this.name = "BrowserProgressTooLargeError";
  }
}

type BrowserProgressPayload = {
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

function arrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function gzip(bytes: Uint8Array) {
  const stream = new Blob([arrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array) {
  const stream = new Blob([arrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
  return typeof payload.projectId === "string"
    && payload.projectId.length > 0
    && typeof payload.scenarioRevision === "string"
    && payload.scenarioRevision.length > 0
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
    projectId,
    scenarioRevision,
    playerId: player.id,
    stateVersion: player.stateVersion,
    state: player.state
  };
  const body = base64UrlEncode(await gzip(new TextEncoder().encode(JSON.stringify(payload))));
  const token = `${body}.${base64UrlEncode(await signature(secret, body))}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new BrowserProgressTooLargeError(token.length);
  return token;
}

export async function decodeBrowserProgress(secret: string, projectId: string, token: string): Promise<PlayerRecord | null> {
  if (!secret || !token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  const [body, encodedSignature] = parts;
  if (!body || !encodedSignature || parts.length !== 2) return null;
  try {
    const actual = base64UrlDecode(encodedSignature);
    const expected = await signature(secret, body);
    if (!bytesEqual(actual, expected)) return null;
    const encodedPayload = base64UrlDecode(body);
    const payload = await gunzip(encodedPayload);
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (!validPayload(parsed) || parsed.projectId !== projectId) return null;
    return {
      id: parsed.playerId,
      stateVersion: parsed.stateVersion,
      state: normalizeStoredState(parsed.state)
    };
  } catch {
    return null;
  }
}
