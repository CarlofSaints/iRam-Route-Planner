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
  const away = wk1.filter((d) => d.stops.every((s) => s.storeId.startsWith("PLK")));
  const local = wk1.filter((d) => d.stops.every((s) => s.storeId.startsWith("JHB")));

  ok("some days are all Polokwane stores", away.length > 0, `${wk1.map((d) => d.stops.map((s) => s.storeId).join(",")).join(" | ")}`);
  ok("Polokwane days start from the stay", away.every((d) => d.startLatLng?.lat === STAY.lat));
  ok("Johannesburg days start from home (no startLatLng)", local.length > 0 && local.every((d) => !d.startLatLng));
  ok(
    "Polokwane days drive back to the stay, not 270 km home",
    away.every((d) => (d.returnDistanceKm ?? 999) < 30),
    away.map((d) => d.returnDistanceKm).join(",")
  );
  ok(
    "first leg of a Polokwane day is short",
    away.every((d) => d.stops[0].distanceFromPrev < 30),
    away.map((d) => d.stops[0].distanceFromPrev).join(",")
  );
  ok(
    "dayTotals reads the stay for a day saved without a return leg",
    away.every((d) => {
      const { returnDistanceKm, returnTravelTime, ...old } = d;
      void returnDistanceKm; void returnTravelTime;
      const last = d.stops[d.stops.length - 1];
      const t = dayTotals(old, HOME, 8.5);
      return t.returnKm !== null && Math.abs(t.returnKm - haversineKm(last.lat, last.lng, STAY.lat, STAY.lng)) < 0.2;
    })
  );

  const noStay = await generateRepRoute(rep(), stores, "08:00");
  ok("without a stay, no day is marked", noStay.days.every((d) => !d.startLatLng));
  const bad = await generateRepRoute(rep({ stayGpsLat: "0", stayGpsLng: "0" }), stores, "08:00");
  ok("a (0,0) stay is ignored", bad.days.every((d) => !d.startLatLng));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
