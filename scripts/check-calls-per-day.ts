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

import { balanceClusters, applyOverrun, clusterIntoDays, generateRepRoute, type GeoStore } from "../lib/route-engine";
import { getVisitsPerWeek, type FrequencyType, type Rep, type RouteDayPlan, type Store } from "../lib/types";

// Never call Google from a check, whatever the shell has loaded.
delete process.env.GOOGLE_MAPS_API_KEY;

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

// ── Whole engine: every store on the right number of days, in the right week ─
//
// 🔴 Two bugs that together put a weekly store on two days of one week and on
// none of another, with nothing reported unassigned:
//   1. the balancer reserved the pinned 2x/week room by CLUSTER index before
//      the clusters were sorted into days, so the room landed on the wrong day;
//   2. the refit after the trim put a store back on ANY day with room, in any
//      week, including a day that already held it.
// Repro from the review: one rep, 30 weekly stores in 5 groups, 2 stores at
// 2x/week, target 8. Varying where the groups sit reproduces it in about a
// quarter of layouts.

const REP: Rep = {
  id: "r1", code: "R1", name: "Test Rep", email: "", cell: "", homeAddress: "",
  homeGpsLat: "-26.0", homeGpsLng: "28.0", teamId: "", workingHoursPerDay: 8.5,
};

/** Deterministic pseudo-random numbers, so a failure always reproduces. */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function storeAt(id: string, lat: number, lng: number, frequency: FrequencyType): Store {
  return { ...store(id), gpsLat: lat.toFixed(5), gpsLng: lng.toFixed(5), frequency };
}

/** Weeks a store is expected in, and how many days in each (no monthly here). */
function expectedPerWeek(s: Store): Record<string, number> {
  if (s.frequency === "quarterly") return { Wk1: 1 };
  const n = getVisitsPerWeek(s.frequency || "monthly");
  return { Wk1: n, Wk2: n, Wk3: n, Wk4: n };
}

/** Every way a plan can put a store on the wrong days. Empty = sound. */
function placementProblems(stores: Store[], plan: Awaited<ReturnType<typeof generateRepRoute>>): string[] {
  const problems: string[] = [];
  const unassigned = new Set(plan.stats.unassignedStores.map((u) => u.storeId));
  for (const s of stores) {
    const want = expectedPerWeek(s);
    for (const week of ["Wk1", "Wk2", "Wk3", "Wk4"]) {
      const days = plan.days.filter((d) => d.week === week && d.stops.some((st) => st.storeId === s.id));
      const perDay = plan.days
        .filter((d) => d.week === week)
        .map((d) => d.stops.filter((st) => st.storeId === s.id).length);
      const expected = want[week] ?? 0;
      if (perDay.some((n) => n > 1)) problems.push(`${s.id} twice on one ${week} day`);
      if (days.length > expected) problems.push(`${s.id} on ${days.length} days of ${week}, expected ${expected}`);
      if (days.length < expected && !unassigned.has(s.id)) {
        problems.push(`${s.id} on ${days.length} days of ${week}, expected ${expected}, and not reported`);
      }
    }
  }
  return problems;
}

