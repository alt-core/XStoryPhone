export const ACCESS_CODE_ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
export const ACCESS_CODE_MAX_FAILED_ATTEMPTS = 20;

function bytesToCheckDigits(bytes: Uint8Array) {
  const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(value % 10_000).padStart(4, "0");
}

export async function accessCodeCheckDigits(counter: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`access:${counter}`));
  return bytesToCheckDigits(new Uint8Array(signature));
}
