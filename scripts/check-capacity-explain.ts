/**
 * "Tell me why" on the Capacity page (lib/capacityExplain.ts).
 *
 * Built from the real case that prompted it: a rep with 14 Cape Town stores
 * and a home in another province showed 502%, all of it driving. These pin that the
 * far home is named as THE cause, and that a corrected-but-not-regenerated
 * home says "regenerate" instead of "fix the address" again.
 *
 * Run: npx tsx scripts/check-capacity-explain.ts
 */
import { explainCapacity } from "../lib/capacityExplain";
import { computeCapacity } from "../lib/capacity";
import { Rep, Store, RoutePlanDocument, RepRoutePlan, RouteDayPlan, DayLabel, WeekLabel } from "../lib/types";

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
  }
}

const FAR_HOME = { lat: -26.3577, lng: 28.1571 };
const CAPE_TOWN = { lat: -33.93, lng: 18.6 };
const BELLVILLE = { lat: -33.9, lng: 18.63 };

const rep = (home: { lat: number; lng: number } | null): Rep => ({
  id: "r1", code: "R1", name: "Test Rep", email: "", cell: "",
  homeAddress: home ? "1 Some Street" : "",
  homeGpsLat: home ? String(home.lat) : "", homeGpsLng: home ? String(home.lng) : "",
  teamId: "", workingHoursPerDay: 8.5,
});

const stores: Store[] = [0, 1, 2].map((i) => ({
  id: `S${i}`, placeId: "", name: `Store ${i}`, channelId: "ch", repCode: "R1",
  gpsLat: String(CAPE_TOWN.lat + i * 0.01), gpsLng: String(CAPE_TOWN.lng + i * 0.01),
  monthlySales: 0, frequency: "weekly", duration: 60, dayOfWeek: "", weekNumber: "",
}) as Store);

function day(week: WeekLabel, d: DayLabel, stopIds: string[], travelMin: number, extra: Partial<RouteDayPlan> = {}): RouteDayPlan {
  return {
    week, day: d,
    stops: stopIds.map((id, i) => ({
      storeId: id, storeName: id, lat: 0, lng: 0, visitDuration: 60, travelTimeFromPrev: 0,
      distanceFromPrev: 0, arrivalTime: "", departureTime: "", sequence: i,
    })),
    totalTravelTime: travelMin, totalVisitTime: stopIds.length * 60, totalTime: travelMin + stopIds.length * 60,
    totalDistance: travelMin, overCapacity: travelMin + stopIds.length * 60 > 510, ...extra,
  };
}

function planFrom(start: { lat: number; lng: number }, days: RouteDayPlan[], unassigned: string[] = [], callsPerDay?: number): RepRoutePlan {
  return {
    repCode: "R1", repName: "Test Rep", homeLatLng: start, workingHoursPerDay: 8.5, generatedAt: "2026-10-13T00:00:00Z",
    days, stats: { totalStores: 3, unassignedStores: unassigned.map((id) => ({ storeId: id, storeName: id, reason: "Over daily capacity" })) },
    ...(callsPerDay ? { callsPerDay } : {}),
  };
}

function run(r: Rep, plan: RepRoutePlan) {
  const doc = { id: "d", generatedAt: plan.generatedAt, generatedBy: "", repPlans: [plan], config: { useGoogleMaps: false, defaultStartTime: "08:00" } } as RoutePlanDocument;
  const row = computeCapacity([r], stores, doc).reps[0];
  return explainCapacity(r, row, stores, plan, doc.generatedAt, 20);
}

console.log("\n1. Home 1 200 km from every store");
{
  const e = run(
    rep(FAR_HOME),
    planFrom(FAR_HOME, [day("Wk1", "Monday", ["S0"], 1800, { overrunMinutes: 1350 })], ["S0", "S0", "S1"])
  );
  check("first cause is the far home", e.causes[0]?.kind, "far_home");
  check("start reported as home", e.start.source, "home");
  check("typical distance is over 1 000 km", (e.start.medianKmToStores ?? 0) > 1000, true);
  check("overrun NOT blamed on a calls-per-day target", e.causes.some((c) => c.kind === "overrun"), false);
  check("missed visits counted per visit, not per store", e.causes.find((c) => c.kind === "unassigned")?.title, "3 visits could not be scheduled");
  check("S0 missed twice", e.stores.find((s) => s.storeId === "S0")?.missed, 2);
  check("the sum adds up", e.maths.scheduledHours, Math.round((e.maths.visitHours + e.maths.travelHours) * 10) / 10);
}

console.log("\n2. Home corrected on the record but route not regenerated");
{
  const e = run(rep(BELLVILLE), planFrom(FAR_HOME, [day("Wk1", "Monday", ["S0"], 1800)]));
  check("start reported as an older home", e.start.source, "older_home");
  check("does NOT tell them to fix the address again", e.causes.some((c) => c.kind === "far_home"), false);
  check("tells them the plan is stale", e.causes[0]?.kind, "stale_home");
}

console.log("\n3. A healthy local rep");
{
  const e = run(rep(BELLVILLE), planFrom(BELLVILLE, [day("Wk1", "Monday", ["S0", "S1", "S2"], 60)]));
  check("no causes", e.causes.map((c) => c.kind), []);
}

console.log("\n4. No home GPS: the plan starts on the store centroid");
{
  const centroid = { lat: CAPE_TOWN.lat + 0.01, lng: CAPE_TOWN.lng + 0.01 };
  const e = run(rep(null), planFrom(centroid, [day("Wk1", "Monday", ["S0"], 30)]));
  check("start reported as store centroid", e.start.source, "store_centroid");
  check("says there is no home", e.causes.some((c) => c.kind === "no_home"), true);
}

console.log("\n5. A real calls-per-day target that overruns");
{
  const e = run(rep(BELLVILLE), planFrom(BELLVILLE, [day("Wk1", "Monday", ["S0", "S1", "S2"], 60, { overrunMinutes: 90 })], [], 8));
  check("overrun named with the target", e.causes.find((c) => c.kind === "overrun")?.detail.startsWith("The plan was built to 8 calls a day."), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
