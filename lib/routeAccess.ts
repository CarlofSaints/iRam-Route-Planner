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
import { isTeamRole } from "./roles";

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
  if (isTeamRole(session.role)) {
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

/**
 * Settings that redraw the route book, so only someone who may change routes
 * may change them.
 *
 * 🔴 The settings route only asked `refuseEdit("settings")`, which a team
 * manager passes, so a manager could move the outlier radius (which decides
 * which stores are held out of EVERY rep's routing) and, with the grid's
 * generate_routes ticked, the business-wide calls-per-day. Both are the same
 * decision as generating routes, so they take the same admin rule.
 */
export const ROUTE_SETTINGS = ["outlierRadiusKm", "callsPerDay"] as const;

/** The route-shaping settings this body tries to change, if the caller may not. */
export function refusedRouteSettings(
  session: Pick<SessionPayload, "role"> | null,
  body: Record<string, unknown> | null | undefined
): string[] {
  if (session && canChangeRoutes(session)) return [];
  return ROUTE_SETTINGS.filter((k) => body?.[k] !== undefined);
}
