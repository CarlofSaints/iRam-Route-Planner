/**
 * Assertions for the Data Health checks.
 *
 * Run: npx tsx scripts/check-data-health.ts
 *
 * Each check gets a case that SHOULD fire and a case that should NOT, because a
 * check that reports everything is as useless as one that reports nothing, and
 * only the second kind is obvious from a screenshot.
 */

import { buildDataHealthReport, gpsProblem, HealthIssue } from "../lib/dataHealth";
import { Channel, Rep, Store, StoreOverride } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const rep = (o: Partial<Rep> = {}): Rep => ({
  id: o.id ?? crypto.randomUUID(),
  code: o.code ?? "GAU001",
  name: o.name ?? "A Rep",
  email: o.email ?? "a@example.com",
  cell: o.cell ?? "",
  homeAddress: o.homeAddress ?? "",
  homeGpsLat: o.homeGpsLat ?? "",
  homeGpsLng: o.homeGpsLng ?? "",
  teamId: o.teamId ?? "",
  workingHoursPerDay: o.workingHoursPerDay ?? 8.5,
});

const store = (o: Partial<Store> = {}): Store => ({
  id: o.id ?? crypto.randomUUID(),
  placeId: o.placeId ?? "P1",
  name: o.name ?? "A Shop",
  channelId: o.channelId ?? "indep",
  repCode: o.repCode ?? "GAU001",
  gpsLat: o.gpsLat ?? "-26.10",
  gpsLng: o.gpsLng ?? "28.05",
  monthlySales: o.monthlySales ?? 0,
  frequency: o.frequency ?? "monthly",
  duration: o.duration ?? 30,
  dayOfWeek: o.dayOfWeek ?? "",
  weekNumber: o.weekNumber ?? "",
  province: o.province,
  region: o.region,
  rangeConfirmed: o.rangeConfirmed,
  closed: o.closed,
  closedReason: o.closedReason,
  roleReps: o.roleReps,
});

const CHANNELS: Channel[] = [{ id: "indep", name: "Independent", frequency: "monthly", duration: 30 }];

const run = (reps: Rep[], stores: Store[], channels = CHANNELS, overrides: StoreOverride[] = []) =>
  buildDataHealthReport({ reps, stores, channels, overrides, outlierRadiusKm: 50 });

const find = (r: ReturnType<typeof run>, id: string): HealthIssue => {
  const i = r.issues.find((x) => x.id === id);
  if (!i) throw new Error(`no check called ${id}`);
  return i;
};

console.log("\n--- the GPS rule ---\n");

eq("a good coordinate has no problem", gpsProblem(store()), null);
eq("a blank latitude is blank", gpsProblem(store({ gpsLat: "" })), "blank");
eq("a blank longitude is blank too", gpsProblem(store({ gpsLng: "  " })), "blank");
eq("non-numeric is blank, not a crash", gpsProblem(store({ gpsLat: "n/a" })), "blank");
eq("0,0 is its own kind", gpsProblem(store({ gpsLat: "0", gpsLng: "0" })), "zero");
eq("San Francisco is outside SA", gpsProblem(store({ gpsLat: "37.79", gpsLng: "-122.40" })), "outside");
eq("a lost minus sign is outside SA", gpsProblem(store({ gpsLat: "26.10", gpsLng: "28.05" })), "outside");
eq("Cape Town is inside", gpsProblem(store({ gpsLat: "-33.92", gpsLng: "18.42" })), null);

console.log("\n--- checks fire when they should ---\n");

