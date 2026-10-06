/**
 * Assertions for the team leader / team filter.
 *
 * Run: npx tsx scripts/check-team-filter.ts
 *
 * Three pages narrow by team through this one rule, so a mistake here is a
 * mistake on all three at once. The cases that matter are the ones where a
 * filter quietly shows the WRONG set rather than an empty one: a leader and a
 * team that contradict each other, and the 48 reps in no team, who are
 * invisible to every option unless one is kept for them.
 */

import {
  EMPTY_SELECTION,
  NO_TEAM,
  filterRepsByTeam,
  isActive,
  matchesTeam,
  teamCounts,
  teamLeaderOptions,
  teamsForLeader,
  withLeader,
  withTeam,
} from "../lib/teamFilter";
import type { Team } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function team(id: string, name: string, managerName: string, managerEmail: string): Team {
  return { id, name, managerName, managerEmail } as Team;
}

// Two teams under ONE leader, one under another, and one with no manager email
// at all — the shape the data will take once teams come from IMS.
const teams = [
  team("t1", "INLAND 1", "Manro Do Espirito Santo", "manro@example.com"),
  team("t2", "INLAND 2", "Manro Do Espirito Santo", "MANRO@example.com "),
  team("t3", "Pretoria", "Alec Papavarnavas", "alec@example.com"),
  team("t4", "Coastal", "", ""),
];

const reps = [
  { code: "A", teamId: "t1" },
  { code: "B", teamId: "t2" },
  { code: "C", teamId: "t3" },
  { code: "D", teamId: "" },
  { code: "E", teamId: undefined },
  { code: "F", teamId: "deleted-team" },
];

// ── Leaders ───────────────────────────────────────────────────────────────
{
  const leaders = teamLeaderOptions(teams);
  ok("one entry per leader, not per team", leaders.length === 3, String(leaders.length));

  const manro = leaders.find((l) => l.name.startsWith("Manro"))!;
  // 🔴 Case and a trailing space on a manager email are the difference between
  // one leader and two. The app already treats that address as a key.
  ok("the same manager under two spellings collapses to ONE leader", manro.teamIds.length === 2, manro.teamIds.join(","));
  ok("a team with no manager email still appears as its own leader", leaders.some((l) => l.teamIds[0] === "t4"));
  ok("a leader with no name is labelled, not blank", leaders.every((l) => l.name.trim().length > 0));
}

// ── The team options follow the leader ────────────────────────────────────
{
  ok("no leader chosen offers every team", teamsForLeader(teams, "").length === 4);
  ok("Manro offers exactly his two", teamsForLeader(teams, "manro@example.com").map((t) => t.id).join(",") === "t1,t2");
  ok("Alec offers exactly his one", teamsForLeader(teams, "alec@example.com").map((t) => t.id).join(",") === "t3");
}

// ── The pair stays coherent ───────────────────────────────────────────────
{
  // Picking a team fills in its leader, so the two selects never contradict.
  const afterTeam = withTeam(teams, EMPTY_SELECTION, "t3");
  ok("choosing a team fills in its leader", afterTeam.leaderId === "alec@example.com" && afterTeam.teamId === "t3");

  // 🔴 The contradiction to prevent: Alec + INLAND 1 matches nobody, and the
  // page would go empty with both controls looking perfectly reasonable.
  const moved = withLeader(teams, { leaderId: "alec@example.com", teamId: "t3" }, "manro@example.com");
  ok("switching leader drops a team that is no longer theirs", moved.teamId === "", moved.teamId);
  ok("but keeps a team that IS theirs", withLeader(teams, { leaderId: "", teamId: "t1" }, "manro@example.com").teamId === "t1");

  ok("clearing the leader clears the team", withLeader(teams, { leaderId: "alec@example.com", teamId: "t3" }, "").teamId === "");

  // "No team" belongs to no leader, so it clears one rather than fighting it.
  const none = withTeam(teams, { leaderId: "alec@example.com", teamId: "t3" }, NO_TEAM);
  ok("choosing No team clears the leader", none.leaderId === "" && none.teamId === NO_TEAM);
  ok("and clearing the leader does NOT discard No team", withLeader(teams, none, "").teamId === NO_TEAM);
}

// ── Matching ──────────────────────────────────────────────────────────────
{
  const codes = (sel: Parameters<typeof filterRepsByTeam>[1]) =>
    filterRepsByTeam(teams, sel, reps).map((r) => r.code).join(",");

  ok("nothing chosen matches everyone", codes(EMPTY_SELECTION) === "A,B,C,D,E,F");
  ok("a leader matches every rep across their teams", codes({ leaderId: "manro@example.com", teamId: "" }) === "A,B");
  ok("a team matches only that team", codes({ leaderId: "manro@example.com", teamId: "t2" }) === "B");

  // 🔴 48 of 64 reps really are in no team. Without this option a team filter
  // hides three quarters of the book and looks like the data is missing.
  ok("No team reaches the unassigned", codes({ leaderId: "", teamId: NO_TEAM }) === "D,E,F");
  ok(
    "a rep pointing at a DELETED team counts as unassigned, not as nobody",
    matchesTeam(teams, { leaderId: "", teamId: NO_TEAM }, "deleted-team")
  );
  ok(
    "and such a rep is not claimed by a real team",
    !matchesTeam(teams, { leaderId: "", teamId: "t1" }, "deleted-team")
  );

  ok("isActive is false only for an untouched filter", !isActive(EMPTY_SELECTION) &&
    isActive({ leaderId: "", teamId: NO_TEAM }) && isActive({ leaderId: "alec@example.com", teamId: "" }));
}

// ── Counts shown on the control ───────────────────────────────────────────
{
  const c = teamCounts(teams, reps);
  ok("each team counts its own reps", c.byTeam.get("t1") === 1 && c.byTeam.get("t3") === 1);
  ok("a team with no reps is absent, not wrong", c.byTeam.get("t4") === undefined);
  ok("the unassigned count includes blank, missing AND stranded", c.noTeam === 3, String(c.noTeam));
  ok(
    "every rep is counted exactly once",
    [...c.byTeam.values()].reduce((s, n) => s + n, 0) + c.noTeam === reps.length
  );
}

// ── Nothing configured ────────────────────────────────────────────────────
{
  ok("no teams at all: every rep is unassigned", teamCounts([], reps).noTeam === reps.length);
  ok("no teams at all: nothing to choose", teamLeaderOptions([]).length === 0);
  ok("no teams at all: an untouched filter still shows everyone", filterRepsByTeam([], EMPTY_SELECTION, reps).length === reps.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
