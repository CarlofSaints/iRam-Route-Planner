import { SessionPayload, Team } from "./types";
import { getReps, getTeams, getUsers } from "./data";

/**
 * An email address reduced to the thing worth comparing.
 *
 * Ported from Clippa, where a team manager was saved on 3 Sep 2026 as
 * `"ALEC@CLIPPASALES.COM "`, typed with a trailing space and stored verbatim.
 * Every place that matched a manager to their login compared the raw value, so
 * that manager's `teamId` would silently never have resolved at sign-in. iRam
 * had the same five raw comparisons; the home-address reminder now makes the
 * manager email load-bearing here too.
 */
export function normaliseEmail(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase();
}

/**
 * The team this person manages, if any.
 *
 * Exists so every caller shares ONE comparison instead of a copy each, which is
 * exactly the shape where a fix lands in some of them and not the rest.
 */
export function findTeamForManager(teams: Team[], email: string | undefined | null): Team | undefined {
  const wanted = normaliseEmail(email);
  if (!wanted) return undefined;
  return teams.find((t) => normaliseEmail(t.managerEmail) === wanted);
}

export interface ManagerInfo {
  name: string;
  email: string;
  cell: string;
  title: string;
}

export async function resolveManager(
  session: SessionPayload
): Promise<ManagerInfo | null> {
  if (session.role === "rep") {
    // Rep → their team manager
    const reps = await getReps();
    const wanted = normaliseEmail(session.email);
    const rep = wanted ? reps.find((r) => normaliseEmail(r.email) === wanted) : undefined;
    if (!rep?.teamId) return null;
    const teams = await getTeams();
    const team = teams.find((t) => t.id === rep.teamId);
    if (!team) return null;
    return {
      name: team.managerName,
      email: team.managerEmail,
      cell: team.managerCell,
      title: "Team Manager",
    };
  }

  if (session.role === "teamManager") {
    // Team manager → the superAdmin user (National Manager)
    const users = await getUsers();
    const superAdmin = users.find((u) => u.role === "superAdmin");
    if (!superAdmin) return null;
    return {
      name: superAdmin.name,
      email: superAdmin.email,
      cell: superAdmin.cell || "",
      title: "National Manager",
    };
  }

  // Admin / SuperAdmin / Viewer → no manager
  return null;
}