{
  const r = run([rep({ code: "GAU001" })], [store({ repCode: "NW002" })]);
  eq("a store naming an unknown rep is caught", find(r, "stores-unknown-rep").count, 1);
  eq("...and counted as blocking", find(r, "stores-unknown-rep").severity, "blocking");
}
{
  const r = run([rep({ code: "GAU001" })], [store({ repCode: "" })]);
  eq("a store with no rep code is caught", find(r, "stores-no-rep").count, 1);
}
{
  const r = run([rep({ code: "GAU001" })], [
    store({ gpsLat: "", gpsLng: "" }),
    store({ gpsLat: "0", gpsLng: "0" }),
    store({ gpsLat: "37.79", gpsLng: "-122.40" }),
    store(),
  ]);
  eq("blank GPS is its own check", find(r, "stores-gps-blank").count, 1);
  eq("0,0 is its own check", find(r, "stores-gps-zero").count, 1);
  eq("outside SA is its own check", find(r, "stores-gps-outside").count, 1);
}
{
  const r = run([rep({ code: "GAU001" }), rep({ code: "GAU002" })], [store({ repCode: "GAU001" })]);
  eq("a rep nobody's stores name is caught", find(r, "reps-no-stores").count, 1);
  eq("...identified by code", find(r, "reps-no-stores").rows[0][0], "GAU002");
}
{
  const r = run(
    [rep({ code: "A1", email: "same@x.com" }), rep({ code: "A2", email: "SAME@x.com" })],
    [store({ repCode: "A1" }), store({ repCode: "A2" })]
  );
  eq("two reps on one email is caught regardless of case", find(r, "reps-shared-email").count, 2);
}
{
  const r = run([rep({ code: "A1", email: "" }), rep({ code: "A2", email: "nope" })], [store({ repCode: "A1" })]);
  eq("a blank and a malformed email are both caught", find(r, "reps-no-email").count, 2);
}
{
  const r = run([rep({ homeAddress: "1 Main Rd" })], [store()]);
  eq("an address with no coordinates is caught", find(r, "reps-address-no-gps").count, 1);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ channelId: "ghost" })]);
  eq("an unknown channel id is caught", find(r, "stores-no-channel").count, 1);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ frequency: "weekly" })]);
  eq("a store out of step with its channel is caught", find(r, "stores-channel-mismatch").count, 1);
  eq("...as a warning: routes follow the STORE value, not the channel", find(r, "stores-channel-mismatch").severity, "warning");
}
{
  // Far enough that it clears the 50km radius from the median of the cluster.
  const near = Array.from({ length: 5 }, () => store({ gpsLat: "-26.10", gpsLng: "28.05" }));
  const far = store({ name: "Far Shop", gpsLat: "-29.85", gpsLng: "31.02" });
  const r = run([rep({ code: "GAU001" })], [...near, far]);
  ok("a store far outside the rep's area is caught", find(r, "stores-outliers").count >= 1);
}
{
  const dup = { name: "Same Shop", repCode: "GAU001" };
  const r = run([rep({ code: "GAU001" })], [store({ ...dup, placeId: "P1" }), store({ ...dup, placeId: "P2" })]);
  ok("the same shop recorded twice is caught", find(r, "stores-duplicates").count >= 2);
}

console.log("\n--- and stay quiet when they should ---\n");

{
  const clean = run(
    [rep({ code: "GAU001", email: "a@x.com", homeAddress: "1 Main Rd", homeGpsLat: "-26.1", homeGpsLng: "28.05" })],
    [store({ placeId: "P1", name: "Shop One" }), store({ placeId: "P2", name: "Shop Two" })]
  );
  const noisy = clean.issues.filter((i) => i.count > 0);
  eq("a clean system reports nothing at all", noisy.map((i) => i.id), []);
  eq("...but every check still appears, so a pass is visible", clean.issues.length >= 11, true);
  eq("...with nothing counted as blocking", clean.totals.blocking, 0);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ rangeConfirmed: true, gpsLat: "-29.85", gpsLng: "31.02" }), store(), store(), store(), store()]);
  eq("a store confirmed in-cycle is not reported as an outlier", find(r, "stores-outliers").count, 0);
}
{
  const override = {
    id: "o1", storeId: "S1", storeName: "A Shop", placeId: "P1", channelId: "indep", repCode: "GAU001",
    defaultFrequency: "monthly" as const, defaultDuration: 30, frequency: "weekly" as const, duration: 45,
    approvalStatus: "approved" as const, createdBy: "x", createdAt: "", updatedAt: "",
  };
  const r = run([rep({ code: "GAU001" })], [store({ id: "S1", frequency: "weekly", duration: 45 })], CHANNELS, [override]);
  eq("a store pinned by an approved override is not reported as a mismatch", find(r, "stores-channel-mismatch").count, 0);
}
{
  // iRam: the router matches rep codes EXACTLY (lib/repStores.ts), so Data
  // Health must too. Clippa matched regardless of case and reported nothing,
  // while a case-sensitive router would still drop the store: the report has
  // to describe what the routes will actually do.
  const r = run([rep({ code: "gau001" })], [store({ repCode: "GAU001" })]);
  eq("a rep code differing only in case IS reported, because routing will not match it", find(r, "stores-unknown-rep").count, 1);
  eq("...and the rep shows as having no stores, which is what routing sees", find(r, "reps-no-stores").count, 1);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ repCode: "" })]);
  eq("a store with NO rep code is not double-counted as an unknown rep", find(r, "stores-unknown-rep").count, 0);
}

