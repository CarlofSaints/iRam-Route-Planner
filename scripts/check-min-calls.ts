/**
 * Assertions for a rep's minimum calls a day, in each of its three modes.
 *
 * Run: npx tsx scripts/check-min-calls.ts
 *
 * The rep has 30 weekly stores close together and a minimum of 8 a day, so a
 * plain 5-day week gives 6 a day: two short of the minimum, every day.
 */

import { generateRepRoute } from "../lib/route-engine";
import type { Rep, Store, MinCallsMode } from "../lib/types";

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) passed++;
  else failed++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${!condition && detail ? `  — ${detail}` : ""}`);
}

const HOME = { lat: -26.1, lng: 28.05 };

function rep(min?: number, mode?: MinCallsMode): Rep {
  return {
    id: "r1", code: "R1", name: "Test Rep", email: "", cell: "", homeAddress: "",
    homeGpsLat: String(HOME.lat), homeGpsLng: String(HOME.lng), teamId: "", workingHoursPerDay: 8.5,
    minCallsPerDay: min, minCallsMode: mode,
  } as Rep;
}

// 30 weekly stores on a ~1 km grid, so driving never decides anything.
const stores: Store[] = [];
for (let i = 0; i < 30; i++) {
  stores.push({
    id: `S${i}`, placeId: `S${i}`, name: `S${i}`, channelId: "c1", repCode: "R1",
    gpsLat: String(HOME.lat + (i % 6) * 0.01), gpsLng: String(HOME.lng + Math.floor(i / 6) * 0.01),
    monthlySales: (i + 1) * 1000, frequency: "weekly", duration: 30, dayOfWeek: "", weekNumber: "",
  } as Store);
}

const wk1 = <T extends { week: string }>(days: T[]) => days.filter((d) => d.week === "Wk1");

async function main() {
  const none = await generateRepRoute(rep(), stores, "08:00");
  ok("no minimum: 5 days, nothing flagged", wk1(none.days).length === 5 && none.days.every((d) => d.underMinimumBy === undefined));

  const flag = await generateRepRoute(rep(8, "flag"), stores, "08:00");
  ok("flag: still 5 days", wk1(flag.days).length === 5);
  ok("flag: every short day says how short", flag.days.every((d) => d.underMinimumBy === (d.stops.length < 8 ? 8 - d.stops.length : undefined)),
    flag.days.map((d) => `${d.stops.length}/${d.underMinimumBy}`).join(" "));
  ok("flag: nothing extra added", flag.days.every((d) => d.stops.every((s) => !s.extraVisit)));

  const pack = await generateRepRoute(rep(8, "pack"), stores, "08:00");
  const pDays = wk1(pack.days);
  ok("pack: fewer days in the week", pDays.length < 5, String(pDays.length));
  ok("pack: every planned day meets the minimum", pack.days.every((d) => d.stops.length >= 8 && !d.underMinimumBy),
    pack.days.map((d) => d.stops.length).join(","));
  ok("pack: free days are listed", (pack.freeDays ?? []).filter((f) => f.week === "Wk1").length === 5 - pDays.length);
  ok("pack: no call is lost", pack.stats.unassignedStores.length === 0 && pDays.reduce((n, d) => n + d.stops.length, 0) === 30,
    JSON.stringify(pack.stats.unassignedStores.slice(0, 3)));
  ok("pack: no day runs past the working day", pack.days.every((d) => !d.overCapacity));

  const fill = await generateRepRoute(rep(8, "fill"), stores, "08:00");
  ok("fill: still 5 days", wk1(fill.days).length === 5);
  ok("fill: days topped up to the minimum", fill.days.every((d) => d.stops.length >= 8 && !d.underMinimumBy),
    fill.days.map((d) => d.stops.length).join(","));
  ok("fill: every store keeps its one normal call, the rest are marked extra",
    wk1(fill.days).flatMap((d) => d.stops.filter((s) => !s.extraVisit)).length === 30 &&
      wk1(fill.days).some((d) => d.stops.some((s) => s.extraVisit)));
  ok("fill: no store twice on one day", fill.days.every((d) => new Set(d.stops.map((s) => s.storeId)).size === d.stops.length));
  ok("fill: no day runs past the working day", fill.days.every((d) => !d.overCapacity));

  const capped = await generateRepRoute(rep(8, "flag"), stores, "08:00", undefined, undefined, 5);
  ok("a minimum above the calls-per-day cap is read as the cap", capped.minCallsPerDay === 5 && capped.days.every((d) => !d.underMinimumBy));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
