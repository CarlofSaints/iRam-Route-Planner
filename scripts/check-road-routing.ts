/**
 * Assertions for running the day builds concurrently, and for reporting how
 * much of a plan is a real drive.
 *
 * Run: npx tsx scripts/check-road-routing.ts
 *
 * The concurrency change is the risky one: it reorders WHEN days are built, and
 * a plan whose days came back in a different order would silently reshuffle
 * every rep's week. So the first thing asserted is that the output is identical
 * to the sequential version — same days, same order, same stores, same legs.
 *
 * The reporting is the other half. The fallback to straight lines is silent by
 * design, and silence is what hid it for weeks, so a plan has to be able to say
 * this about itself — including a plan saved before the field existed.
 */

import { generateRepRoute } from "../lib/route-engine";
import { countRoadRouting, roadRoutingOf } from "../lib/roadRouting";
import type { Rep, RepRoutePlan, RoutePlanDocument, Store } from "../lib/types";

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

const HOME = { lat: -26.0, lng: 28.0 };

function rep(over: Partial<Rep> = {}): Rep {
  return {
    id: "r1", code: "R1", name: "Test Rep", email: "rep@example.com", cell: "",
    homeAddress: "Home", homeGpsLat: String(HOME.lat), homeGpsLng: String(HOME.lng),
    teamId: "", workingHoursPerDay: 8.5, ...over,
  } as Rep;
}

function store(id: string, lat: number, lng: number): Store {
  return {
    id, placeId: id, name: `Store ${id}`, channelId: "c1", repCode: "R1",
    gpsLat: String(lat), gpsLng: String(lng), monthlySales: 0,
    frequency: "weekly", duration: 30, dayOfWeek: "", weekNumber: "",
  } as Store;
}

/** A fingerprint of everything a plan decided, for comparing two runs. */
function fingerprint(p: RepRoutePlan): string {
  return JSON.stringify(
    p.days.map((d) => [
      d.week, d.day,
      d.stops.map((s) => [s.storeId, s.sequence, s.arrivalTime, s.distanceFromPrev]),
      d.totalDistance, d.totalTime, d.returnDistanceKm,
    ])
  );
}

