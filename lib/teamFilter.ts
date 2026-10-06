/**
 * Narrowing a page to a team leader and a team.
 *
 * Two selects rather than one, and linked: picking a leader narrows the teams
 * on offer, and picking a team fills in its leader. Today every leader owns
 * exactly one team, so the pair moves together and the second select looks
 * redundant. It is not, for two reasons: a leader owning several teams is
 * entirely plausible as iRam grows past its 21 teams, and the two questions
 * ("show me Alec's reps" / "show me Pretoria") are asked with different words
 * by different people even when they currently have the same answer.
 *
 * 🔴 The option that has to exist: NO TEAM. In Clippa 48 of 64 reps were in no
 * team, and iRam has reps waiting on the Teams page too, so any team filter
 * hides them unless it can be asked for them. Without a way to ask
 * for the unassigned, a manager narrowing the page would conclude those reps
 * had vanished — and "who is not in a team yet" is exactly the question the
 * team list is there to answer. 
 */

import type { Team } from "./types";

/** The sentinel team id meaning "reps who belong to no team". */
export const NO_TEAM = "__none__";

export interface TeamSelection {
  /** A team's manager, by the team ids they own. "" means every leader. */
  leaderId: string;
  /** A team id, NO_TEAM, or "" for every team the leader covers. */
  teamId: string;
}

export const EMPTY_SELECTION: TeamSelection = { leaderId: "", teamId: "" };

/**
 * Leaders, one entry per distinct manager.
 *
 * Keyed on the manager's EMAIL where there is one, because that is the field
 * the app already treats as a manager's identity — two teams under the same
 * person must collapse to one leader, and two people who happen to share a
 * display name must not. A team with no manager email falls back to its own id
 * so it still appears rather than being swallowed into a shared blank key.
 * 
 */
export interface TeamLeaderOption {
  id: string;
  name: string;
  teamIds: string[];
  teamNames: string[];
}

function leaderKey(team: Team): string {
  const email = (team.managerEmail ?? "").trim().toLowerCase();
  return email || `team:${team.id}`;
}

export function teamLeaderOptions(teams: Team[]): TeamLeaderOption[] {
  const byKey = new Map<string, TeamLeaderOption>();
  for (const t of teams) {
    const key = leaderKey(t);
    const existing = byKey.get(key);
    if (existing) {
      existing.teamIds.push(t.id);
      existing.teamNames.push(t.name || "Unnamed team");
    } else {
      byKey.set(key, {
        id: key,
        name: (t.managerName || "").trim() || "No leader named",
        teamIds: [t.id],
        teamNames: [t.name || "Unnamed team"],
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The teams a given leader covers — what the team select may offer.
 *
 * ⚠️ The options MUST follow the leader select. A team list that keeps showing
 * every team after a leader is chosen lets you pick a combination that matches
 * nobody, and the page then goes empty with both controls looking reasonable.
 * 
 */
export function teamsForLeader(teams: Team[], leaderId: string): Team[] {
  if (!leaderId) return teams;
  return teams.filter((t) => leaderKey(t) === leaderId);
}

/**
 * Keep a selection coherent after either select changes.
 *
 * Changing the leader drops a team that is no longer theirs; choosing a team
 * fills in the leader it belongs to. Returned as a whole selection rather than
 * mutating, so a caller cannot apply half of it.
 */
export function withLeader(teams: Team[], sel: TeamSelection, leaderId: string): TeamSelection {
  if (!leaderId) return { leaderId: "", teamId: sel.teamId === NO_TEAM ? NO_TEAM : "" };
  const allowed = new Set(teamsForLeader(teams, leaderId).map((t) => t.id));
  return { leaderId, teamId: allowed.has(sel.teamId) ? sel.teamId : "" };
}

export function withTeam(teams: Team[], sel: TeamSelection, teamId: string): TeamSelection {
  if (!teamId) return { leaderId: sel.leaderId, teamId: "" };
  // "No team" is nobody's team, so it clears the leader rather than
  // contradicting it — the alternative is a pair that can never match.
  if (teamId === NO_TEAM) return { leaderId: "", teamId: NO_TEAM };
  const team = teams.find((t) => t.id === teamId);
  return { leaderId: team ? leaderKey(team) : sel.leaderId, teamId };
}

/** Is a selection actually narrowing anything? */
export function isActive(sel: TeamSelection): boolean {
  return !!sel.leaderId || !!sel.teamId;
}

/**
 * Does a rep fall inside the selection?
 *
 * Takes the rep's team id rather than a Rep, because the capacity page holds
 * rows of its own shape that carry the same field. One rule, three pages.
 */
export function matchesTeam(teams: Team[], sel: TeamSelection, teamId: string | undefined): boolean {
  const id = (teamId ?? "").trim();

  if (sel.teamId === NO_TEAM) {
    // Unassigned means no team id, OR an id pointing at a team that no longer
    // exists — a rep stranded by a deleted team is unassigned in every way that
    // matters, and hiding them from both answers is how they stay lost.
    return !id || !teams.some((t) => t.id === id);
  }
  if (sel.teamId) return id === sel.teamId;
  if (sel.leaderId) return teamsForLeader(teams, sel.leaderId).some((t) => t.id === id);
  return true;
}

/** The same question for a list of reps. */
export function filterRepsByTeam<T extends { teamId?: string }>(
  teams: Team[],
  sel: TeamSelection,
  reps: T[]
): T[] {
  if (!isActive(sel)) return reps;
  return reps.filter((r) => matchesTeam(teams, sel, r.teamId));
}

/** How many reps sit under each option, so a filter can say before it is used. */
export function teamCounts(teams: Team[], reps: { teamId?: string }[]) {
  const known = new Set(teams.map((t) => t.id));
  const byTeam = new Map<string, number>();
  let noTeam = 0;
  for (const r of reps) {
    const id = (r.teamId ?? "").trim();
    if (!id || !known.has(id)) noTeam++;
    else byTeam.set(id, (byTeam.get(id) ?? 0) + 1);
  }
  return { byTeam, noTeam };
}
