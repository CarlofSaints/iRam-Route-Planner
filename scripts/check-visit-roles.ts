// Regression check for visit roles. Run with: npx tsx scripts/check-visit-roles.ts
//
// The point of these assertions is that route generation and capacity BOTH read
// through getStoresForRep — if that helper drifts, a rep's planned route stops
// matching their measured utilisation and nothing else would catch it. The
// legacy-rep cases guard the reps that predate visit roles.
import { getStoresForRep, getRoleForRep } from "../lib/repStores";
import { computeCapacity } from "../lib/capacity";
import { computeOutliers } from "../lib/outliers";
import { DEFAULT_VISIT_ROLES, Rep, Store } from "../lib/types";

const roles = DEFAULT_VISIT_ROLES;

const mkRep = (code: string, visitRoleId?: string): Rep => ({
  id: code, code, name: `Rep ${code}`, email: "", cell: "",
  homeAddress: "", homeGpsLat: "-26.0", homeGpsLng: "28.0", teamId: "",
  ...(visitRoleId ? { visitRoleId } : {}),
});

const mkStore = (id: string, repCode: string, extra: Partial<Store> = {}): Store => ({
  id, placeId: id, name: `Store ${id}`, channelId: "retail", repCode,
  gpsLat: "-26.0", gpsLng: "28.0", monthlySales: 0,
  frequency: "weekly", duration: 30, dayOfWeek: "", weekNumber: "", ...extra,
});

const sales = mkRep("R01");                 // legacy rep, no visitRoleId
const qc = mkRep("Q01", "qc");
const trainer = mkRep("T01", "training");

const stores: Store[] = [
  mkStore("s1", "R01", { repCode2: "Q01" }),
  mkStore("s2", "R01", { repCode2: "Q01", repCode3: "T01" }),
  mkStore("s3", "R01"),
  mkStore("s4", "R99", { repCode3: "Q01" }),   // QC on a store that isn't R01's
  mkStore("s5", "R01", { gpsLat: "-33.9", gpsLng: "18.4", repCode2: "Q01" }), // far away
];

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got ${JSON.stringify(actual)}  want ${JSON.stringify(expected)}`);
};

check("legacy rep -> primary role", getRoleForRep(sales, roles).id, "sales");
check("qc rep -> qc role", getRoleForRep(qc, roles).id, "qc");

const salesStores = getStoresForRep(sales, stores, getRoleForRep(sales, roles));
check("primary store ids", salesStores.map((s) => s.id), ["s1", "s2", "s3", "s5"]);
check("primary keeps store frequency", salesStores[0].frequency, "weekly");
check("primary keeps store duration", salesStores[0].duration, 30);

const qcStores = getStoresForRep(qc, stores, getRoleForRep(qc, roles));
check("qc store ids (2nd + 3rd slots)", qcStores.map((s) => s.id), ["s1", "s2", "s4", "s5"]);
check("qc frequency overridden", qcStores[0].frequency, "quarterly");
check("qc duration overridden", qcStores[0].duration, 60);
check("source store untouched", stores[0].frequency, "weekly");
check("trainer store ids", getStoresForRep(trainer, stores, getRoleForRep(trainer, roles)).map((s) => s.id), ["s2"]);

const cap = computeCapacity([sales, qc], stores, null, roles);
const capSales = cap.reps.find((r) => r.repCode === "R01")!;
const capQc = cap.reps.find((r) => r.repCode === "Q01")!;
check("sales store count", capSales.storeCount, 4);
check("sales calls/mo (weekly x4)", capSales.callsPerMonth, 16);
check("qc store count", capQc.storeCount, 4);
check("qc calls/mo (quarterly x4)", capQc.callsPerMonth, 1);
check("qc role name surfaced", capQc.visitRoleName, "QC");

const out = computeOutliers([sales, qc], stores, 150, roles);
check("sales rep flagged for far store", out.perRep["R01"], 1);
check("qc rep not flagged at all", out.perRep["Q01"], undefined);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
