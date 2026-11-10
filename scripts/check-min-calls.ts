/**
 * Assertions for a rep's minimum calls a day, in each of its three modes.
 *
 * Run: npx tsx scripts/check-min-calls.ts
 *
 * The rep has 30 weekly stores close together and a minimum of 8 a day, so a
 * plain 5-day week gives 6 a day: two short of the minimum, every day.
 */

import { generateRepRoute, planWeekDays } from "../lib/route-engine";
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

  // ── planWeekDays on its own ──
  const side = (calls: number, maxVisits = 1) => ({ calls, maxVisits, minutes: calls * 45 });
  const W = 510;
  ok("no pack: 5 days", planWeekDays(side(30), side(0), { pack: false, minCalls: 8, workingMinutes: W }).activeDays === 5);
  ok("pack: 30 calls at min 8 = 3 days", planWeekDays(side(30), side(0), { pack: true, minCalls: 8, workingMinutes: W }).activeDays === 3);
  const light = planWeekDays(side(4), side(2), { pack: true, minCalls: 8, workingMinutes: W });
  ok("pack: light week with a stay keeps a day for EACH side", light.activeDays === 2 && light.awayDays === 1, JSON.stringify(light));
  const busy = planWeekDays(side(21, 5), side(0), { pack: true, minCalls: 8, workingMinutes: W });
  ok("pack: a daily store keeps all 5 days", busy.activeDays === 5, JSON.stringify(busy));
  const thrice = planWeekDays(side(12, 3), side(6), { pack: true, minCalls: 8, workingMinutes: W });
  ok("pack: a 3x-weekly home store keeps 3 home days", thrice.activeDays - thrice.awayDays >= 3 && thrice.awayDays >= 1, JSON.stringify(thrice));
  ok("pack: never below what the cap needs", planWeekDays(side(30), side(0), { pack: true, minCalls: 8, cap: 8, workingMinutes: W }).activeDays === 4);

  // ── light pack week with an overnight stay: nothing vanishes ──
  const STAY = { lat: -23.9, lng: 29.45 };
  const few: Store[] = [
    ...stores.slice(0, 4),
    ...[0, 1].map((i) => ({ ...stores[0], id: `P${i}`, placeId: `P${i}`, name: `P${i}`, gpsLat: String(STAY.lat + i * 0.01), gpsLng: String(STAY.lng) }) as Store),
  ];
  const lightPlan = await generateRepRoute(
    { ...rep(8, "pack"), stayGpsLat: String(STAY.lat), stayGpsLng: String(STAY.lng) } as Rep, few, "08:00");
  const planned = new Set(wk1(lightPlan.days).flatMap((d) => d.stops.map((s) => s.storeId)));
  ok("pack + stay, light week: every store is planned or reported",
    few.every((st) => planned.has(st.id) || lightPlan.stats.unassignedStores.some((u) => u.storeId === st.id)),
    [...planned].join(","));

  // ── pack keeps every visit of a daily store ──
  const daily = { ...stores[0], id: "D", placeId: "D", name: "D", frequency: "daily" } as Store;
  const packDaily = await generateRepRoute(rep(8, "pack"), [...stores.slice(1, 21), daily], "08:00");
  ok("pack: daily store still visited 5 times a week", wk1(packDaily.days).filter((d) => d.stops.some((s) => s.storeId === "D")).length === 5);

  // ── top-up: no unknown-sales stores (Clippa), nothing far away ──
  const unknown = { ...stores[0], id: "U", placeId: "U", name: "U", monthlySales: 0 } as Store;
  const far = { ...stores[29], id: "F", placeId: "F", name: "F", gpsLat: String(HOME.lat + 0.5), monthlySales: 999999 } as Store;
  const topped = await generateRepRoute(rep(8, "fill"), [...stores, unknown, far], "08:00");
  const extras = topped.days.flatMap((d) => d.stops.filter((s) => s.extraVisit));
  ok("fill: no extra call 50 km away", extras.every((s) => s.storeId !== "F"));

  // ── rural rep: real drives beat the 15-minute guess, so a free day must reopen ──
  const rural = stores.map((st, n) => ({ ...st, gpsLat: String(HOME.lat + (n % 6) * 0.12), gpsLng: String(HOME.lng + Math.floor(n / 6) * 0.12) }) as Store);
  const ruralPlan = await generateRepRoute(rep(8, "pack"), rural, "08:00");
  ok("pack, rural: no call dropped while a day sits free",
    ruralPlan.stats.unassignedStores.length === 0 || (ruralPlan.freeDays ?? []).length === 0,
    `${ruralPlan.stats.unassignedStores.length} unassigned, ${(ruralPlan.freeDays ?? []).length} free days`);
  ok("pack, rural: all 30 calls planned in week 1", wk1(ruralPlan.days).reduce((n, d) => n + d.stops.length, 0) === 30,
    String(wk1(ruralPlan.days).reduce((n, d) => n + d.stops.length, 0)));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
