/**
 * Signed session tokens.
 *
 * The session cookie used to be plain base64(JSON) with httpOnly false — any
 * visitor could type a payload into devtools, or POST one from a script, and
 * be a superAdmin. The production URL is public, so that was remotely
 * exploitable by anyone who found it.
 *
 * Format: `<base64url(payload)>.<base64url(HMAC-SHA256)>`.
 *
 * Built on Web Crypto rather than node:crypto so the SAME verification runs in
 * middleware (edge runtime) and in route handlers. That matters: middleware is
 * the only gate in front of read routes that never call getSession(), so if it
 * only checked that a cookie EXISTED, a forged one would still get through.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlToBytes(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Sign an arbitrary JSON-serialisable payload. */
export async function signToken(payload: unknown, secret: string): Promise<string> {
  const body = bytesToBase64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${bytesToBase64url(new Uint8Array(sig))}`;
}

/**
 * Verify and decode. Returns null for anything malformed or mis-signed —
 * callers must treat null as "not authenticated", never as "empty session".
 */
export async function verifyToken<T>(token: string, secret: string): Promise<T | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      base64urlToBytes(sig),
      encoder.encode(body)
    );
    if (!ok) return null;
    return JSON.parse(decoder.decode(base64urlToBytes(body))) as T;
  } catch {
    // Malformed base64, bad JSON, anything — all mean "not a valid session".
    return null;
  }
}

/**
 * The signing secret. Deliberately throws when unset: falling back to
 * unsigned tokens would silently reinstate the hole this exists to close.
 */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set — sessions cannot be signed or verified."
    );
  }
  return secret;
}
