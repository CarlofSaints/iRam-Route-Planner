/**
 * A coordinate outside South Africa is BROKEN, not distant.
 *
 * Ported from the outlier half of Clippa 16b5576, where ten stores carried
 * coordinates in Montana, San Francisco, Brooklyn and London (store names
 * geocoded without a country). The out-of-range check reported them as
 * "Out of range (16 952 km), confirm to include", which offered a button that
 * would put a San Francisco pharmacy on a Gauteng rep's Tuesday. iRam's live
 * data has two such stores on 6 Oct 2026.
 *
 * Run: npx tsx scripts/check-foreign-coordinates.ts
 * (Without .env.local, so no Google call is ever made.)
 */
import { checkCoordinate, isForeignCoordinate, splitPastedPair } from "../lib/saCoordinates";
import { generateRepRoute, FOREIGN_GPS_REASON } from "../lib/route-engine";
import { computeOutliers } from "../lib/outliers";
import { Store, Rep, VisitRole } from "../lib/types";

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

const SALES: VisitRole = { id: "sales", name: "Sales Rep", frequency: "monthly", duration: 30, isPrimary: true, checkOutliers: true };

const rep: Rep = {
  id: "r1", code: "R1", name: "Test Rep", email: "", cell: "",
  homeAddress: "", homeGpsLat: "-26.10", homeGpsLng: "28.05", teamId: "",
  workingHoursPerDay: 8.5,
};

const store = (id: string, lat: string, lng: string, extra: Partial<Store> = {}): Store => ({
  id, placeId: id, name: id, channelId: "ch", repCode: "R1",
  gpsLat: lat, gpsLng: lng, monthlySales: 0,
  frequency: "monthly", duration: 30, dayOfWeek: "", weekNumber: "",
  ...extra,
});

(async () => {
  console.log("South African coordinates\n");

  check("Johannesburg is fine", checkCoordinate("-26.1075", "28.0567").problem, null);
  check("Cape Agulhas is fine", checkCoordinate("-34.83", "20.01").problem, null);
  check("Musina is fine", checkCoordinate("-22.35", "30.04").problem, null);
  check("San Francisco is outside SA", checkCoordinate("37.788982", "-122.398301").problem, "outside_sa");
  check("a swapped Joburg pair is called swapped", checkCoordinate("28.0567", "-26.1075").problem, "swapped");
  check("and the fix is offered", checkCoordinate("28.0567", "-26.1075").suggestion, { lat: -26.1075, lng: 28.0567 });
  check("(0,0) is a placeholder", checkCoordinate("0", "0").problem, "null_island");
  check("blank is blank, not foreign", isForeignCoordinate("", ""), false);
  check("(0,0) is not 'foreign' (it is no GPS at all)", isForeignCoordinate("0", "0"), false);
  check("the live bad row -29.66, 69.89 is foreign", isForeignCoordinate("-29.6641", "69.8874"), true);
  check("a pasted pair is split", splitPastedPair("-26.107, 28.056"), { lat: "-26.107", lng: "28.056" });
  check("no em dash in what a person reads", /—/.test(checkCoordinate("37.7", "-122.3").message ?? ""), false);

  console.log("\nThe route engine\n");
  {
    const stores = [
      ...Array.from({ length: 6 }, (_, i) => store(`ok${i}`, String(-26.1 - i * 0.01), "28.05")),
      store("sanfran", "37.788982", "-122.398301"),
      // Confirmed in cycle by someone, and still in San Francisco.
      store("confirmed", "37.79", "-122.40", { rangeConfirmed: true }),
      store("blank", "", ""),
    ];
    const plan = await generateRepRoute(rep, stores, "08:00", undefined, 150);
    const routed = new Set(plan.days.flatMap((d) => d.stops.map((s) => s.storeId)));
    const reasonOf = new Map(plan.stats.unassignedStores.map((u) => [u.storeId, u.reason]));

    check("the South African stores are all routed", [...Array(6).keys()].every((i) => routed.has(`ok${i}`)), true);
    check("a San Francisco store is not routed", routed.has("sanfran"), false);
    check("and is reported as broken GPS", reasonOf.get("sanfran"), FOREIGN_GPS_REASON);
    check("not as out of range, confirm to include", /out of range/i.test(reasonOf.get("sanfran") ?? ""), false);
    check("confirming it does not make it routable", routed.has("confirmed"), false);
    check("a blank store keeps its own reason", reasonOf.get("blank"), "Missing or invalid GPS coordinates");
    check("the reason mentions GPS, so the Routes page offers the fix boxes", /gps/i.test(FOREIGN_GPS_REASON), true);
  }

  console.log("\nThe out-of-range list\n");
  {
    const stores = [
      ...Array.from({ length: 6 }, (_, i) => store(`ok${i}`, String(-26.1 - i * 0.01), "28.05")),
      store("far", "-33.92", "18.42"), // Cape Town: genuinely distant, in SA
      store("sanfran", "37.788982", "-122.398301"),
      store("confirmedForeign", "51.5", "-0.12", { rangeConfirmed: true }), // London
    ];
    const r = computeOutliers([rep], stores, 150, [SALES], []);
    const by = new Map(r.stores.map((o) => [o.storeId, o]));
    check("a distant SA store is a real outlier", by.get("far")?.foreignCoordinate, false);
    check("a foreign store is listed as a broken coordinate", by.get("sanfran")?.foreignCoordinate, true);
    check("a CONFIRMED foreign store is still listed", by.get("confirmedForeign")?.foreignCoordinate, true);
    check("the rep's area is not dragged by the foreign ones", (by.get("far")?.distanceKm ?? 0) < 1500, true);
    check("the in-area stores are not listed", r.stores.filter((o) => o.storeId.startsWith("ok")).length, 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
