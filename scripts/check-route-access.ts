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

import { canChangeRoutes, refusedRouteSettings, scopeRouteDoc, visibleRepCodes } from "../lib/routeAccess";
import { mergeBaseForPartialRun, PARTIAL_RUN_REFUSAL } from "../lib/partialRun";
import { guessCycleDay } from "../lib/cycleWeek";
import { canEdit, editRefusal, isTeamRole, type EditArea } from "../lib/roles";
import { ROLE_DEFINITIONS, ALL_PERMISSIONS, type RoutePlanDocument } from "../lib/types";

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

// ── Team Admin reads like a team manager ──
ok("team admin reads their own team only", codes(visibleRepCodes({ role: "teamAdmin", teamId: "t1" }, reps)) === "A1,A2");
ok("team admin with no team reads nobody", codes(visibleRepCodes({ role: "teamAdmin" }, reps)) === "");
ok("team admin may NOT generate or delete routes", !canChangeRoutes({ role: "teamAdmin" }));
ok("isTeamRole: manager", isTeamRole("teamManager"));
ok("isTeamRole: team admin", isTeamRole("teamAdmin"));
ok("isTeamRole: not admin", !isTeamRole("admin"));
ok("isTeamRole: not rep", !isTeamRole("rep"));
ok("isTeamRole: not viewer", !isTeamRole("viewer"));

// ── Who may change what (Carl, 28 Sep) ──
const AREAS: EditArea[] = ["stores", "storeOverrides", "callCycleTypes", "settings", "channels", "teams", "storeUpload", "storeDuplicates"];
const MANAGER_MAY = new Set<EditArea>(["stores", "storeOverrides", "callCycleTypes", "settings"]);
for (const a of AREAS) {
  ok(`superAdmin may change ${a}`, canEdit("superAdmin", a));
  ok(`admin may change ${a}`, canEdit("admin", a));
  ok(`team admin may change ${a}`, canEdit("teamAdmin", a));
  ok(`team manager ${MANAGER_MAY.has(a) ? "may" : "may NOT"} change ${a}`, canEdit("teamManager", a) === MANAGER_MAY.has(a));
  ok(`rep may NOT change ${a}`, !canEdit("rep", a));
  ok(`viewer may NOT change ${a}`, !canEdit("viewer", a));
  ok(`an unknown role may NOT change ${a}`, !canEdit("auditor", a));
  ok(`no role may NOT change ${a}`, !canEdit(undefined, a));
}
ok("the refusal names the area", editRefusal("channels").includes("channels"));
ok("the refusal has no em dash", !editRefusal("teams").includes("—"));

// ── The new role reaches a deployment that already saved its roles ──
// getRolePermissions() only backfills roles MISSING from the saved blob. A
// brand-new role is missing by definition, so it must be in the defaults.
const teamAdminDef = ROLE_DEFINITIONS.find((r) => r.role === "teamAdmin");
ok("Team Admin is in the role defaults, so the backfill adds it", !!teamAdminDef);
ok("every Team Admin permission is a real key", !!teamAdminDef?.permissions.every((k) => ALL_PERMISSIONS.some((p) => p.key === k)));
ok("Team Admin cannot generate routes through the grid either", !teamAdminDef?.permissions.includes("generate_routes"));
ok("Team Admin cannot manage users", !teamAdminDef?.permissions.includes("manage_users"));

// ── Settings that redraw the route book are admin-only ──
// 🔴 A team manager passes refuseEdit("settings"), and that was the only gate
// on the out-of-range radius.
for (const role of ["teamManager", "teamAdmin", "viewer", "rep", "somethingNew"]) {
  ok(`${role} may not move the outlier radius`, refusedRouteSettings({ role } as never, { outlierRadiusKm: 80 }).length === 1);
  ok(`${role} may not move calls per day`, refusedRouteSettings({ role } as never, { callsPerDay: 8 }).length === 1);
  ok(`${role} may still send other settings`, refusedRouteSettings({ role } as never, { homeAddressRemindersEnabled: true }).length === 0);
}
ok("no session may not move the radius", refusedRouteSettings(null, { outlierRadiusKm: 80 }).length === 1);
ok("clearing calls per day (null) still counts as changing it", refusedRouteSettings({ role: "teamManager" } as never, { callsPerDay: null }).length === 1);
for (const role of ["admin", "superAdmin"]) {
  ok(`${role} may change both`, refusedRouteSettings({ role } as never, { outlierRadiusKm: 80, callsPerDay: 8 }).length === 0);
}

// ── A partial run never saves a subset-only book ──
// 🔴 With no per-type file, a subset run wrote just the ticked reps over the
// per-type file AND the `routes` snapshot, deleting every other rep's week.
{
  const plan = (code: string) => ({ repCode: code }) as RoutePlanDocument["repPlans"][number];
  const book = (typeId: string | undefined, codes: string[]) =>
    ({ ...doc, callCycleTypeId: typeId, repPlans: codes.map(plan) }) as RoutePlanDocument;
  const snapshotUntyped = book(undefined, ["A1", "A2", "B1"]);
  const snapshotTypeX = book("x", ["A1", "A2", "B1"]);
  const perTypeX = book("x", ["A1"]);

  const base = (r: ReturnType<typeof mergeBaseForPartialRun>) => ("base" in r ? r.base : null);
  ok("the per-type file wins when it exists", base(mergeBaseForPartialRun("x", perTypeX, snapshotUntyped)) === perTypeX);
  ok("no per-type file: the untyped snapshot is the base (live today)", base(mergeBaseForPartialRun("x", null, snapshotUntyped)) === snapshotUntyped);
  ok("no per-type file: a snapshot of the SAME type is the base", base(mergeBaseForPartialRun("x", null, snapshotTypeX)) === snapshotTypeX);
  ok("no per-type file and a snapshot of ANOTHER type: refused", "refusal" in mergeBaseForPartialRun("y", null, snapshotTypeX));
  ok("nothing saved anywhere: refused", "refusal" in mergeBaseForPartialRun("x", null, null));
  ok("the refusal says what to do", /generate everyone first/i.test(PARTIAL_RUN_REFUSAL));
  ok("no active type: the untyped snapshot is the base", base(mergeBaseForPartialRun(undefined, null, snapshotUntyped)) === snapshotUntyped);
  ok("no active type and a typed snapshot: refused, not relabelled", "refusal" in mergeBaseForPartialRun(undefined, null, snapshotTypeX));
  ok("no active type and nothing saved: refused", "refusal" in mergeBaseForPartialRun(undefined, null, null));
}

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
