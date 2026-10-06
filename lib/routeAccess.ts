/**
 * Who may read and who may change the route book.
 *
 * 🔴 Before this, /api/routes PUT and DELETE asked for nothing but a session,
 * so any signed-in login could overwrite the plan or wipe it, and GET handed
 * every rep's week to a team manager. The pages hid the buttons; hiding a
 * control is not a permission.
 *
 * - CHANGE (generate, save, delete, build the Perigee file): admin/superAdmin only.
 * - READ: admins and viewers see everyone, a team manager sees their own team,
 *   a rep sees themselves, and any other role, including one added later, sees
 *   nobody. Failing closed, because defaulting to "everything" is how a new
 *   role silently gets the whole book.
 *
 * iRam difference from Clippa: a VIEWER still reads the whole book. Every
 * iRam Hub user who is not a Hub super-admin is created here as a viewer on
 * their first SSO sign-in, and the role exists to read routes and reports. In
 * Clippa a viewer sees nobody.
 */

import type { Rep, RoutePlanDocument, SessionPayload } from "./types";

export function canChangeRoutes(session: Pick<SessionPayload, "role">): boolean {
  return session.role === "admin" || session.role === "superAdmin";
}

/** null = every rep. Otherwise the rep codes this session may see (possibly none). */
export function visibleRepCodes(
  session: Pick<SessionPayload, "role" | "repCode" | "teamId">,
  reps: Pick<Rep, "code" | "teamId">[]
): Set<string> | null {
  if (canChangeRoutes(session)) return null;
  if (session.role === "viewer") return null;
  if (session.role === "rep") return new Set(session.repCode ? [session.repCode] : []);
  if (session.role === "teamManager") {
    // A manager with no team resolved sees nobody, never everybody: a blank
    // teamId must not match every rep who also has a blank one.
    if (!session.teamId) return new Set();
    return new Set(reps.filter((r) => r.teamId && r.teamId === session.teamId).map((r) => r.code));
  }
  return new Set();
}

export function scopeRouteDoc(
  doc: RoutePlanDocument | null,
  allowed: Set<string> | null
): RoutePlanDocument | null {
  if (!doc || allowed === null) return doc;
  return { ...doc, repPlans: doc.repPlans.filter((p) => allowed.has(p.repCode)) };
}
