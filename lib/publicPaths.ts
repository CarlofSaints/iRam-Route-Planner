/**
 * The only routes reachable without a session.
 *
 * Lives here rather than inside middleware.ts so that a test can assert against
 * the REAL list instead of a copy of it. A copy is worth nothing: it passes
 * happily while the thing it is supposed to describe drifts away from it.
 *
 * ⚠️ MATCHED EXACTLY, NEVER BY PREFIX. This was once `startsWith`, which made
 * every child of "/api/auth" public too, including /api/auth/change-password, a
 * route that took a userId from the request body, set that user's password and
 * handed back a signed session cookie. One word, total compromise. If you add an
 * entry here, add the one route that is public, not the folder it lives in.
 *
 * /sso/callback is public by necessity: it is the route that CREATES the
 * session, so it cannot require one. It authenticates on the Hub-signed token.
 *
 * The password reset pair is public for the same kind of reason: the person who
 * needs them is the person who cannot sign in. Each protects itself instead.
 * /api/auth/forgot-password answers identically whether or not an address has an
 * account, and /api/auth/reset-password requires 32 random bytes that were
 * emailed to the account holder.
 */
export const PUBLIC_EXACT = [
  "/login",
  "/api/auth",
  "/sso/callback",
  "/forgot-password",
  "/reset-password",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
] as const;

export function isPublicPath(pathname: string): boolean {
  return (PUBLIC_EXACT as readonly string[]).includes(pathname);
}

/**
 * Prefix-matched, and deliberately separate from the list above so the two
 * rules can never be confused for one another. Vercel's scheduler hits several
 * routes under /api/cron with no session cookie; each verifies CRON_SECRET
 * itself, so this is a second gate rather than the only one.
 */
export const PUBLIC_PREFIXES = ["/api/cron"] as const;

export function isPublicPrefix(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