async function engineChecks() {
  // 60 layouts of the review's repro: target 8 holds 40 a week, the book is
  // 34, so a sound engine fits everybody with nothing unassigned.
  let broken = 0;
  let leftOver = 0;
  const firstProblem: string[] = [];
  for (let layout = 0; layout < 60; layout++) {
    const rand = lcg(1000 + layout);
    const stores: Store[] = [];
    for (let g = 0; g < 5; g++) {
      const angle = rand() * Math.PI * 2;
      const dist = 0.05 + rand() * 0.25;
      const cLat = -26.0 + Math.sin(angle) * dist;
      const cLng = 28.0 + Math.cos(angle) * dist;
      for (let i = 0; i < 6; i++) {
        stores.push(storeAt(`g${g}s${i}`, cLat + (rand() - 0.5) * 0.02, cLng + (rand() - 0.5) * 0.02, "weekly"));
      }
    }
    stores.push(storeAt("twiceA", -26.0 + (rand() - 0.5) * 0.2, 28.0 + (rand() - 0.5) * 0.2, "2x_weekly"));
    stores.push(storeAt("twiceB", -26.0 + (rand() - 0.5) * 0.2, 28.0 + (rand() - 0.5) * 0.2, "2x_weekly"));

    const plan = await generateRepRoute(REP, stores, "08:00", undefined, undefined, 8);
    const problems = placementProblems(stores, plan);
    if (problems.length) {
      broken++;
      if (!firstProblem.length) firstProblem.push(`layout ${layout}: ${problems[0]}`);
    }
    if (plan.stats.unassignedStores.length) leftOver++;
  }
  ok("no layout puts a store on the wrong days of a week", broken === 0, `${broken}/60 broken; ${firstProblem[0] ?? ""}`);
  ok("a book that fits the target leaves nothing unassigned", leftOver === 0, `${leftOver}/60 layouts left stores over`);

  // The pinned room has to follow the cluster to the DAY it becomes. Uneven
  // groups (8, 8, 6, 4, 4) with Monday and Friday each carrying two pinned
  // visits: a sound split leaves at most 6 singles on those two days.
  {
    let wrong = 0;
    let example = "";
    for (let layout = 0; layout < 60; layout++) {
      const rand = lcg(5000 + layout);
      const singles: Store[] = [];
      [8, 8, 6, 4, 4].forEach((size, g) => {
        const angle = rand() * Math.PI * 2;
        const dist = 0.1 + rand() * 0.2;
        const cLat = -26.0 + Math.sin(angle) * dist;
        const cLng = 28.0 + Math.cos(angle) * dist;
        for (let i = 0; i < size; i++) {
          singles.push(storeAt(`p${g}s${i}`, cLat + (rand() - 0.5) * 0.02, cLng + (rand() - 0.5) * 0.02, "weekly"));
        }
      });
      const days = clusterIntoDays(singles, { lat: -26.0, lng: 28.0 }, { callsPerDay: 8, pinnedPerDay: [2, 0, 0, 0, 2] });
      if (days[0].length > 6 || days[4].length > 6) {
        wrong++;
        if (!example) example = `layout ${layout}: ${days.map((d) => d.length).join(",")}`;
      }
    }
    ok("pinned room is reserved on the day the pins are on", wrong === 0, `${wrong}/60 wrong; ${example}`);
  }

  // A trim in ONE week with room in the others. Ten quarterly stores land in
  // Wk1 only, so Wk1 is over a target of 7 and Wk2 to Wk4 have spare days.
  // The trimmed stores may only go back into Wk1, and only onto a day that
  // does not already hold them; if Wk1 has no room they are reported.
  {
    const rand = lcg(7);
    const stores: Store[] = [];
    for (let i = 0; i < 30; i++) {
      stores.push(storeAt(`w${i}`, -26.0 + (rand() - 0.5) * 0.3, 28.0 + (rand() - 0.5) * 0.3, "weekly"));
    }
    for (let i = 0; i < 10; i++) {
      stores.push(storeAt(`q${i}`, -26.0 + (rand() - 0.5) * 0.3, 28.0 + (rand() - 0.5) * 0.3, "quarterly"));
    }
    const plan = await generateRepRoute(REP, stores, "08:00", undefined, undefined, 7);
    const problems = placementProblems(stores, plan);
    ok("an overflow is never refitted into another week", problems.length === 0, problems.slice(0, 3).join("; "));
    ok("and what Wk1 cannot hold is reported", plan.stats.unassignedStores.length >= 5, String(plan.stats.unassignedStores.length));
    ok("no day exceeds the target after the refit", plan.days.every((d) => d.stops.length <= 7), plan.days.map((d) => d.stops.length).join(","));
  }
}

engineChecks().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
