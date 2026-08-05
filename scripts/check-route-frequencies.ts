/**
 * The route engine plans a 4-week cycle of 5 working days. Frequencies faster
 * than weekly have to occupy several DAYS inside each week — the clusterer
 * only ever places a store on one day, so they are pinned separately.
 *
 * Run: npx tsx scripts/check-route-frequencies.ts
 */
import { generateRepRoute } from "../lib/route-engine";
import { Rep, Store, FrequencyType } from "../lib/types";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  cond ? pass++ : fail++;
}

const rep: Rep = {
  id: "r1",
  code: "R01",
  name: "Test Rep",
  email: "",
  cell: "",
  homeAddress: "",
  homeGpsLat: "-26.2041",
  homeGpsLng: "28.0473",
  teamId: "",
  workingHoursPerDay: 8.5,
};

// Stores clustered tightly around Johannesburg so nothing is dropped for
// distance or capacity.
const store = (id: string, frequency: FrequencyType, i: number): Store => ({
  id,
  placeId: id,
  name: `${frequency} ${id}`,
  channelId: "c1",
  repCode: "R01",
  gpsLat: String(-26.2041 + i * 0.01),
  gpsLng: String(28.0473 + i * 0.01),
  monthlySales: 0,
  frequency,
  duration: 30,
  dayOfWeek: "",
  weekNumber: "",
});

(async () => {
  const stores: Store[] = [
    store("daily1", "daily", 1),
    store("thrice1", "3x_weekly", 2),
    store("twice1", "2x_weekly", 3),
    store("weekly1", "weekly", 4),
    store("monthly1", "monthly", 5),
    store("quarterly1", "quarterly", 6),
  ];

  const plan = await generateRepRoute(rep, stores);

  // Count how many distinct (week, day) slots each store appears in.
  const slots = new Map<string, Set<string>>();
  for (const day of plan.days) {
    for (const stop of day.stops) {
      const set = slots.get(stop.storeId) ?? new Set<string>();
      set.add(`${day.week}|${day.day}`);
      slots.set(stop.storeId, set);
    }
  }
  const count = (id: string) => slots.get(id)?.size ?? 0;

  const unassigned = plan.stats.unassignedStores.map((u) => u.storeId);
  check("no store was dropped", unassigned.length === 0, unassigned.join(", "));

  check("daily store visited 20x/month (5 days x 4 weeks)", count("daily1") === 20, `got ${count("daily1")}`);
  check("3x_weekly store visited 12x/month", count("thrice1") === 12, `got ${count("thrice1")}`);
  check("2x_weekly store visited 8x/month", count("twice1") === 8, `got ${count("twice1")}`);
  check("weekly store visited 4x/month", count("weekly1") === 4, `got ${count("weekly1")}`);
  check("monthly store visited once", count("monthly1") === 1, `got ${count("monthly1")}`);
  check("quarterly store visited once in the cycle", count("quarterly1") === 1, `got ${count("quarterly1")}`);

  // A daily store must appear on every weekday, not 5 times in one day.
  const dailyDays = new Set([...(slots.get("daily1") ?? [])].map((s) => s.split("|")[1]));
  check("daily store spans all 5 weekdays", dailyDays.size === 5, [...dailyDays].join(", "));

  // 3x weekly should be spread, not bunched on consecutive days.
  const thriceDays = new Set([...(slots.get("thrice1") ?? [])].map((s) => s.split("|")[1]));
  check(
    "3x_weekly lands on Mon/Wed/Fri",
    thriceDays.size === 3 &&
      thriceDays.has("Monday") &&
      thriceDays.has("Wednesday") &&
      thriceDays.has("Friday"),
    [...thriceDays].join(", ")
  );

  console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} passed)`);
  process.exit(fail === 0 ? 0 : 1);
})();