console.log("\n--- the report as a whole ---\n");

{
  const r = run([rep({ code: "GAU001" })], [
    store({ repCode: "NW002" }),
    store({ repCode: "" }),
    store({ gpsLat: "", gpsLng: "" }),
    store(),
  ]);
  eq("blocked stores are counted once each, not once per check", r.totals.storesBlocked, 3);
  ok("blocking issues sort above warnings", r.issues[0].severity === "blocking");
  const withRows = r.issues.filter((i) => i.count > 0);
  ok("every reported issue carries its columns", withRows.every((i) => i.columns.length > 0));
  ok("every row has one cell per column", withRows.every((i) => i.rows.every((row) => row.length === i.columns.length)));
  ok("every issue says what to do about it", r.issues.every((i) => i.action.length > 10));
  ok("every issue id is unique", new Set(r.issues.map((i) => i.id)).size === r.issues.length);
  ok("no issue id would break an Excel sheet name", r.issues.every((i) => i.id.length <= 31 && !/[:\\/?*[\]]/.test(i.id)));
}

// ── Closed stores are not a to-do list ──────────────────────────────────
//
// A shut shop is never routed, so a missing rep code on one is a fact rather
// than a fault. Counting them made the blocking list read as 31 stores needing
// attention when 24 were deliberately closed and only 7 were real.
{
  const r = run(
    [rep({ code: "R1" })],
    [
      store({ placeId: "OPEN1", repCode: "GHOST" }),
      store({ placeId: "SHUT1", repCode: "GHOST", closed: true }),
      store({ placeId: "SHUT2", repCode: "", closed: true }),
    ]
  );
  ok("a closed store is not reported as having an unknown rep",
    find(r, "stores-unknown-rep").count === 1,
    `counted ${find(r, "stores-unknown-rep").count}, expected only the open one`);
  ok("a closed store is not reported as having no rep code",
    find(r, "stores-no-rep").count === 0);
  ok("the closed count is stated, not silently subtracted", r.totals.storesClosed === 2);
  ok("totals.stores counts the trading stores only", r.totals.stores === 1);
  ok("a closed store blocks nothing", r.totals.storesBlocked === 1);
  ok("reopening one would return it to the checks",
    run([rep({ code: "R1" })], [store({ placeId: "SHUT1", repCode: "GHOST" })]).totals.storesBlocked === 1,
    "the exclusion must follow the flag, not be baked in");
}



console.log("\n--- a book that cannot fit the hours ---\n");

