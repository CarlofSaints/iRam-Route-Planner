/**
 * Assertions for the "Not in a cycle" working list and the Stores page filter
 * that share it.
 *
 * Run: npx tsx scripts/check-not-in-cycle-grid.ts
 *
 * Ported from Clippa without the sales and rank sections (iRam has no sales
 * data). What remains is the part that loses rows silently: the open/closed
 * split, the team filter's "No team" case, the reason filter adding up, and
 * role scoping staying separate from the filters.
 */

import { findNotInCycle, filterNotInCycle, REASONS, type NotInCycleReason } from "../lib/notInCycle";
import { NO_TEAM, type TeamSelection } from "../lib/teamFilter";
import { isClosed } from "../lib/closedStores";
import type { Channel, Rep, RoutePlanDocument, RouteDayPlan, Store, Team } from "../lib/types";
import { DEFAULT_VISIT_ROLES } from "../lib/types";

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  - ${detail}` : ""}`);
  }
}

const store = (id: string, o: Partial<Store> = {}): Store => ({
  id, placeId: id, name: `Store ${id}`, channelId: "spar", repCode: "R1", gpsLat: "-26.1", gpsLng: "28.0",
  monthlySales: 0, frequency: "monthly", duration: 30, dayOfWeek: "", weekNumber: "", ...o,
});
const rep = (code: string, teamId = ""): Rep => ({
  id: code, code, name: `Rep ${code}`, email: "", cell: "", homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId,
});
const day = (ids: string[]): RouteDayPlan => ({
  day: "Monday", week: "Wk1",
  stops: ids.map((id, i) => ({ storeId: id, storeName: id, lat: -26, lng: 28, visitDuration: 30, travelTimeFromPrev: 0, distanceFromPrev: 0, arrivalTime: "08:00", departureTime: "08:30", sequence: i + 1 })),
  totalTravelTime: 0, totalVisitTime: 30, totalTime: 30, totalDistance: 0, overCapacity: false,
});
const routes = {
  id: "d", generatedAt: "", generatedBy: "", config: { useGoogleMaps: false, defaultStartTime: "08:00" },
  repPlans: [
    { repCode: "R1", repName: "R1", homeLatLng: null, workingHoursPerDay: 8.5, generatedAt: "", days: [day(["visited"])], stats: { totalStores: 0, unassignedStores: [{ storeId: "busy", storeName: "busy", reason: "Over daily capacity" }] } },
  ],
} as RoutePlanDocument;

const channels: Channel[] = [
  { id: "spar", name: "SPAR", frequency: "monthly", duration: 30 },
  { id: "makro", name: "Makro", frequency: "monthly", duration: 30, notARepChannel: true },
];
const teams: Team[] = [
  { id: "pta", name: "Pretoria", managerId: "", managerName: "Lead A", managerEmail: "a@example.com", managerCell: "", area: "" },
  { id: "cpt", name: "Cape Town", managerId: "", managerName: "Lead B", managerEmail: "b@example.com", managerCell: "", area: "" },
];
const reps = [rep("R1", "pta"), rep("R2", "cpt"), rep("R3")];
const stores = [
  store("visited"),
  store("busy"),
  store("nogps", { gpsLat: "", gpsLng: "" }),
  store("shut", { closed: true, closedReason: "manual" }),
  store("makro", { channelId: "makro" }),
  store("capetown", { repCode: "R2" }),
  store("teamless", { repCode: "R3" }),
  store("orphan", { repCode: "GONE" }),
];
const result = findNotInCycle({ stores, channels, overrides: [], routes, reps, visitRoles: DEFAULT_VISIT_ROLES });

// ── What lands on the list ────────────────────────────────────────────────
{
  const rows = filterNotInCycle(result, reps, {});
  ok("a visited store is not on the list", !rows.some((r) => r.store.id === "visited"));
  ok("every other store is", rows.length === stores.length - 1, String(rows.length));
  ok("the numbers reconcile", result.scheduled + rows.length === result.totalStores);
  ok("a rep code that names nobody is its own reason", result.reasonOf.get("orphan") === "no_rep");
}

