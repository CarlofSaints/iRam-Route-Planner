/**
 * Assertions for who may read and change the route book, and for the rep's
 * week guess on My Route.
 *
 * Run: npx tsx scripts/check-route-access.ts
 *
 * The access cases that matter are the ones that would widen quietly: a role
 * nobody named, and a team manager with a blank teamId matching every rep who
 * also has a blank one.
 */

import { canChangeRoutes, scopeRouteDoc, visibleRepCodes } from "../lib/routeAccess";
import { guessCycleDay } from "../lib/cycleWeek";
import type { RoutePlanDocument } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) passed++;
  else {
    failed++;
    console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const reps = [
  { code: "A1", teamId: "t1" },
  { code: "A2", teamId: "t1" },
  { code: "B1", teamId: "t2" },
  { code: "N1", teamId: "" },
  { code: "N2", teamId: undefined as unknown as string },
];
const doc = {
  id: "d",
  generatedAt: "",
  generatedBy: "",
  config: { useGoogleMaps: false, defaultStartTime: "08:00" },
  repPlans: reps.map((r) => ({ repCode: r.code })),
} as unknown as RoutePlanDocument;
const codes = (s: Set<string> | null) => (s === null ? "ALL" : [...s].sort().join(","));
const planCodes = (d: RoutePlanDocument | null) => (d?.repPlans ?? []).map((p) => p.repCode).sort().join(",");

// ── Changing routes ──
ok("superAdmin may change routes", canChangeRoutes({ role: "superAdmin" }));
ok("admin may change routes", canChangeRoutes({ role: "admin" }));
ok("teamManager may NOT change routes", !canChangeRoutes({ role: "teamManager" }));
ok("viewer may NOT change routes", !canChangeRoutes({ role: "viewer" }));
ok("rep may NOT change routes", !canChangeRoutes({ role: "rep" }));
ok("an unknown role may NOT change routes", !canChangeRoutes({ role: "auditor" as never }));

// ── Reading routes ──
ok("admin reads every rep", codes(visibleRepCodes({ role: "admin" }, reps)) === "ALL");
ok("manager reads their own team only", codes(visibleRepCodes({ role: "teamManager", teamId: "t1" }, reps)) === "A1,A2");
ok(
  "manager with NO team reads nobody, not the no-team reps",
  codes(visibleRepCodes({ role: "teamManager", teamId: "" }, reps)) === "",
  codes(visibleRepCodes({ role: "teamManager", teamId: "" }, reps))
);
ok("manager with undefined team reads nobody", codes(visibleRepCodes({ role: "teamManager" }, reps)) === "");
ok("rep reads only themselves", codes(visibleRepCodes({ role: "rep", repCode: "B1" }, reps)) === "B1");
ok("rep with no code reads nobody", codes(visibleRepCodes({ role: "rep" }, reps)) === "");
// iRam: every Hub user arrives as a viewer, and the role exists to read routes.
ok("viewer reads every rep (iRam)", codes(visibleRepCodes({ role: "viewer" }, reps)) === "ALL");
ok("unknown role reads nobody", codes(visibleRepCodes({ role: "auditor" as never }, reps)) === "");

ok("scoping to ALL returns the document untouched", scopeRouteDoc(doc, null) === doc);
ok("scoping narrows the plans", planCodes(scopeRouteDoc(doc, new Set(["A1", "B1"]))) === "A1,B1");
ok("scoping to nobody leaves no plans", planCodes(scopeRouteDoc(doc, new Set())) === "");
ok("scoping never mutates the saved document", doc.repPlans.length === 5);
ok("no document stays no document", scopeRouteDoc(null, new Set(["A1"])) === null);

// ── Week guess ── (month is 0-based in new Date)
const g = (y: number, m: number, d: number) => guessCycleDay(new Date(y, m - 1, d));
const is = (label: string, got: { week: string; day: string }, week: string, day: string) =>
  ok(label, got.week === week && got.day === day, `${got.week} ${got.day}`);

is("Mon 5 Oct 2026 is week 1", g(2026, 10, 5), "Wk1", "Monday");
is("Fri 9 Oct is still week 1", g(2026, 10, 9), "Wk1", "Friday");
is("Mon 12 Oct is week 2", g(2026, 10, 12), "Wk2", "Monday");
is("Mon 19 Oct is week 3", g(2026, 10, 19), "Wk3", "Monday");
is("Mon 26 Oct is week 4", g(2026, 10, 26), "Wk4", "Monday");
is("Mon 28 Sep 2026 is week 4", g(2026, 9, 28), "Wk4", "Monday");
is("Thu 1 Oct belongs to the week of Mon 28 Sep", g(2026, 10, 1), "Wk4", "Thursday");
is("a fifth Monday (29 Jun 2026) folds into week 4", g(2026, 6, 29), "Wk4", "Monday");
is("Saturday looks ahead to Monday", g(2026, 10, 3), "Wk1", "Monday");
is("Sunday looks ahead to Monday", g(2026, 10, 11), "Wk2", "Monday");
is("Sunday crossing a year", g(2026, 12, 27), "Wk4", "Monday");
is("New Year week starts on the Monday of 28 Dec", g(2027, 1, 1), "Wk4", "Friday");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
