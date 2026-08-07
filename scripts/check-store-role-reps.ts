/**
 * One rep slot per visit role on a store (`Store.roleReps`).
 *
 * The old model gave a store two fixed extra slots, repCode2 and repCode3.
 * Two slots cannot hold three non-primary roles, and neither slot said WHICH
 * role it was for — the role came from whoever was put in it, so the same
 * column meant something different on every row.
 *
 * The load-bearing rule is the migration one: a store that predates roleReps
 * has none, and for those the old slots must still be read exactly as before,
 * or every existing assignment silently disappears from routes and capacity.
 *
 * Run: npx tsx scripts/check-store-role-reps.ts
 */
import { storeRepForRole, storeHasRepInRole, getStoresForRep } from "../lib/repStores";
import { Rep, Store, VisitRole, Channel, storeRoleColumns } from "../lib/types";

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
const ROAMER: VisitRole = { id: "roaming_merchandiser", name: "Roaming Merchandiser", frequency: "3x_weekly", duration: 90, isPrimary: false, checkOutliers: false };
const RVL: VisitRole = { id: "rvl_supervisor", name: "RVL Rep", frequency: "monthly", duration: 220, isPrimary: false, checkOutliers: false };

const CHANNELS: Channel[] = [{ id: "makro", name: "Makro", frequency: "weekly", duration: 120 }];

const rep = (code: string, visitRoleId?: string): Rep => ({
  id: code, code, name: code, email: "", cell: "",
  homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId: "",
  ...(visitRoleId ? { visitRoleId } : {}),
});

const store = (id: string, extra: Partial<Store>): Store => ({
  id, placeId: id, name: id, channelId: "makro", repCode: "P1",
  gpsLat: "-26.1", gpsLng: "28.0", monthlySales: 0,
  frequency: "weekly", duration: 120, dayOfWeek: "", weekNumber: "",
  ...extra,
});

console.log("Store: one rep slot per visit role\n");

// ---- column naming, shared by template / upload / export ----
check("a role's two column names", storeRoleColumns(LEADER), {
  id: "TEAM LEADER ID",
  name: "TEAM LEADER NAME",
});
check("renaming the role renames its columns", storeRoleColumns({ ...RVL, name: "Reverse Logistics" }).id, "REVERSE LOGISTICS ID");

// ---- THE headline capability: all three roles on one store ----
const allThree = store("s1", {
  roleReps: { training: "L1", roaming_merchandiser: "M1", rvl_supervisor: "V1" },
});
check("a store can carry every non-primary role at once", [
  storeRepForRole(allThree, LEADER),
  storeRepForRole(allThree, ROAMER),
  storeRepForRole(allThree, RVL),
], ["L1", "M1", "V1"]);
check("the primary still comes from repCode", storeRepForRole(allThree, SALES), "P1");
check("a role nobody performs here is empty", storeRepForRole(store("s2", { roleReps: {} }), LEADER), "");

// ---- the migration guard ----
const legacy2 = store("old1", { repCode2: "X1" });
const legacy3 = store("old2", { repCode3: "Y1" });
const legacyBoth = store("old3", { repCode2: "X1", repCode3: "Y1" });

check("an unmigrated store still matches its second slot", storeHasRepInRole(legacy2, rep("X1", "training"), LEADER), true);
check("an unmigrated store still matches its THIRD slot", storeHasRepInRole(legacy3, rep("Y1", "training"), LEADER), true);
check("both old slots still count on one store", [
  storeHasRepInRole(legacyBoth, rep("X1"), LEADER),
  storeHasRepInRole(legacyBoth, rep("Y1"), LEADER),
], [true, true]);
check("someone not in either slot does not match", storeHasRepInRole(legacyBoth, rep("Z9"), LEADER), false);

// Once roleReps exists it is the only thing read — otherwise a store would be
// assignable from two places at once and the two would drift.
const migrated = store("mixed", { repCode2: "X1", roleReps: { training: "L1" } });
check("roleReps wins outright over the old slots", [
  storeHasRepInRole(migrated, rep("L1"), LEADER),
  storeHasRepInRole(migrated, rep("X1"), LEADER),
], [true, false]);
check("an EMPTY roleReps means nobody, not fall back", storeHasRepInRole(store("m2", { repCode2: "X1", roleReps: {} }), rep("X1"), LEADER), false);

// ---- routing and capacity read through this ----
const STORES = [
  store("a", { roleReps: { training: "L1" } }),
  store("b", { roleReps: { roaming_merchandiser: "M1" } }),
  store("c", { roleReps: { training: "L1", rvl_supervisor: "V1" } }),
];

check(
  "the Team Leader gets only the stores where they are the Team Leader",
  getStoresForRep(rep("L1", "training"), STORES, LEADER, null, CHANNELS).map((s) => s.id),
  ["a", "c"]
);
check(
  "a role's rep does not pick up another role's stores",
  getStoresForRep(rep("M1", "roaming_merchandiser"), STORES, ROAMER, null, CHANNELS).map((s) => s.id),
  ["b"]
);
check(
  "one store can appear on two different roles' routes",
  getStoresForRep(rep("V1", "rvl_supervisor"), STORES, RVL, null, CHANNELS).map((s) => s.id),
  ["c"]
);
check(
  "the primary rep is untouched by any of it",
  getStoresForRep(rep("P1"), STORES, SALES, null, CHANNELS).map((s) => s.id),
  ["a", "b", "c"]
);

// The same person can hold two roles' slots on paper, but their Rep record
// decides how they are planned — role is on the PERSON, Carl's 3 Aug decision.
const doubled = store("d", { roleReps: { training: "L1", rvl_supervisor: "L1" } });
check("one person listed under two roles matches both slots", [
  storeHasRepInRole(doubled, rep("L1", "training"), LEADER),
  storeHasRepInRole(doubled, rep("L1", "training"), RVL),
], [true, true]);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