// The Pretoria five were invisible on every screen in the app: their stores
// look ordinary, their rep records look ordinary, and only the FREQUENCIES
// make the week impossible. These assert the arithmetic that surfaces them.
{
  const HOURS = 8.5;
  const AVAILABLE = HOURS * 20 * 60; // minutes in the four-week cycle

  // Comfortably inside the hours: 40 monthly stores at 30 minutes = 20h.
  const easy = run(
    [rep({ code: "R1", workingHoursPerDay: HOURS })],
    Array.from({ length: 40 }, (_, i) => store({ placeId: `E${i}`, repCode: "R1" }))
  );
  eq("a rep whose book fits is not flagged", find(easy, "rep-book-exceeds-hours").count, 0);

  // The Hester shape: weekly stores at 45 minutes. 200 x 4 x 45 = 600h.
  const hard = run(
    [rep({ code: "R1", workingHoursPerDay: HOURS })],
    Array.from({ length: 200 }, (_, i) =>
      store({ placeId: `H${i}`, repCode: "R1", frequency: "weekly", duration: 45 })
    )
  );
  const flagged = find(hard, "rep-book-exceeds-hours");
  eq("a book that cannot fit IS flagged", flagged.count, 1);
  ok("it is blocking, not advisory", flagged.severity === "blocking", flagged.severity);

  const row = flagged.rows[0];
  // iRam adds a VISIT ROLE column after the name, so everything shifts by one.
  eq("it names the visit role", row[2], "Sales Rep");
  eq("it reports the visits a month", row[4], 800);
  eq("and the calls a day behind them", row[5], 40);
  eq("and counts the stores driving it", row[9], 200);
  ok("it states how far over, not just that it is over", String(row[8]).endsWith("x"), String(row[8]));

  // 🔴 Frequency, not store count, is what this check is about. The same 200
  // stores visited monthly fit easily, and must NOT be flagged — otherwise it
  // just reports 'this rep has a lot of stores', which everybody already knows.
  const sameStoresMonthly = run(
    [rep({ code: "R1", workingHoursPerDay: HOURS })],
    Array.from({ length: 200 }, (_, i) =>
      store({ placeId: `M${i}`, repCode: "R1", frequency: "monthly", duration: 45 })
    )
  );
  eq("the same stores at monthly are not flagged", find(sameStoresMonthly, "rep-book-exceeds-hours").count, 0);

  // A rep's own working hours are honoured, not a hardcoded 8.5.
  const shortDay = run(
    [rep({ code: "R1", workingHoursPerDay: 4 })],
    Array.from({ length: 200 }, (_, i) => store({ placeId: `S${i}`, repCode: "R1", duration: 45 }))
  );
  ok("a shorter working day makes the same book impossible", find(shortDay, "rep-book-exceeds-hours").count === 1);

  // Closed stores are excluded from every check here, and this one too: a shut
  // shop is not work, and counting it would inflate the ratio it reports.
  const withClosed = run(
    [rep({ code: "R1", workingHoursPerDay: HOURS })],
    Array.from({ length: 200 }, (_, i) =>
      store({ placeId: `C${i}`, repCode: "R1", frequency: "weekly", duration: 45, closed: true, closedReason: "manual" })
    )
  );
  eq("a book of CLOSED stores is not flagged", find(withClosed, "rep-book-exceeds-hours").count, 0);

  // A rep with nothing allocated is a different problem, already reported by
  // reps-no-stores. Reporting them twice makes both lists less useful.
  const noStores = run([rep({ code: "R9", workingHoursPerDay: HOURS })], []);
  eq("a rep with no stores is not flagged here", find(noStores, "rep-book-exceeds-hours").count, 0);

  // Worst first, so the row that needs a decision is the one at the top.
  const many = run(
    [rep({ code: "R1", workingHoursPerDay: HOURS }), rep({ code: "R2", email: "b@example.com", workingHoursPerDay: HOURS })],
    [
      ...Array.from({ length: 200 }, (_, i) => store({ placeId: `A${i}`, repCode: "R1", frequency: "weekly", duration: 45 })),
      ...Array.from({ length: 100 }, (_, i) => store({ placeId: `B${i}`, repCode: "R2", frequency: "weekly", duration: 45 })),
    ]
  );
  const sorted = find(many, "rep-book-exceeds-hours");
  eq("both are flagged", sorted.count, 2);
  eq("the worst offender sorts first", sorted.rows[0][0], "R1");

  void AVAILABLE;
}


