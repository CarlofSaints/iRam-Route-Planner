import crypto from "crypto";

/**
 * Self-service password reset.
 *
 * Until this existed the ONLY way to recover an account was an administrator
 * pressing the envelope button in User Admin, which needs `manage_users` and so
 * in practice means one person. Every forgotten password became their problem,
 * and with rep logins in the field that does not scale.
 *
 * The rules this follows, and why each one is here:
 *
 * - The link carries 32 random bytes from a CSPRNG. A short or guessable
 *   reference is not a credential: a six-character code is a few million
 *   combinations and an attacker with a list of email addresses has all day.
 * - Only a SHA-256 hash of the token is stored. Anyone who can read the blob
 *   still cannot mint a working link, which matters because the blob is read by
 *   more code than writes it.
 * - Tokens are single use and expire in an hour. A reset link sitting in an
 *   inbox forever is a spare key under the mat.
 * - Issuing a new one invalidates that user's earlier ones, so a link the person
 *   already forgot about cannot be used later.
 * - Nothing here ever emails a password. It cannot: passwords are stored as
 *   bcrypt hashes and a hash is one way. The link is what gets sent, and the
 *   person chooses their own password at the end of it.
 */

/** How long a link works for. Long enough to walk to a laptop, short enough to matter. */
export const RESET_TTL_MINUTES = 60;

/** Refuse to mint another link for the same account inside this window. */
export const RESET_THROTTLE_SECONDS = 60;

export interface PasswordResetRecord {
  /** SHA-256 of the token. The token itself is never stored. */
  tokenHash: string;
  userId: string;
  /** Lowercased, for the throttle lookup. */
  email: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

/** 32 bytes, url-safe. This is the whole secret. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function buildResetRecord(userId: string, email: string, token: string, now: Date): PasswordResetRecord {
  return {
    tokenHash: hashResetToken(token),
    userId,
    email: email.toLowerCase().trim(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000).toISOString(),
  };
}

export type ResetLookup =
  | { ok: true; record: PasswordResetRecord }
  | { ok: false; reason: "unknown" | "expired" | "used" };

/**
 * Find the record a token belongs to.
 *
 * The three failure reasons are deliberately distinguished HERE and deliberately
 * NOT distinguished to the caller of the API: the page says one thing for all of
 * them, because "that link has already been used" tells whoever is holding a
 * stolen link something they should not learn. The distinction exists so the
 * server log can say what happened.
 */
export function findResetRecord(
  records: PasswordResetRecord[],
  token: string,
  now: Date
): ResetLookup {
  const hash = hashResetToken(token);
  // Compared by hash, so a timing difference reveals nothing about the token.
  const record = records.find((r) => r.tokenHash === hash);
  if (!record) return { ok: false, reason: "unknown" };
  if (record.usedAt) return { ok: false, reason: "used" };
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, record };
}

/**
 * Drop everything spent or stale, so the blob does not grow without limit.
 * Records are kept for a day past expiry: long enough that "that link has
 * expired" can still be logged accurately, short enough to stay small.
 */
export function pruneResets(records: PasswordResetRecord[], now: Date): PasswordResetRecord[] {
  const cutoff = now.getTime() - 24 * 60 * 60_000;
  return records.filter((r) => new Date(r.expiresAt).getTime() > cutoff);
}

/** True when this account asked for a link so recently that another is refused. */
export function isThrottled(records: PasswordResetRecord[], email: string, now: Date): boolean {
  const target = email.toLowerCase().trim();
  return records.some(
    (r) =>
      r.email === target &&
      !r.usedAt &&
      now.getTime() - new Date(r.createdAt).getTime() < RESET_THROTTLE_SECONDS * 1000
  );
}

/** Retire every unused link this account already has. */
export function invalidateFor(records: PasswordResetRecord[], userId: string, now: Date): PasswordResetRecord[] {
  return records.map((r) =>
    r.userId === userId && !r.usedAt ? { ...r, usedAt: now.toISOString() } : r
  );
}

/** A password the app will accept. Kept in one place so every screen agrees. */
export function passwordProblem(password: string): string | null {
  if (!password || password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That is too long.";
  if (!/[a-zA-Z]/.test(password)) return "Include at least one letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}
