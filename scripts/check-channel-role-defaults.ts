/**
 * Per-channel, per-role call defaults.
 *
 * A QC call on a Makro is not the same length as a QC call on a Mica, but every
 * non-primary role used to call on EVERY channel at one rhythm — the role's own
 * frequency and duration. Channels can now override that per role.
 *
 * The load-bearing rule is the fallback: an unset channel must behave exactly as
 * it did before this existed, otherwise shipping it would silently re-plan every
 * QC and Training route.
 *
 * Run: npx tsx scripts/check-channel-role-defaults.ts
 */
import { resolveRoleDefault, getStoresForRep, getRoleForRep } from "../lib/repStores";
import { Channel, Rep, Store, VisitRole, FrequencyType } from "../lib/types";
import { computeCapacity } from "../lib/capacity";

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

const ROLES: VisitRole[] = [
  { id: "sales", name: "Sales Rep", frequency: "monthly", duration: 30, isPrimary: true, checkOutliers: true },
  { id: "qc", name: "QC", frequency: "quarterly", duration: 60, isPrimary: false, checkOutliers: false },
  { id: "training", name: "Training", frequency: "bimonthly", duration: 90, isPrimary: false, checkOutliers: false },
];
const [SALES, QC, TRAINING] = ROLES;

// Makro overrides QC only. Mica overrides nothing. Bex overrides both.
const CHANNELS: Channel[] = [
  {
    id: "makro",
    name: "Makro",
    frequency: "weekly",
    duration: 120,
    roleDefaults: { qc: { frequency: "monthly", duration: 240 } },
  },
  { id: "mica", name: "Mica", frequency: "monthly", duration: 45 },
  {
    id: "bex",
    name: "Bex",
    frequency: "2x_monthly",
    duration: 60,
    roleDefaults: {
      qc: { frequency: "bimonthly", duration: 30 },
      training: { frequency: "quarterly", duration: 15 },
    },
  },
];
const byId = new Map(CHANNELS.map((c) => [c.id, c]));

console.log("Channel x role defaults\n");

// ---- resolveRoleDefault ----
check("primary reads the channel's own values", resolveRoleDefault(byId.get("makro"), SALES), {
  frequency: "weekly",
  duration: 120,
});
check("primary ignores roleDefaults entirely", resolveRoleDefault(byId.get("bex"), SALES), {
  frequency: "2x_monthly",
  duration: 60,
});
check("QC uses the channel override where set", resolveRoleDefault(byId.get("makro"), QC), {
  frequency: "monthly",
  duration: 240,
});
check("QC falls back to its own role default when unset", resolveRoleDefault(byId.get("mica"), QC), {
  frequency: "quarterly",
  duration: 60,
});
check("Training falls back on a channel that only overrides QC", resolveRoleDefault(byId.get("makro"), TRAINING), {
  frequency: "bimonthly",
  duration: 90,
});
check("a channel can override two roles independently", [
  resolveRoleDefault(byId.get("bex"), QC),
  resolveRoleDefault(byId.get("bex"), TRAINING),
], [
  { frequency: "bimonthly", duration: 30 },
  { frequency: "quarterly", duration: 15 },
]);
check("an unknown channel falls back to the role", resolveRoleDefault(undefined, QC), {
  frequency: "quarterly",
  duration: 60,
});
check("an unknown channel falls back to the role for primary too", resolveRoleDefault(undefined, SALES), {
  frequency: "monthly",
  duration: 30,
});

// ---- getStoresForRep ----
const store = (id: string, channelId: string, freq: FrequencyType, dur: number): Store => ({
  id,
  placeId: id,
  name: id.toUpperCase(),
  channelId,
  repCode: "P1",
  repCode2: "Q1",
  gpsLat: "-26.1",
  gpsLng: "28.0",
  monthlySales: 0,
  frequency: freq,
  duration: dur,
  dayOfWeek: "",
  weekNumber: "",
});

const STORES = [
  store("s1", "makro", "weekly", 120),
  store("s2", "mica", "monthly", 45),
  store("s3", "bex", "2x_monthly", 60),
];

const primaryRep: Rep = {
  id: "p", code: "P1", name: "Primary", email: "", cell: "",
  homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId: "",
};
const qcRep: Rep = { ...primaryRep, id: "q", code: "Q1", name: "QC Person", visitRoleId: "qc" };

const primaryStores = getStoresForRep(primaryRep, STORES, SALES, null, CHANNELS);
check(
  "primary rep still gets the store's own stored values",
  primaryStores.map((s) => [s.frequency, s.duration]),
  [["weekly", 120], ["monthly", 45], ["2x_monthly", 60]]
);

const qcStores = getStoresForRep(qcRep, STORES, QC, null, CHANNELS);
check(
  "QC rep gets per-channel values: override, fallback, override",
  qcStores.map((s) => [s.channelId, s.frequency, s.duration]),
  [["makro", "monthly", 240], ["mica", "quarterly", 60], ["bex", "bimonthly", 30]]
);

// THE regression guard: no channels passed = old behaviour, everywhere.
const qcNoChannels = getStoresForRep(qcRep, STORES, QC);
check(
  "with no channels supplied, every store uses the role's own rhythm (pre-feature behaviour)",
  qcNoChannels.map((s) => [s.frequency, s.duration]),
  [["quarterly", 60], ["quarterly", 60], ["quarterly", 60]]
);

const qcEmptyDefaults = getStoresForRep(
  qcRep,
  STORES,
  QC,
  null,
  CHANNELS.map((c) => ({ ...c, roleDefaults: undefined }))
);
check(
  "channels with no roleDefaults are identical to pre-feature behaviour",
  qcEmptyDefaults.map((s) => [s.frequency, s.duration]),
  [["quarterly", 60], ["quarterly", 60], ["quarterly", 60]]
);

check("copies are returned — the stored stores are untouched",
  STORES.map((s) => [s.frequency, s.duration]),
  [["weekly", 120], ["monthly", 45], ["2x_monthly", 60]]
);

// ---- capacity reads through the same resolver ----
//
// Capacity measures scheduled hours off a generated plan, so with no plan the
// only demand figure it exposes is callsPerMonth. That is enough to prove the
// per-channel FREQUENCY reaches it: Makro QC is monthly (1.0), Mica falls back
// to quarterly (0.333), Bex is bimonthly (0.5) = 1.83, rounded to 2.
const qcRow = computeCapacity([qcRep], STORES, null, ROLES, CHANNELS).reps.find(
  (r) => r.repCode === "Q1"
)!;
check("capacity counts QC calls on the per-channel frequencies", qcRow.callsPerMonth, 2);
check("capacity labels the role", qcRow.visitRoleName, "QC");
check("capacity still sees all three stores", qcRow.storeCount, 3);

// Pre-feature: all three at quarterly (0.333 each) = 1.0, rounds to 1.
const qcRowNoChannels = computeCapacity([qcRep], STORES, null, ROLES).reps.find(
  (r) => r.repCode === "Q1"
)!;
check("capacity without channels matches pre-feature behaviour", qcRowNoChannels.callsPerMonth, 1);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
