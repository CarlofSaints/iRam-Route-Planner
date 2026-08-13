/**
 * What a `rep` login is allowed to reach.
 *
 * Reps exist in this app so they can maintain their OWN profile — chiefly the
 * home address the route engine anchors their day on. They do not plan routes,
 * read the dashboard or look at anyone else's numbers, so the gate is an
 * allow-list rather than a set of per-view filters: everything is denied unless
 * it is named here.
 *
 * ⚠️ This deliberately keys off `role === "rep"` and NOT off the permissions
 * matrix. `getRolePermissions()` reads a saved blob and only backfills roles
 * that are MISSING from it, so editing the `rep` defaults in code changes
 * nothing on a deployment that has already saved its roles. A gate that could
 * be switched off by editing the Roles page is not a gate.
 *
 * Shared by the middleware (which enforces it) and the app shell (which decides
 * what to render), so the nav can never offer a link the gate will refuse.
 */

/** Reachable by a rep, matched exactly or as a path segment prefix. */
const REP_ALLOWED = [
  "/account", // their profile — the whole reason they have a login
  "/api/account", // + /avatar, + /rep-profile
  "/api/auth", // session read, sign out, first-login password change
  "/login",
];

/**
 * Path-segment aware so `/accounts-payable` can never be let through by a
 * `/account` entry. Exact match, or the path continues with `/`.
 */
export function isRepAllowedPath(pathname: string): boolean {
  return REP_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
