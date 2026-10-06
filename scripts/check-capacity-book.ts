/**
 * A rep's book that cannot fit their hours, and calls per week and per day.
 *
 * Ported from Clippa's data-health check (dba0ed0). Some reps' stores look
 * ordinary and their rep records look ordinary; only the FREQUENCIES make the
 * week impossible, and nothing multiplied the two together. These assert the
 * arithmetic that surfaces them on the Capacity page.
 *
 * iRam twist: a QC / Team Leader rep is measured at THEIR role's frequency and
 * duration on each channel, not the store's sales rhythm.
 *
 * Run: npx tsx scripts/check-capacity-book.ts
 */
import { computeCapacity } from "../lib/capacity";
import { Rep, Store, VisitRole, Channel } from "../lib/types";

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
const LEADER: VisitRole = { id: "training", name: "Team Leader", frequency: "bimonthly", duration: 90, isPrimary: false, checkOutliers: false };
const ROLES = [SALES, LEADER];
const CHANNELS: Channel[] = [{ id: "ch", name: "Channel", frequency: "monthly", duration: 30 }];

const rep = (code: string, extra: Partial<Rep> = {}): Rep => ({
  id: code, code, name: code, email: "", cell: "",
  homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId: "",
  workingHoursPerDay: 8.5,
  ...extra,
});

const store = (id: string, extra: Partial<Store>): Store => ({
  id, placeId: id, name: id, channelId: "ch", repCode: "R1",
  gpsLat: "-26.1", gpsLng: "28.0", monthlySales: 0,
  frequency: "monthly", duration: 30, dayOfWeek: "", weekNumber: "",
  ...extra,
});

const many = (n: number, prefix: string, extra: Partial<Store>) =>
  Array.from({ length: n }, (_, i) => store(`${prefix}${i}`, extra));

const run = (reps: Rep[], stores: Store[]) =>
  computeCapacity(reps, stores, null, ROLES, CHANNELS).reps;

console.log("Capacity: a book that cannot fit the hours\n");

// Comfortably inside: 40 monthly stores at 30 minutes = 20h against 170h.
{
  const [r] = run([rep("R1")], many(40, "E", {}));
  check("a book that fits is not flagged", r.bookExceedsHours, false);
  check("its visit hours are counted", r.bookVisitHours, 20);
  check("calls a week on a 4-week cycle", r.callsPerWeek, 10);
  check("calls a day on 20 working days", r.callsPerDay, 2);
}

// Weekly stores at 45 minutes: 200 x 4 x 45 = 600h against 170h.
{
  const [r] = run([rep("R1")], many(200, "H", { frequency: "weekly", duration: 45 }));
  check("a book that cannot fit IS flagged", r.bookExceedsHours, true);
  check("it reports the visits a month", r.callsPerMonth, 800);
  check("and the calls a day behind them", r.callsPerDay, 40);
  check("and the calls a week", r.callsPerWeek, 200);
  check("and counts the stores visited weekly or more", r.weeklyOrMoreStores, 200);
  check("and says how far over", r.bookOverBy, 3.5);
}

// Frequency, not store count, is what this is about.
{
  const [r] = run([rep("R1")], many(200, "M", { frequency: "monthly", duration: 45 }));
  check("the same 200 stores at monthly are not flagged", r.bookExceedsHours, false);
  check("and none of them count as weekly", r.weeklyOrMoreStores, 0);
}

// A rep's own working hours are honoured, not a hardcoded 8.5.
{
  const [r] = run([rep("R1", { workingHoursPerDay: 4 })], many(200, "S", { duration: 45 }));
  check("a shorter working day makes the same book impossible", r.bookExceedsHours, true);
}

// A rep with nothing allocated is a different problem.
{
  const [r] = run([rep("R9")], []);
  check("a rep with no stores is not flagged", r.bookExceedsHours, false);
  check("and asks for 0 calls a day", r.callsPerDay, 0);
}

// iRam: a Team Leader is measured at the role's rhythm, not the store's.
// 100 weekly 45-minute sales stores would be 300h for the sales rep. The
// leader calls bimonthly (every 2 months = 0.5 a month) for 90 minutes:
// 100 x 0.5 x 90 = 75h, which fits.
{
  const stores = many(100, "Q", { frequency: "weekly", duration: 45, roleReps: { training: "TL1" } });
  const rows = run([rep("R1"), rep("TL1", { visitRoleId: "training" })], stores);
  const sales = rows.find((r) => r.repCode === "R1")!;
  const leader = rows.find((r) => r.repCode === "TL1")!;
  check("the sales rep's weekly book is flagged", sales.bookExceedsHours, true);
  check("the team leader on the same stores is not", leader.bookExceedsHours, false);
  check("the leader's hours use the role's rhythm", leader.bookVisitHours, 75);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
