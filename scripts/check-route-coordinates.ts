/**
 * Every stop in a generated plan must sit at its store's real coordinates.
 *
 * This exists because overflow rebalancing used to push a trimmed store back
 * onto a day with `lat: 0, lng: 0` — it only kept the store's name, not its
 * position. The plan looked fine (right store, right day, sensible times) and
 * the map drew it in the Gulf of Guinea. Reported as "Makro Woodmead is in the
 * middle of the ocean" on 6 Aug 2026.
 *
 * Run: npx tsx scripts/check-route-coordinates.ts
 */
import { generateRepRoute } from "../lib/route-engine";
import { Store, Rep, FrequencyType } from "../lib/types";

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const rep: Rep = {
  id: "r1",
  code: "1934",
  name: "Test Rep",
  email: "test@iram.co.za",
  cell: "",
  homeAddress: "",
  homeGpsLat: "-26.10",
  homeGpsLng: "28.05",
  teamId: "",
  workingHoursPerDay: 8.5,
};

/**
 * Deliberately far more work than 8.5 h/day can hold, so trimToCapacity fires
 * and rebalanceOverflow has real candidates to re-place. Coordinates are spread
 * around Johannesburg; every one is a valid, in-range SA position.
 */
function makeStores(count: number, frequency: FrequencyType, duration: number): Store[] {
  const stores: Store[] = [];
  for (let i = 0; i < count; i++) {
    const lat = -26.0 - (i % 12) * 0.05;
    const lng = 28.0 + Math.floor(i / 12) * 0.05;
    stores.push({
      id: `s${i}`,
      placeId: `P${i}`,
      name: `STORE ${i}`,
      channelId: "test",
      repCode: rep.code,
      gpsLat: String(lat),
      gpsLng: String(lng),
      monthlySales: 1000,
      frequency,
      duration,
      dayOfWeek: "",
      weekNumber: "",
    });
  }
  return stores;
}

async function main() {
  console.log("Route coordinate integrity\n");

  // 120 weekly stores at 90 min each = far beyond capacity, forcing trims.
  const stores = makeStores(120, "weekly", 90);
  const byId = new Map(stores.map((s) => [s.id, s]));

  const plan = await generateRepRoute(rep, stores, "08:00");

  const allStops = plan.days.flatMap((d) => d.stops);
  console.log(
    `  (${allStops.length} stops across ${plan.days.length} days, ` +
      `${plan.stats.unassignedStores.length} unassigned)\n`
  );

  assert("plan actually produced stops", allStops.length > 0);

  // The bug: overflow stops were written at 0,0.
  const atNullIsland = allStops.filter((s) => s.lat === 0 && s.lng === 0);
  assert(
    "no stop sits at 0,0",
    atNullIsland.length === 0,
    atNullIsland.length ? `${atNullIsland.length} stops, e.g. ${atNullIsland[0].storeName}` : ""
  );

  // Stronger: every stop matches its own store's coordinates.
  const misplaced = allStops.filter((s) => {
    const store = byId.get(s.storeId);
    if (!store) return true;
    return (
      Math.abs(s.lat - parseFloat(store.gpsLat)) > 1e-9 ||
      Math.abs(s.lng - parseFloat(store.gpsLng)) > 1e-9
    );
  });
  assert(
    "every stop is at its own store's coordinates",
    misplaced.length === 0,
    misplaced.length
      ? `${misplaced.length} misplaced, e.g. ${misplaced[0].storeName} at ${misplaced[0].lat},${misplaced[0].lng}`
      : ""
  );

  // Every stop must be inside South Africa, which 0,0 is not.
  const outside = allStops.filter(
    (s) => s.lat < -35 || s.lat > -22 || s.lng < 16 || s.lng > 33
  );
  assert(
    "every stop is inside South Africa",
    outside.length === 0,
    outside.length ? `e.g. ${outside[0].storeName} at ${outside[0].lat},${outside[0].lng}` : ""
  );

  // The old code hardcoded a 30-minute visit for refitted stores, so a 90-min
  // store silently became a 30-min one and the day's capacity maths went wrong.
  const wrongDuration = allStops.filter((s) => {
    const store = byId.get(s.storeId);
    return store ? s.visitDuration !== store.duration : true;
  });
  assert(
    "every stop keeps its store's visit duration",
    wrongDuration.length === 0,
    wrongDuration.length
      ? `e.g. ${wrongDuration[0].storeName} got ${wrongDuration[0].visitDuration} min`
      : ""
  );

  // The old code also hardcoded a flat 10 km leg for refitted stores.
  const flatTenKm = allStops.filter((s) => s.distanceFromPrev === 10 && s.travelTimeFromPrev === 15);
  assert(
    "no stop carries the old hardcoded 10 km / 15 min leg",
    flatTenKm.length === 0,
    flatTenKm.length ? `${flatTenKm.length} stops` : ""
  );

  // A refitted stop must not arrive before the stop it follows departs.
  let outOfOrder = 0;
  for (const day of plan.days) {
    for (let i = 1; i < day.stops.length; i++) {
      const prev = day.stops[i - 1];
      const cur = day.stops[i];
      const toMin = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };
      if (toMin(cur.arrivalTime) < toMin(prev.departureTime)) outOfOrder++;
    }
  }
  assert("no stop arrives before the previous one departs", outOfOrder === 0, `${outOfOrder} overlaps`);

  // Sequence numbers must stay contiguous after a refit appends to a day.
  let badSeq = 0;
  for (const day of plan.days) {
    day.stops.forEach((s, i) => {
      if (s.sequence !== i + 1) badSeq++;
    });
  }
  assert("stop sequence numbers stay contiguous per day", badSeq === 0, `${badSeq} wrong`);

  // A store with no usable coordinates must be reported, never placed.
  const noGps = makeStores(3, "monthly", 30).map((s, i) =>
    i === 0 ? { ...s, gpsLat: "", gpsLng: "" } : s
  );
  const plan2 = await generateRepRoute(rep, noGps, "08:00");
  const placedIds = new Set(plan2.days.flatMap((d) => d.stops).map((s) => s.storeId));
  assert("a store with no GPS is not placed on a day", !placedIds.has(noGps[0].id));
  assert(
    "a store with no GPS is reported as unassigned",
    plan2.stats.unassignedStores.some((u) => u.storeId === noGps[0].id)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
