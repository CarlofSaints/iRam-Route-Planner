/**
 * Assertions for the drive home at the end of a rep's day.
 *
 * Run: npx tsx scripts/check-return-leg.ts
 *
 * The leg home is the one leg no stop can carry — every `distanceFromPrev` is a
 * leg INTO a stop — so it lived only inside the day's totals, and any change to
 * which stop is last left it measuring a drive from a shop the rep no longer
 * visits. These assert the day's numbers against the stops actually planned,
 * not against a remembered figure, on all three paths that can change the last
 * stop: the build, the calls-per-day trim, and the refit of an overflow store.
 */

import { generateRepRoute, haversineKm } from "../lib/route-engine";
import { dayTotals } from "../lib/dayTotals";
import type { Rep, RouteDayPlan, Store } from "../lib/types";

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

const near = (a: number, b: number, tol = 0.15) => Math.abs(a - b) <= tol;

const HOME = { lat: -26.0, lng: 28.0 };

function rep(overrides: Partial<Rep> = {}): Rep {
  return {
    id: "r1",
    code: "R1",
    name: "Test Rep",
    email: "rep@example.com",
    cell: "",
    homeAddress: "Home",
    homeGpsLat: String(HOME.lat),
    homeGpsLng: String(HOME.lng),
    teamId: "",
    workingHoursPerDay: 8.5,
    ...overrides,
  } as Rep;
}

/** A weekly store at a given point, so every leg is a real distance. */
function store(id: string, lat: number, lng: number, duration = 30): Store {
  return {
    id,
    placeId: id,
    name: `Store ${id}`,
    channelId: "c1",
    repCode: "R1",
    gpsLat: String(lat),
    gpsLng: String(lng),
    monthlySales: 0,
    frequency: "weekly",
    duration,
    dayOfWeek: "",
    weekNumber: "",
  } as Store;
}

/**
 * The day's own arithmetic, recomputed from the stops it ended up with. This is
 * the whole point: the totals have to agree with the route as planned, not with
 * the route as it was part-way through being planned.
 */
function expectedTotals(day: RouteDayPlan) {
  const last = day.stops[day.stops.length - 1];
  const returnKm = haversineKm(last.lat, last.lng, HOME.lat, HOME.lng);
  const stopsKm = day.stops.reduce((s, st) => s + st.distanceFromPrev, 0);
  const stopsMin = day.stops.reduce((s, st) => s + st.travelTimeFromPrev, 0);
  return { returnKm, stopsKm, distance: stopsKm + returnKm, travel: stopsMin + (returnKm / 40) * 60 };
}

function assertDayAddsUp(label: string, day: RouteDayPlan) {
  const e = expectedTotals(day);
  ok(
    `${label}: leg home measured from the stop the day ACTUALLY ends on`,
    day.returnDistanceKm !== undefined && near(day.returnDistanceKm, e.returnKm),
    `plan ${day.returnDistanceKm} km vs ${e.returnKm.toFixed(1)} km from ${day.stops[day.stops.length - 1].storeName}`
  );
  ok(
    `${label}: total distance includes the drive home`,
    near(day.totalDistance, e.distance, 0.25),
    `plan ${day.totalDistance} km vs ${e.distance.toFixed(1)} km`
  );
  ok(
    `${label}: total travel time includes the drive home`,
    near(day.totalTravelTime, e.travel, 1.5),
    `plan ${day.totalTravelTime} min vs ${e.travel.toFixed(1)} min`
  );
  // The regression itself: summing the stops alone is what the map was doing,
  // and it is short by the whole drive home.
  ok(
    `${label}: the stops alone do NOT account for the day`,
    day.totalDistance > e.stopsKm + 0.5,
    `stops ${e.stopsKm.toFixed(1)} km, day ${day.totalDistance} km`
  );
  ok(
    `${label}: says when the rep gets home`,
    !!day.arriveHomeTime && day.arriveHomeTime > day.stops[day.stops.length - 1].departureTime,
    `arrive ${day.arriveHomeTime} vs depart ${day.stops[day.stops.length - 1].departureTime}`
  );
}

