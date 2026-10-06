/**
 * Assertions for the calls-per-day target.
 *
 * Run: npx tsx scripts/check-calls-per-day.ts
 *
 * This decides how many shops a rep is sent to in a day, so the cases that
 * matter most are the ones where it must NOT quietly do something else: a
 * target that cannot be met, a day already full of pinned multi-visit stores,
 * and the no-target path, which every plan built before this feature used and
 * which must still behave exactly as it did.
 */

import { balanceClusters, applyOverrun, type GeoStore } from "../lib/route-engine";
import type { RouteDayPlan, Store } from "../lib/types";

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

function store(id: string): Store {
  return {
    id,
    placeId: id,
    name: `Store ${id}`,
    channelId: "c1",
    repCode: "R1",
    gpsLat: "-26",
    gpsLng: "28",
    monthlySales: 0,
    frequency: "monthly",
    duration: 30,
    dayOfWeek: "",
    weekNumber: "",
  };
}

/** A store at a given point, so distance actually means something. */
function geo(id: string, lat: number, lng: number): GeoStore {
  return { store: { ...store(id), gpsLat: String(lat), gpsLng: String(lng) }, lat, lng };
}

const sizes = (clusters: GeoStore[][]) => clusters.map((c) => c.length);
const ids = (clusters: GeoStore[][]) => clusters.flat().map((g) => g.store.id).sort();

/** Five day-centroids spread along a line, so "nearest day" is well defined. */
const CENTROIDS = [
  { lat: -26.0, lng: 28.0 },
  { lat: -26.1, lng: 28.0 },
  { lat: -26.2, lng: 28.0 },
  { lat: -26.3, lng: 28.0 },
  { lat: -26.4, lng: 28.0 },
];

// ── The target is honoured ───────────────────────────────────────────────────
{
  // 20 stores all dumped on Monday. Geography says one lump; the manager says
  // four a day.
  const clusters: GeoStore[][] = [
    Array.from({ length: 20 }, (_, i) => geo(`s${i}`, -26.0 - i * 0.01, 28.0)),
    [], [], [], [],
  ];
  const before = ids(clusters);
  balanceClusters(clusters, CENTROIDS, { callsPerDay: 4 });

  ok("no day exceeds the target", clusters.every((c) => c.length <= 4), sizes(clusters).join(","));
  ok("every store is still somewhere", JSON.stringify(ids(clusters)) === JSON.stringify(before));
  ok("nothing is duplicated", ids(clusters).length === 20);
  ok("the work is spread over all five days", clusters.every((c) => c.length > 0), sizes(clusters).join(","));
}

// ── Pinned multi-visit stores take up a day's room ───────────────────────────
{
  // Monday already carries 3 pinned visits against a target of 4, so only ONE
  // more may land there. This is the case that silently broke when pinning
  // happened after balancing.
  const clusters: GeoStore[][] = [
    Array.from({ length: 12 }, (_, i) => geo(`s${i}`, -26.0 - i * 0.01, 28.0)),
    [], [], [], [],
  ];
  balanceClusters(clusters, CENTROIDS, { callsPerDay: 4, pinnedPerDay: [3, 0, 0, 0, 0] });

  ok("a day with pins takes only its remaining room", clusters[0].length <= 1, `Monday got ${clusters[0].length}`);
  ok("the days without pins take the full target", clusters.slice(1).every((c) => c.length <= 4), sizes(clusters).join(","));
  ok("no store was dropped while making room", clusters.flat().length === 12, String(clusters.flat().length));
}

// ── A target that cannot be met ──────────────────────────────────────────────
{
  // Five days at 2 calls holds ten. The rep has thirty. Nothing here may
  // invent a day, drop a store, or spin forever.
  const clusters: GeoStore[][] = [
    Array.from({ length: 30 }, (_, i) => geo(`s${i}`, -26.0 - i * 0.01, 28.0)),
    [], [], [], [],
  ];
  const started = Date.now();
  balanceClusters(clusters, CENTROIDS, { callsPerDay: 2 });
  const ms = Date.now() - started;

  ok("an unreachable target still terminates", ms < 3000, `${ms}ms`);
  ok("no store is lost when the target cannot be met", clusters.flat().length === 30, String(clusters.flat().length));
  // The surplus stays put rather than being silently discarded. It is trimmed
  // later, where it can be REPORTED as overflow.
  ok("the surplus is left to be reported, not deleted", clusters.some((c) => c.length > 2), sizes(clusters).join(","));
}

// ── No target: the old behaviour, untouched ──────────────────────────────────
{
  // Every plan built before this feature took this path. A change here would
  // silently redraw them all.
  const clusters: GeoStore[][] = [
    Array.from({ length: 20 }, (_, i) => geo(`s${i}`, -26.0 - i * 0.01, 28.0)),
    [], [], [], [],
  ];
  balanceClusters(clusters, CENTROIDS);
  // Old rule: even split (20/5 = 4) with a two-store tolerance.
  ok("with no target it still evens out to about the average", clusters.every((c) => c.length <= 6), sizes(clusters).join(","));
  ok("with no target nothing is lost", clusters.flat().length === 20);
}

// ── Already balanced, and empty ──────────────────────────────────────────────
{
  const even: GeoStore[][] = [
    [geo("a", -26.0, 28)], [geo("b", -26.1, 28)], [geo("c", -26.2, 28)],
    [geo("d", -26.3, 28)], [geo("e", -26.4, 28)],
  ];
  balanceClusters(even, CENTROIDS, { callsPerDay: 4 });
  ok("a day that is already under the target is left alone", sizes(even).join(",") === "1,1,1,1,1", sizes(even).join(","));

  const empty: GeoStore[][] = [[], [], [], [], []];
  balanceClusters(empty, CENTROIDS, { callsPerDay: 8 });
  ok("no stores at all is not an error", empty.flat().length === 0);

  // Zero and negative mean "no target", never "no calls". A target of zero
  // clearing a rep's whole week is the worst thing this function could do.
  const zero: GeoStore[][] = [
    Array.from({ length: 10 }, (_, i) => geo(`z${i}`, -26.0 - i * 0.01, 28.0)),
    [], [], [], [],
  ];
  balanceClusters(zero, CENTROIDS, { callsPerDay: 0 });
  ok("a target of zero does not empty the week", zero.flat().length === 10, String(zero.flat().length));
}

// ── The overrun is recorded, not hidden ──────────────────────────────────────
{
  const day = (totalTime: number): RouteDayPlan => ({
    day: "Monday",
    week: "Wk1",
    stops: [],
    totalTravelTime: 0,
    totalVisitTime: totalTime,
    totalTime,
    totalDistance: 0,
    overCapacity: false,
  });

  const over = day(560); // 9h20 against an 8.5h day
  applyOverrun(over, 8.5 * 60);
  ok("a long day is flagged", over.overCapacity === true);
  ok("and says by how much", over.overrunMinutes === 50, String(over.overrunMinutes));

  const fits: RouteDayPlan = { ...day(400), overCapacity: true }; // stale from an earlier trim
  applyOverrun(fits, 8.5 * 60);
  ok("a day that fits clears the flag", fits.overCapacity === false);
  // Absent, never 0, so nothing renders "over by 0 minutes".
  ok("a day that fits carries no overrun at all", fits.overrunMinutes === undefined, String(fits.overrunMinutes));

  const exact = day(510); // exactly 8.5h
  applyOverrun(exact, 8.5 * 60);
  ok("a day that exactly fills the hours is not over", exact.overCapacity === false);
  ok("and has no overrun", exact.overrunMinutes === undefined, String(exact.overrunMinutes));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