// ── Open / closed must not lose a row ─────────────────────────────────────
{
  const all = filterNotInCycle(result, reps, { status: "all" });
  const open = filterNotInCycle(result, reps, { status: "open" });
  const closed = filterNotInCycle(result, reps, { status: "closed" });
  ok("open + closed accounts for every row", open.length + closed.length === all.length);
  ok("the closed store is in the closed bucket only",
    closed.some((r) => r.store.id === "shut") && !open.some((r) => r.store.id === "shut"));
  ok("the closed bucket holds only closed stores", closed.every((r) => isClosed(r.store)));
}

// ── Actionable only: what the Stores page "unrouted" link shows ───────────
{
  const actionable = filterNotInCycle(result, reps, { actionableOnly: true, repCode: "R1" });
  const ids = actionable.map((r) => r.store.id).sort();
  ok("the unrouted view leaves out closed and not-called-on stores",
    !ids.includes("shut") && !ids.includes("makro"), ids.join(","));
  ok("and keeps the rep's real gaps", ids.join(",") === "busy,nogps", ids.join(","));
}

// ── Team filtering, and the store whose rep has no team ───────────────────
{
  const sel = (teamId: string): TeamSelection => ({ leaderId: "", teamId });
  const pta = filterNotInCycle(result, reps, { teams, teamSel: sel("pta"), status: "all" }).map((r) => r.store.id);
  ok("a Pretoria rep's store passes the Pretoria filter", pta.includes("busy"));
  ok("a Cape Town store does not", !pta.includes("capetown"));
  const none = filterNotInCycle(result, reps, { teams, teamSel: sel(NO_TEAM), status: "all" }).map((r) => r.store.id);
  ok("the teamless rep's store is reachable under No team", none.includes("teamless"));
  ok("a store on an unknown rep code counts as having no team", none.includes("orphan"),
    "otherwise it is unreachable from every team option");
  const leader = filterNotInCycle(result, reps, { teams, teamSel: { leaderId: "b@example.com", teamId: "" }, status: "all" }).map((r) => r.store.id);
  ok("picking a leader narrows to their teams", leader.join(",") === "capetown", leader.join(","));
}

// ── Reason filter ─────────────────────────────────────────────────────────
{
  const all = filterNotInCycle(result, reps, { status: "all" });
  let sum = 0;
  for (const r of Object.keys(REASONS) as NotInCycleReason[]) {
    const n = filterNotInCycle(result, reps, { status: "all", reason: r }).length;
    sum += n;
    ok(`reason "${r}" filters to exactly its counted rows`, n === result.counts[r], `${n} vs ${result.counts[r]}`);
  }
  ok("the counts add up to the whole list", sum === all.length);
}

// ── Search ────────────────────────────────────────────────────────────────
{
  const hit = filterNotInCycle(result, reps, { search: "capetown", status: "all" });
  ok("search matches the Place ID", hit.length === 1 && hit[0].store.id === "capetown");
  const byRep = filterNotInCycle(result, reps, { search: "r3", status: "all" });
  ok("search matches the rep code", byRep.some((r) => r.store.id === "teamless"));
}

// ── Role scoping is not a filter ──────────────────────────────────────────
{
  const scoped = findNotInCycle({ stores, channels, overrides: [], routes, reps, visibleRepCodes: new Set(["R2"]) });
  const rows = filterNotInCycle(scoped, reps, { status: "all" });
  ok("role scoping hides another rep's stores entirely", rows.every((r) => r.store.repCode === "R2"));
  ok("and the totals reflect only what may be seen", scoped.totalStores === 1);
  // A filter narrows rows, never the denominator.
  const narrowed = filterNotInCycle(result, reps, { repCode: "R2" });
  ok("the rep filter narrows rows but not the total", narrowed.length === 1 && result.totalStores === stores.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