async function main() {
  // ── 1. A day as built, no trim ────────────────────────────────────────────
  // Four stores in a line running away from home, so the last one is a long
  // way out and the drive back is unmistakable.
  const spread = [
    store("s1", -26.05, 28.0),
    store("s2", -26.12, 28.0),
    store("s3", -26.2, 28.0),
    store("s4", -26.3, 28.0),
  ];
  const built = await generateRepRoute(rep(), spread, "08:00");
  const builtDays = built.days.filter((d) => d.stops.length > 0);
  ok("A day is planned at all", builtDays.length > 0, `${builtDays.length} days`);
  for (const d of builtDays) assertDayAddsUp(`built ${d.week} ${d.day}`, d);

  // ── 2. After the calls-per-day trim ───────────────────────────────────────
  // 🔴 The original bug. Eight stores, a target of three: five stops are popped
  // off the end of every day, and the leg home was left measuring from the
  // furthest one — a drive the rep never makes.
  // Twenty-five weekly stores over five days is five calls a day, so a target
  // of three drops two from the end of every day. They fan out from home so the
  // stop that gets dropped is always further out than the one left last.
  const many = Array.from({ length: 25 }, (_, i) =>
    store(`t${i + 1}`, -26.0 - (i % 5) * 0.08 - Math.floor(i / 5) * 0.01, 28.0 + Math.floor(i / 5) * 0.09)
  );
  const trimmed = await generateRepRoute(rep(), many, "08:00", undefined, undefined, 3);
  const trimmedDays = trimmed.days.filter((d) => d.stops.length > 0);
  ok(
    "The calls-per-day target is honoured",
    trimmedDays.every((d) => d.stops.length <= 3),
    trimmedDays.map((d) => d.stops.length).join(",")
  );
  ok("Trimming actually happened", trimmedDays.some((d) => d.stops.length === 3));
  for (const d of trimmedDays) assertDayAddsUp(`trimmed ${d.week} ${d.day}`, d);

  // ⚠️ `unassignedStores` is one entry per DROPPED VISIT and carries no week, so
  // a store dropped in Wk3 and kept in Wk1 appears in it while still legitimately
  // ending a Wk1 day. It can prove the trim ran; it cannot say which day lost
  // which store. What each day charges for the drive home is asserted above,
  // against that day's own last stop.
  const dropped = trimmed.stats.unassignedStores.filter((u) =>
    u.reason.includes("calls per day")
  );
  ok("Visits were dropped over the target", dropped.length > 0, `${dropped.length} dropped`);

  // ── 3. A long day, trimmed by the clock instead ───────────────────────────
  // No target, so the time-based trim runs. It pops stops until the day fits,
  // and the drive home is part of what "fits" has to mean.
  const longDay = Array.from({ length: 12 }, (_, i) =>
    store(`h${i + 1}`, -26.0 - i * 0.15, 28.0, 60)
  );
  const clocked = await generateRepRoute(rep({ workingHoursPerDay: 6 }), longDay, "08:00");
  const clockedDays = clocked.days.filter((d) => d.stops.length > 0);
  for (const d of clockedDays) assertDayAddsUp(`clock-trimmed ${d.week} ${d.day}`, d);
  ok(
    "A day trimmed by the clock fits its hours, drive home included",
    clockedDays.every((d) => d.stops.length === 1 || d.totalTime <= 6 * 60),
    clockedDays.map((d) => `${d.day}:${d.totalTime}m/${d.stops.length}`).join(" ")
  );

  // ── 4. The plan's own totals match the days ───────────────────────────────
  for (const plan of [built, trimmed, clocked]) {
    ok(
      `${plan.repCode}: every planned day carries a leg home`,
      plan.days.filter((d) => d.stops.length > 0).every((d) => d.returnDistanceKm !== undefined),
      `${plan.days.filter((d) => d.stops.length > 0 && d.returnDistanceKm === undefined).length} without`
    );
  }

  // ── 5. `dayTotals`, the figure the pages actually print ───────────────────
  // Both the Routes grid and the map summary read this, so it has to agree with
  // the engine on a fresh plan AND stand on its own on a plan saved before the
  // engine recorded a leg home.
  const home = built.homeLatLng!;
  for (const d of trimmedDays) {
    const t = dayTotals(d, home, 8.5);
    ok(
      `dayTotals ${d.week} ${d.day}: matches the engine's own distance`,
      near(t.distanceKm, d.totalDistance, 0.25),
      `${t.distanceKm.toFixed(1)} vs ${d.totalDistance}`
    );
    ok(
      `dayTotals ${d.week} ${d.day}: matches the engine's own leg home`,
      near(t.returnKm ?? -1, d.returnDistanceKm ?? -2),
      `${t.returnKm} vs ${d.returnDistanceKm}`
    );
    ok(
      `dayTotals ${d.week} ${d.day}: the day starts before the first call`,
      !!t.leaveHome && t.leaveHome <= d.stops[0].arrivalTime,
      `leaves ${t.leaveHome}, first arrival ${d.stops[0].arrivalTime}`
    );
  }

  // A plan saved before any of this existed: the stored fields are gone, and
  // the pages must still produce the right day.
  const asSavedBefore = trimmedDays.map((d) => {
    const copy: RouteDayPlan = { ...d };
    delete copy.returnDistanceKm;
    delete copy.returnTravelTime;
    delete copy.arriveHomeTime;
    return copy;
  });
  for (const d of asSavedBefore) {
    const t = dayTotals(d, home, 8.5);
    const e = expectedTotals(d);
    ok(
      `old plan ${d.week} ${d.day}: still measures the drive home`,
      t.returnKm !== null && near(t.returnKm, e.returnKm) && near(t.distanceKm, e.distance),
      `${t.returnKm} km home, ${t.distanceKm.toFixed(1)} km day`
    );
  }

  // 🔴 No anchor at all is not a 0 km drive home. A rep with no home and no
  // centroid must read as "not measured", or the page quietly claims they sleep
  // at their last call.
  const noAnchor = dayTotals(trimmedDays[0], null, 8.5);
  ok("No start point: the leg home is absent, not zero", noAnchor.returnKm === null);
  ok("No start point: no arrival time is invented", noAnchor.arriveHome === null);
  ok(
    "No start point: the day still totals its stops",
    noAnchor.distanceKm > 0 && noAnchor.stops === trimmedDays[0].stops.length
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
