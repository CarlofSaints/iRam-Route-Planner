/**
 * Assertions for the second start point (overnight stay).
 *
 * Run: npx tsx scripts/check-second-start-point.ts
 *
 * A rep lives in Johannesburg and also works Polokwane (~270 km away), staying
 * over there. Days made of Polokwane stores must start and end at the stay;
 * Johannesburg days must still start and end at home.
 */

import { generateRepRoute, haversineKm } from "../lib/route-engine";
import { dayTotals } from "../lib/dayTotals";
import type { Rep, Store } from "../lib/types";

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) passed++;
  else failed++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${!condition && detail ? `  — ${detail}` : ""}`);
}

const HOME = { lat: -26.1, lng: 28.05 }; // Johannesburg
const STAY = { lat: -23.9, lng: 29.45 }; // Polokwane

function rep(overrides: Partial<Rep> = {}): Rep {
  return {
    id: "r1", code: "R1", name: "Test Rep", email: "", cell: "", homeAddress: "",
    homeGpsLat: String(HOME.lat), homeGpsLng: String(HOME.lng), teamId: "", workingHoursPerDay: 8.5,
    ...overrides,
  } as Rep;
}

function store(id: string, lat: number, lng: number): Store {
  return {
    id, placeId: id, name: id, channelId: "c1", repCode: "R1", gpsLat: String(lat), gpsLng: String(lng),
    monthlySales: 0, frequency: "weekly", duration: 30, dayOfWeek: "", weekNumber: "",
  } as Store;
}

// 15 stores round Johannesburg, 10 round Polokwane, all weekly.
const stores: Store[] = [];
for (let i = 0; i < 15; i++) stores.push(store(`JHB${i}`, HOME.lat + (i % 5) * 0.02, HOME.lng + Math.floor(i / 5) * 0.02));
for (let i = 0; i < 10; i++) stores.push(store(`PLK${i}`, STAY.lat + (i % 5) * 0.02, STAY.lng + Math.floor(i / 5) * 0.02));

async function main() {
  const withStay = await generateRepRoute(rep({ stayGpsLat: String(STAY.lat), stayGpsLng: String(STAY.lng) }), stores, "08:00");
  const wk1 = withStay.days.filter((d) => d.week === "Wk1");
  const isAway = (d: (typeof wk1)[number]) => d.stops.every((s) => s.storeId.startsWith("PLK"));
  const away = wk1.filter(isAway);
  const local = wk1.filter((d) => d.stops.every((s) => s.storeId.startsWith("JHB")));
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const awayIdx = away.map((d) => order.indexOf(d.day)).sort();

  ok("no day mixes Johannesburg and Polokwane stores", away.length + local.length === wk1.length,
    wk1.map((d) => d.stops.map((s) => s.storeId).join(",")).join(" | "));
  ok("away days are back to back at the end of the week", awayIdx.length >= 2 && awayIdx.every((d, i) => d === 4 - (awayIdx.length - 1) + i), awayIdx.join(","));
  const first = away.find((d) => order.indexOf(d.day) === awayIdx[0])!;
  const last = away.find((d) => d.day === "Friday")!;
  ok("first away day leaves from home and ends at the stay", !first.startLatLng && first.endLatLng?.lat === STAY.lat);
  ok("first away day charges the ~270 km drive out", first.stops[0].distanceFromPrev > 200, String(first.stops[0].distanceFromPrev));
  ok("first away day ends with a short leg to the stay", (first.returnDistanceKm ?? 999) < 30, String(first.returnDistanceKm));
  ok("Friday starts at the stay and drives home", last.startLatLng?.lat === STAY.lat && !last.endLatLng && (last.returnDistanceKm ?? 0) > 200,
    `${JSON.stringify(last.startLatLng)} ${last.returnDistanceKm}`);
  ok("Friday's first leg is short", last.stops[0].distanceFromPrev < 30, String(last.stops[0].distanceFromPrev));
  ok("Johannesburg days start and end at home", local.length > 0 && local.every((d) => !d.startLatLng && !d.endLatLng && (d.returnDistanceKm ?? 999) < 30));
  ok(
    "dayTotals measures an old-style day's last leg to the stay",
    (() => {
      const { returnDistanceKm, returnTravelTime, ...old } = first;
      void returnDistanceKm; void returnTravelTime;
      const l = first.stops[first.stops.length - 1];
      const t = dayTotals(old, HOME, 8.5);
      return t.returnKm !== null && Math.abs(t.returnKm - haversineKm(l.lat, l.lng, STAY.lat, STAY.lng)) < 0.2;
    })()
  );

  // A twice-a-week Johannesburg store must never be pinned onto an away day.
  const twice = { ...store("JHBX", HOME.lat, HOME.lng + 0.05), frequency: "2x_weekly" } as Store;
  const daily = { ...store("JHBD", HOME.lat, HOME.lng + 0.06), frequency: "daily" } as Store;
  const pinned = await generateRepRoute(rep({ stayGpsLat: String(STAY.lat), stayGpsLng: String(STAY.lng) }), [...stores, twice, daily], "08:00");
  const pWk1 = pinned.days.filter((d) => d.week === "Wk1");
  ok("multi-visit home stores stay off away days", pWk1.filter((d) => d.stops.some((s) => s.storeId.startsWith("PLK")))
    .every((d) => !d.stops.some((s) => s.storeId === "JHBX" || s.storeId === "JHBD")));
  ok("2x weekly home store still gets 2 calls", pWk1.filter((d) => d.stops.some((s) => s.storeId === "JHBX")).length === 2);
  ok("daily home store's lost away-day calls are reported", pinned.stats.unassignedStores.some((u) => u.storeId === "JHBD" && /away at the overnight stay/.test(u.reason)));

  const noStay = await generateRepRoute(rep(), stores, "08:00");
  ok("without a stay, no day is marked", noStay.days.every((d) => !d.startLatLng));
  const bad = await generateRepRoute(rep({ stayGpsLat: "0", stayGpsLng: "0" }), stores, "08:00");
  ok("a (0,0) stay is ignored", bad.days.every((d) => !d.startLatLng));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