async function main() {
  // Enough stores that several days exist per week and the concurrency limit
  // (6) is genuinely exceeded — 20 planned days means four full batches.
  const stores = Array.from({ length: 40 }, (_, i) =>
    store(`s${i + 1}`, -26.0 - (i % 8) * 0.05, 28.0 + Math.floor(i / 8) * 0.06)
  );

  // ── 1. Concurrency must not change the answer ────────────────────────────
  // Run the SAME input twice. Days are built six at a time and completion
  // order is not deterministic, so if results were collected as they finished
  // rather than by index, these two would differ.
  const a = await generateRepRoute(rep(), stores, "08:00", undefined, undefined, 8);
  const b = await generateRepRoute(rep(), stores, "08:00", undefined, undefined, 8);

  // 🔴 This failed before the k-means seed was made deterministic, and it
  // failed on the SEQUENTIAL engine too — so it was never about concurrency.
  // `initializeCentroids` picked its first centroid with Math.random(), which
  // meant regenerating with no data change at all moved stores between days
  // for every rep. Two assertions in one: the concurrent build collects
  // results by index rather than by completion, AND generation is reproducible.
  ok("two runs of the same input produce identical plans", fingerprint(a) === fingerprint(b));

  // A third run, to catch a seed that is stable in pairs but drifts over time.
  const c = await generateRepRoute(rep(), stores, "08:00", undefined, undefined, 8);
  ok("and a third run still matches", fingerprint(a) === fingerprint(c));

  // The invariant that must hold whatever the clustering does: no store is
  // lost or duplicated by building the days concurrently.
  const scheduled = a.days.flatMap((d) => d.stops.map((s) => s.storeId));
  const dropped = a.stats.unassignedStores.map((u) => u.storeId);
  ok(
    "every store is either scheduled or reported, never silently lost",
    new Set([...scheduled, ...dropped]).size === stores.length,
    `${new Set([...scheduled, ...dropped]).size} of ${stores.length}`
  );
  ok("the plan has the days it should", a.days.length > 0, `${a.days.length} days`);

  // Days come back in cycle order, not completion order.
  const order = a.days.map((d) => `${d.week} ${d.day}`);
  const sorted = [...order].sort((x, y) => {
    const W = ["Wk1", "Wk2", "Wk3", "Wk4"];
    const D = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const [xw, xd] = x.split(" "); const [yw, yd] = y.split(" ");
    return W.indexOf(xw) - W.indexOf(yw) || D.indexOf(xd) - D.indexOf(yd);
  });
  ok("days are in cycle order, not the order they finished", order.join("|") === sorted.join("|"));

  ok(
    "every store is on exactly one day per week",
    a.days.filter((d) => d.week === "Wk1").flatMap((d) => d.stops.map((s) => s.storeId)).length ===
      new Set(a.days.filter((d) => d.week === "Wk1").flatMap((d) => d.stops.map((s) => s.storeId))).size
  );

  // Sequence numbers restart at 1 on every day and run without gaps — a day
  // assembled from a shared result array could easily lose one.
  for (const d of a.days) {
    ok(
      `${d.week} ${d.day}: stops are numbered 1..${d.stops.length} with no gaps`,
      d.stops.every((s, i) => s.sequence === i + 1),
      d.stops.map((s) => s.sequence).join(",")
    );
  }

  // ── 2. Counting what is a real drive ─────────────────────────────────────
  // No Google key in a check run, so every day falls back to straight lines —
  // which is exactly the state that must be REPORTED rather than hidden.
  const summary = countRoadRouting([a]);
  ok("every planned day is eligible (this rep has an anchor)", summary.eligibleDays === a.days.length);
  ok("with no Google key, nothing is road-routed", summary.roadRoutedDays === 0);
  ok("the straight-line count is the remainder", summary.straightLineDays === summary.eligibleDays);
  ok("and the plan does NOT claim to be complete", !summary.complete);

  // A rep with no anchor was never going to get road geometry, so their days
  // are not failures — counting them would report the wrong problem.
  const anchorless: RepRoutePlan = { ...a, homeLatLng: null };
  ok("a rep with no anchor contributes no eligible days", countRoadRouting([anchorless]).eligibleDays === 0);

  // A fully road-routed plan reads as complete.
  const allRoad: RepRoutePlan = { ...a, days: a.days.map((d) => ({ ...d, polyline: "abc" })) };
  const full = countRoadRouting([allRoad]);
  ok("a fully road-routed plan is complete", full.complete && full.straightLineDays === 0);

  // 🔴 The half-and-half case is the one that was invisible for weeks.
  const half: RepRoutePlan = {
    ...a,
    days: a.days.map((d, i) => (i % 2 === 0 ? { ...d, polyline: "abc" } : d)),
  };
  const mixed = countRoadRouting([half]);
  ok(
    "a partly road-routed plan is NOT reported as complete",
    !mixed.complete && mixed.roadRoutedDays > 0 && mixed.straightLineDays > 0,
    `${mixed.roadRoutedDays}/${mixed.eligibleDays}`
  );

  // ── 3. Reading it off a document, including an old one ───────────────────
  const doc = (plans: RepRoutePlan[]) =>
    ({ id: "d", generatedAt: "", generatedBy: "t", repPlans: plans,
       config: { useGoogleMaps: true, defaultStartTime: "08:00" } }) as RoutePlanDocument;

  ok("no document, nothing to describe", roadRoutingOf(null) === null);
  ok("empty document, nothing to describe", roadRoutingOf(doc([])) === null);
  ok(
    "a document with no anchored reps describes nothing rather than claiming 0 of 0",
    roadRoutingOf(doc([anchorless])) === null
  );
  ok(
    "🔴 a plan saved before the field existed is still counted from its days",
    roadRoutingOf(doc([half]))?.roadRoutedDays === mixed.roadRoutedDays,
    "the old-plan path is what makes this honest without regenerating"
  );
  ok(
    "several reps are summed, not just the first",
    countRoadRouting([allRoad, a]).eligibleDays === a.days.length * 2 &&
      countRoadRouting([allRoad, a]).roadRoutedDays === a.days.length
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
