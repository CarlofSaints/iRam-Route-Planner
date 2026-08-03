import crypto from "crypto";

// Mirrors iRAM-Hub's lib/sso.ts. The Hub signs these tokens; this app only
// ever verifies them, so createSSOToken is deliberately not ported here.
export interface SSOPayload {
  sub: string; // Hub user ID
  email: string;
  name: string;
  surname: string;
  hubRole: "super-admin" | "user";
  modules: string[]; // module slugs the user has access to
  iat: number;
  exp: number;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

/**
 * Verify a Hub-signed SSO token (HMAC-SHA256 JWT).
 * Returns the payload, or null if the token is malformed, mis-signed or expired.
 */
export function verifySSOToken(token: string, secret: string): SSOPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;

  const expected = base64url(
    crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest()
  );

  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(base64urlDecode(body)) as SSOPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