console.log("\n--- channels nobody calls on ---\n");

// A store in a channel reps never visit is not a data problem. Flagging its
// missing GPS sends somebody to fix a coordinate that will never be driven to,
// and buries the ones that matter.
{
  const CH = [
    { id: "indep", name: "Independent", frequency: "monthly", duration: 30 } as Channel,
    { id: "makro", name: "Makro", frequency: "monthly", duration: 30, notARepChannel: true } as Channel,
  ];

  // Both have unusable coordinates. Only the one a rep visits is a problem.
  const stores = [
    store({ placeId: "A1", channelId: "indep", gpsLat: "", gpsLng: "" }),
    store({ placeId: "M1", channelId: "makro", gpsLat: "", gpsLng: "" }),
  ];

  const r = run([rep({ code: "GAU001" })], stores, CH);
  eq("a blank coordinate is only reported for a store reps visit", find(r, "stores-gps-blank").count, 1);
  eq("and the excluded ones are COUNTED, not silently dropped", r.totals.storesNotCalledOn, 1);
  eq("the store total is what reps actually call on", r.totals.stores, 1);

  // 🔴 The exception has to survive. A manager who excused one Makro branch
  // WANTS a rep there, so its missing coordinate is a real problem again.
  const excused = run([rep({ code: "GAU001" })], stores, CH, [
    {
      id: "o1", storeId: stores[1].id, storeName: "M1", placeId: "M1", channelId: "makro",
      repCode: "GAU001", defaultFrequency: "monthly", defaultDuration: 30,
      frequency: "monthly", duration: 30, approvalStatus: "approved",
      createdBy: "t", createdAt: "", updatedAt: "",
    } as StoreOverride,
  ]);
  eq("an excused store is checked again", find(excused, "stores-gps-blank").count, 2);
  eq("and nothing is reported as excluded", excused.totals.storesNotCalledOn, 0);

  // A pending override is a request, not a decision.
  const pending = run([rep({ code: "GAU001" })], stores, CH, [
    {
      id: "o2", storeId: stores[1].id, storeName: "M1", placeId: "M1", channelId: "makro",
      repCode: "GAU001", defaultFrequency: "monthly", defaultDuration: 30,
      frequency: "monthly", duration: 30, approvalStatus: "pending",
      createdBy: "t", createdAt: "", updatedAt: "",
    } as StoreOverride,
  ]);
  eq("a pending override does not bring the store back", find(pending, "stores-gps-blank").count, 1);
}

console.log("\n--- iRam visit roles ---\n");

// A QC rep's stores are the ones they QC. Clippa's version would report every
// QC rep as "a rep with no stores", because none is anybody's primary rep.
{
  const qc: Rep = { ...rep({ code: "Q1", email: "q@example.com" }), visitRoleId: "qc" };
  const r = run([rep({ code: "R1" }), qc], [store({ repCode: "R1", roleReps: { qc: "Q1" } })]);
  eq("a QC rep with QC stores is NOT a rep with no stores", find(r, "reps-no-stores").count, 0);
  const typo = run([rep({ code: "R1" })], [store({ repCode: "R1", roleReps: { qc: "NOPE" } })]);
  eq("a QC rep code that names nobody is reported", find(typo, "stores-unknown-role-rep").count, 1);
  ok("as a warning, because the sales visit still happens", find(typo, "stores-unknown-role-rep").severity === "warning");
  eq("and the store is not counted as blocked", typo.totals.storesBlocked, 0);
}

// No user-facing text may carry an em dash or mention IMS.
{
  const r = run([rep()], [store()]);
  ok("no check title, summary or action has an em dash",
    r.issues.every((i) => !/—/.test(i.title + i.summary + i.action)));
  ok("no check mentions IMS", r.issues.every((i) => !/IMS/.test(i.title + i.summary + i.action)));
  ok("GPS fixes point at Perigee too", /Perigee/.test(find(r, "stores-gps-blank").action));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
