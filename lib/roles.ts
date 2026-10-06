/**
 * Team roles, and who may change what.
 *
 * A Team Admin IS a team manager (their team is resolved the same way, they
 * see the same team-scoped pages) with wider editing rights. Carl, 28 Sep:
 * "Team admin can do all but team manager can only: stores and store
 * overrides, call cycle types, settings."
 *
 * 🔴 Every "is this a manager?" check must go through `isTeamRole`, never
 * `role === "teamManager"`. A check left on the old spelling is a place where a
 * Team Admin silently sees everyone's data, or nobody's.
 *
 * Kept in code, not in the saved permissions matrix, for the reason given in
 * lib/repAccess.ts: the matrix blob only backfills MISSING roles, so a gate
 * that lives there can be switched off by editing the Roles page.
 */

import type { UserRole } from "./types";

export function isTeamRole(role: string | undefined | null): boolean {
  return role === "teamManager" || role === "teamAdmin";
}

export type EditArea =
  | "stores"
  | "storeOverrides"
  | "callCycleTypes"
  | "settings"
  | "channels"
  | "teams"
  | "storeUpload"
  | "storeDuplicates";

export const EDIT_AREA_LABEL: Record<EditArea, string> = {
  stores: "stores",
  storeOverrides: "store overrides",
  callCycleTypes: "call cycle types",
  settings: "settings",
  channels: "channels",
  teams: "teams",
  storeUpload: "store uploads",
  storeDuplicates: "duplicate stores",
};

const TEAM_MANAGER_AREAS: ReadonlySet<EditArea> = new Set([
  "stores",
  "storeOverrides",
  "callCycleTypes",
  "settings",
]);

/** Fails closed: a role nobody named here (viewer, rep, one added later) changes nothing. */
export function canEdit(role: UserRole | string | undefined | null, area: EditArea): boolean {
  if (role === "superAdmin" || role === "admin" || role === "teamAdmin") return true;
  if (role === "teamManager") return TEAM_MANAGER_AREAS.has(area);
  return false;
}

export function editRefusal(area: EditArea): string {
  return `Your role can't change ${EDIT_AREA_LABEL[area]}. Ask an admin or a team admin.`;
}
