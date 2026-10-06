/**
 * Assertions for what the My Route page is given.
 *
 * Run: npx tsx scripts/check-my-route.ts
 *
 * Pure: no blob reads. The cases that matter are the iRam ones: a person who
 * holds a NON-primary visit role at a store (QC, training) must still see it
 * as their store, and nobody else's stores or plans may come back.
 */

import { plansForRep, shapeDay, shapePlan, storesForRepAnyRole } from "../lib/myRoute";
import { parseClock, formatClock } from "../lib/clock";
import type { RepRoutePlan, RouteDayPlan, RoutePlanDocument, Store, VisitRole } from "../lib/types";

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) passed++;
  else {
    failed++;
    console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const roles: VisitRole[] = [
  { id: "sales", name: "Sales Rep", frequency: "monthly", duration: 30, isPrimary: true, checkOutliers: true },
  { id: "qc", name: "QC", frequency: "quarterly", duration: 60, isPrimary: false, checkOutliers: false },
  { id: "training", name: "Training", frequency: "bimonthly", duration: 90, isPrimary: false, checkOutliers: false },
];

const store = (id: string, extra: Partial<Store>): Store =>
  ({
    id,
    placeId: id,
    name: `Store ${id}`,
    channelId: "c",
    repCode: "",
    gpsLat: "-26.1",
    gpsLng: "28.0",
    monthlySales: 0,
    frequency: "monthly",
    duration: 30,
    dayOfWeek: "",
    weekNumber: "",
    ...extra,
  }) as Store;

const stores: Store[] = [
  store("S1", { repCode: "A1" }),
  store("S2", { repCode: "B1", roleReps: { qc: "A1" } }),
  store("S3", { repCode: "A1", roleReps: { training: "A1" } }),
  store("S4", { repCode: "B1", repCode2: "A1" }), // predates roleReps
  store("S5", { repCode: "B1", roleReps: {}, repCode2: "A1" }), // migrated: old slot no longer counts
  store("S6", { repCode: " a1 " }), // stray case and spaces
  store("S7", { repCode: "B1", roleReps: { qc: "C1" } }),
];

// ── Stores by ANY role ──
const mine = storesForRepAnyRole(stores, "A1", "QC", roles, new Set(["S1"]));
const ids = mine.map((s) => s.storeId).sort().join(",");
ok("a rep sees every store they hold any role at", ids === "S1,S2,S3,S4,S6", ids);
ok("a QC slot is named QC", mine.find((s) => s.storeId === "S2")?.roles.join() === "QC");
ok(
  "two roles at one store are both named",
  mine.find((s) => s.storeId === "S3")?.roles.join() === "Sales Rep,Training"
);
ok("an old repCode2 slot is named by the rep's own role", mine.find((s) => s.storeId === "S4")?.roles.join() === "QC");
ok("a migrated store ignores the old slot", !mine.some((s) => s.storeId === "S5"));
ok("someone else's store never comes back", !mine.some((s) => s.storeId === "S7"));
ok("planned is marked", mine.find((s) => s.storeId === "S1")?.planned === true);
ok("unplanned is marked", mine.find((s) => s.storeId === "S2")?.planned === false);
ok("unplanned stores are listed first", mine[0].planned === false);
ok("a blank rep code sees nothing", storesForRepAnyRole(stores, "", "QC", roles, new Set()).length === 0);
ok("no store record leaks its sales figure", !("monthlySales" in mine[0]));

// ── Plans ──
const day = (over: Partial<RouteDayPlan> = {}): RouteDayPlan => ({
  week: "Wk1",
  day: "Monday",
  stops: [
    { storeId: "S1", storeName: "Store S1", lat: -26.1, lng: 28.0, visitDuration: 30, travelTimeFromPrev: 20, distanceFromPrev: 12, arrivalTime: "08:20", departureTime: "08:50", sequence: 1 },
    { storeId: "S3", storeName: "Store S3", lat: -26.2, lng: 28.1, visitDuration: 30, travelTimeFromPrev: 10, distanceFromPrev: 5, arrivalTime: "09:00", departureTime: "09:30", sequence: 2 },
  ],
  totalTravelTime: 30,
  totalVisitTime: 60,
  totalTime: 90,
  totalDistance: 17,
  overCapacity: false,
  ...over,
});
const plan = (code: string): RepRoutePlan => ({
  repCode: code,
  repName: code,
  homeLatLng: { lat: -26.0, lng: 28.0 },
  workingHoursPerDay: 8.5,
  generatedAt: "",
  days: [day()],
  stats: { totalStores: 2, unassignedStores: [] },
});
const doc = { id: "d", generatedAt: "", generatedBy: "", repPlans: [plan("A1"), plan("B1")], config: { useGoogleMaps: false, defaultStartTime: "08:00" } } as RoutePlanDocument;

ok("only the rep's own plan comes back", plansForRep(doc, "A1").map((p) => p.repCode).join() === "A1");
ok("rep code match ignores case and spaces", plansForRep(doc, " a1 ").length === 1);
ok("a blank code gets no plan, never every plan", plansForRep(doc, "").length === 0);
ok("no route book gets no plan", plansForRep(null, "A1").length === 0);

const shaped = shapePlan(plan("A1"), "Sales Rep");
ok("a plan with no role name takes the rep's role", shaped.visitRoleName === "Sales Rep");
const d = shaped.days[0];
ok("leave home is first arrival less the drive out", d.leaveHome === "08:00", String(d.leaveHome));
ok("the drive home is measured when the plan has none", d.returnKm !== null && d.returnKm > 0);
ok("back home is the last departure plus the drive home", d.arriveHome === formatClock(parseClock("09:30") + (d.returnMinutes ?? 0)));
ok("driving includes the leg home", d.distanceKm > 17);

const stored = shapeDay({ ...day(), returnDistanceKm: 7, returnTravelTime: 15 } as RouteDayPlan, { lat: -26, lng: 28 });
ok("a recorded leg home is used as recorded", stored.returnKm === 7 && stored.returnMinutes === 15);
ok("and reaches the totals", stored.distanceKm === 24 && stored.travelMinutes === 45);
ok("back home from the recorded leg", stored.arriveHome === "09:45", String(stored.arriveHome));

const noHome = shapeDay(day(), null);
ok("no home means no leg home, not a 0 km one", noHome.returnKm === null && noHome.arriveHome === null);
ok("an empty day has no times", shapeDay(day({ stops: [] }), null).leaveHome === null);
ok("a stop carries no sequence or sales fields", !("sequence" in d.stops[0]));

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
