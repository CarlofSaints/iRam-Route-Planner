/**
 * Assertions for "why is this store not in the cycle".
 *
 * Run: npx tsx scripts/check-not-in-cycle.ts
 *
 * Every reason here sends somebody to do something different: allocate a rep,
 * fix a coordinate, confirm an outlier, or nothing at all.
 *
 * Ported from Clippa, plus the iRam cases: only SALES plans count as "in the
 * cycle", a store with no rep is its own reason, and Channel Dedicated drops
 * stores outside a rep's channels. The cases that
 * matter most are the ones where the wrong label sends them to the wrong place,
 * and the ones where a store is quietly counted as missing when it is not.
 */

import {
  filterNotInCycle,
  findNotInCycle,
  isCorrectlyOut,
  reasonCountsFor,
  REASONS,
  type NotInCycleReason,
} from "../lib/notInCycle";
import type {
  Channel,
  Rep,
  RoutePlanDocument,
  RouteDayPlan,
  Store,
  StoreOverride,
} from "../lib/types";
import { DEFAULT_VISIT_ROLES } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  - ${detail}` : ""}`);
  }
}

function store(id: string, over: Partial<Store> = {}): Store {
  return {
    id,
    placeId: id,
    name: `Store ${id}`,
    channelId: "spar",
    repCode: "R1",
    gpsLat: "-26.1",
    gpsLng: "28.0",
    monthlySales: 0,
    frequency: "monthly",
    duration: 30,
    dayOfWeek: "",
    weekNumber: "",
    ...over,
  } as Store;
}

const channels: Channel[] = [
  { id: "spar", name: "SPAR", frequency: "monthly", duration: 30 } as Channel,
  { id: "wholesale", name: "Wholesale", frequency: "monthly", duration: 30, notARepChannel: true } as Channel,
];

function day(stopIds: string[]): RouteDayPlan {
  return {
    day: "Monday",
    week: "Wk1",
    stops: stopIds.map((id, i) => ({
      storeId: id,
      storeName: `Store ${id}`,
      lat: -26.1,
      lng: 28.0,
      visitDuration: 30,
      travelTimeFromPrev: 10,
      distanceFromPrev: 5,
      arrivalTime: "08:00",
      departureTime: "08:30",
      sequence: i + 1,
    })),
    totalTravelTime: 10,
    totalVisitTime: 30,
    totalTime: 40,
    totalDistance: 5,
    overCapacity: false,
  };
}

function doc(
  days: RouteDayPlan[],
  unassigned: { storeId: string; storeName: string; reason: string }[] = []
): RoutePlanDocument {
  return {
    generatedAt: "2026-09-22T00:00:00.000Z",
    repPlans: [
      {
        repCode: "R1",
        repName: "Test Rep",
        homeLatLng: { lat: -26, lng: 28 },
        workingHoursPerDay: 8.5,
        generatedAt: "2026-09-22T00:00:00.000Z",
        days,
        stats: { totalStores: 0, unassignedStores: unassigned },
      },
    ],
  } as RoutePlanDocument;
}

const rep = (code: string, extra: Partial<Rep> = {}): Rep => ({
  id: code, code, name: code, email: "", cell: "", homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId: "", ...extra,
});
const reps = [rep("R1"), rep("R2"), rep("Q1", { visitRoleId: "qc" })];
const base = { channels, reps, visitRoles: DEFAULT_VISIT_ROLES, overrides: [] as StoreOverride[] };

// ── Each reason lands on the right store ──────────────────────────────────
{
  const stores = [
    store("visited"),
    store("target"),
    store("capacity"),
    store("range"),
    store("gps", { gpsLat: "0", gpsLng: "0" }),
    store("shut", { closed: true }),
    store("nochannel", { channelId: "wholesale" }),
    store("brandnew"),
  ];
  const routes = doc(
    [day(["visited"])],
    [
      { storeId: "target", storeName: "Store target", reason: "Over the 8 calls per day target" },
      { storeId: "capacity", storeName: "Store capacity", reason: "Over daily capacity" },
      { storeId: "range", storeName: "Store range", reason: "Out of range (509 km from rep's area) — confirm to include" },
      { storeId: "gps", storeName: "Store gps", reason: "Missing or invalid GPS coordinates" },
    ]
  );
  const r = findNotInCycle({ ...base, stores, routes });

  const expected: [string, NotInCycleReason][] = [
    ["target", "over_target"],
    ["capacity", "over_capacity"],
    ["range", "out_of_range"],
    ["gps", "bad_gps"],
    ["shut", "closed"],
    ["nochannel", "channel_not_called_on"],
    ["brandnew", "not_in_plan"],
  ];
  for (const [id, reason] of expected) {
    ok(`${id} reads as ${reason}`, r.reasonOf.get(id) === reason, `got ${r.reasonOf.get(id)}`);
  }

  ok("a visited store is not reported as missing", !r.reasonOf.has("visited"));
  ok("the visited store is counted as scheduled", r.scheduled === 1, String(r.scheduled));
  ok("the denominator is every store of the rep's", r.totalStores === 8, String(r.totalStores));
  ok("seven stores are missing", r.missing.length === 7, String(r.missing.length));

  // 🔴 A store with no usable coordinate cannot be drawn, so the panel has to
  // say so or it counts more than the map shows.
  ok("the store with no coordinate is counted as un-plottable", r.notPlottable === 1, String(r.notPlottable));

  // Ranked: what can be acted on comes before what is correctly out.
  const ranks = r.missing.map((m) => REASONS[m.reason].rank);
  ok("the list is ordered by what a manager can act on", ranks.every((v, i) => i === 0 || ranks[i - 1] <= v), ranks.join(","));

  ok(
    "closed and channel-not-called-on are the two that are correctly out",
    isCorrectlyOut("closed") && isCorrectlyOut("channel_not_called_on") &&
      !isCorrectlyOut("over_target") && !isCorrectlyOut("not_in_plan")
  );
}

// ── 🔴 A foreign coordinate is BROKEN, not distant ────────────────────────
// Ten live stores carry one, every case a store name geocoded without a
// country: "BUILD IT MONTANA" in Montana USA, "PICK N PAY FAMILY BUSY CORNER"
// in San Francisco. The outlier check calls that "out of range — confirm to
// include", which offers a button that would put San Francisco on a Gauteng
// rep's Tuesday.
{
  const stores = [
    store("montana", { gpsLat: "46.879682", gpsLng: "-110.362566" }),
    store("sanfran", { gpsLat: "37.788982", gpsLng: "-122.398301" }),
    store("joburg", { gpsLat: "-26.1075", gpsLng: "28.0567" }),
  ];
  const routes = doc([], [
    { storeId: "montana", storeName: "m", reason: "Out of range (15699 km from rep's area) — confirm to include" },
    { storeId: "sanfran", storeName: "s", reason: "Out of range (16952 km from rep's area) — confirm to include" },
    { storeId: "joburg", storeName: "j", reason: "Out of range (45 km from rep's area) — confirm to include" },
  ]);
  const r = findNotInCycle({ ...base, stores, routes });
  ok("a Montana coordinate reads as an unusable coordinate",
    r.reasonOf.get("montana") === "bad_gps", String(r.reasonOf.get("montana")));
  ok("so does a San Francisco one",
    r.reasonOf.get("sanfran") === "bad_gps", String(r.reasonOf.get("sanfran")));
  ok("🔴 and neither is offered as 'confirm to include'",
    r.reasonOf.get("montana") !== "out_of_range" && r.reasonOf.get("sanfran") !== "out_of_range");
  ok("a genuinely distant SOUTH AFRICAN store is still a real outlier",
    r.reasonOf.get("joburg") === "out_of_range", String(r.reasonOf.get("joburg")));
  ok("and the broken ones are counted as un-plottable",
    r.notPlottable === 2, String(r.notPlottable));
}

// ── Closure beats whatever the router said ────────────────────────────────
// A shut shop reported as "over the calls-per-day target" would send somebody
// to raise a target that was never the problem.
{
  const stores = [store("shut", { closed: true })];
  const routes = doc([], [{ storeId: "shut", storeName: "Store shut", reason: "Over the 8 calls per day target" }]);
  const r = findNotInCycle({ ...base, stores, routes });
  ok("a closed store is reported as closed, not as a target drop", r.reasonOf.get("shut") === "closed", String(r.reasonOf.get("shut")));
}

// ── An approved override keeps a store in a non-rep channel ───────────────
{
  const stores = [store("excused", { channelId: "wholesale" })];
  const overrides = [{ storeId: "excused", approvalStatus: "approved" }] as StoreOverride[];
  const routes = doc([], [{ storeId: "excused", storeName: "Store excused", reason: "Over daily capacity" }]);
  const r = findNotInCycle({ ...base, overrides, stores, routes });
  ok(
    "an excused store is NOT blamed on its channel",
    r.reasonOf.get("excused") === "over_capacity",
    String(r.reasonOf.get("excused"))
  );
  const without = findNotInCycle({ ...base, stores, routes });
  ok(
    "without the override the same store IS its channel's fault",
    without.reasonOf.get("excused") === "channel_not_called_on",
    String(without.reasonOf.get("excused"))
  );
}

// ── A store visited in ANY week is in the cycle ───────────────────────────
// 🔴 The bug this must never have: `unassignedStores` holds one entry per
// dropped VISIT, so a weekly store dropped from Wk3 appears there while still
// being visited in Wk1. It is in the cycle.
{
  const stores = [store("weekly")];
  const routes = doc(
    [{ ...day(["weekly"]), week: "Wk1" }],
    [{ storeId: "weekly", storeName: "Store weekly", reason: "Over the 8 calls per day target" }]
  );
  const r = findNotInCycle({ ...base, stores, routes });
  ok("a store dropped from one week but kept in another is IN the cycle", !r.reasonOf.has("weekly"));
  ok("and it counts as scheduled", r.scheduled === 1, String(r.scheduled));
  ok("and nothing is reported as missing", r.missing.length === 0, String(r.missing.length));
}

// ── Scoping ───────────────────────────────────────────────────────────────
{
  const stores = [store("mine"), store("theirs", { repCode: "R2" })];
  const routes = doc([]);
  const mine = findNotInCycle({ ...base, stores, routes, repCode: "R1" });
  ok("another rep's store is not counted against this rep", mine.totalStores === 1 && !mine.reasonOf.has("theirs"));

  const scoped = findNotInCycle({ ...base, stores, routes, visibleRepCodes: new Set(["R2"]) });
  ok("a user who may not see a rep is not shown their gaps", scoped.totalStores === 1 && !scoped.reasonOf.has("mine"));
}

// ── No plan at all ────────────────────────────────────────────────────────
// Every store is missing, and every one of them for the honest reason: there is
// nothing to be in. Never "over the calls-per-day target".
{
  const stores = [store("a"), store("b")];
  const r = findNotInCycle({ ...base, stores, routes: null });
  ok("with no plan, every store is missing", r.missing.length === 2);
  ok(
    "with no plan, nothing is blamed on a routing decision",
    r.missing.every((m) => m.reason === "not_in_plan"),
    r.missing.map((m) => m.reason).join(",")
  );
  ok("with no plan, nothing counts as scheduled", r.scheduled === 0);
}

// ── iRam: only the SALES plan puts a store in the cycle ─────────────────────
// A QC rep calling on a store every quarter does not mean a sales rep goes.
{
  const stores = [store("qconly", { roleReps: { qc: "Q1" } })];
  const routes = {
    generatedAt: "2026-10-01T00:00:00.000Z",
    repPlans: [
      {
        repCode: "Q1", repName: "QC", visitRoleId: "qc", homeLatLng: null, workingHoursPerDay: 8.5,
        generatedAt: "2026-10-01T00:00:00.000Z", days: [day(["qconly"])], stats: { totalStores: 1, unassignedStores: [] },
      },
    ],
  } as unknown as RoutePlanDocument;
  const r = findNotInCycle({ ...base, stores, routes });
  ok("a store only a QC plan visits is NOT in the sales cycle", r.reasonOf.get("qconly") === "not_in_plan", String(r.reasonOf.get("qconly")));
  ok("a plan with no visitRoleId (made before roles) counts as sales",
    findNotInCycle({ ...base, stores, routes: doc([day(["qconly"])]) }).scheduled === 1);
}

// ── iRam: a store no rep owns says so ───────────────────────────────────────
{
  const stores = [store("blank", { repCode: "" }), store("ghost", { repCode: "NOBODY" })];
  const r = findNotInCycle({ ...base, stores, routes: doc([]) });
  ok("a blank rep code reads as no rep", r.reasonOf.get("blank") === "no_rep", String(r.reasonOf.get("blank")));
  ok("a rep code that names nobody reads as no rep", r.reasonOf.get("ghost") === "no_rep", String(r.reasonOf.get("ghost")));
  // Closure still wins: a shut shop with no rep needs nobody allocated.
  const shut = findNotInCycle({ ...base, stores: [store("x", { repCode: "", closed: true })], routes: doc([]) });
  ok("a closed store with no rep reads as closed", shut.reasonOf.get("x") === "closed");
}

// ── iRam: Channel Dedicated drops stores outside the rep's channels ─────────
{
  const dedicatedReps = [rep("R1", { assignedChannels: ["other"] })];
  const stores = [store("offchannel")];
  const r = findNotInCycle({ ...base, reps: dedicatedReps, strategy: "channel_dedicated", stores, routes: doc([]) });
  ok("a store outside the rep's assigned channels says so", r.reasonOf.get("offchannel") === "outside_assigned_channels", String(r.reasonOf.get("offchannel")));
  const geo = findNotInCycle({ ...base, reps: dedicatedReps, strategy: "geography", stores, routes: doc([]) });
  ok("under Geography the same store is just not in the plan", geo.reasonOf.get("offchannel") === "not_in_plan");
  const unassigned = findNotInCycle({ ...base, reps: [rep("R1")], strategy: "channel_dedicated", stores, routes: doc([]) });
  ok("a rep with no assigned channels covers every channel", unassigned.reasonOf.get("offchannel") === "not_in_plan");
}

// ── iRam: the export wording points at Perigee and has no em dashes ─────────
{
  ok("a missing coordinate says to fix it in Perigee too", /Perigee/.test(REASONS.bad_gps.fixIn));
  ok("a missing rep says to allocate it in Perigee", /Perigee/.test(REASONS.no_rep.fixIn));
  ok("no reason text mentions IMS", Object.values(REASONS).every((p) => !/IMS/.test(p.label + p.fixIn + (p.action ?? ""))));
  ok("no reason text carries an em dash", Object.values(REASONS).every((p) => !/—/.test(p.label + p.fixIn + (p.action ?? ""))));
}

// ── Every reason can be rendered ──────────────────────────────────────────
for (const key of Object.keys(REASONS) as NotInCycleReason[]) {
  const p = REASONS[key];
  ok(`${key} has a label`, p.label.length > 0);
  ok(`${key} has a colour`, /^#[0-9A-Fa-f]{6}$/.test(p.colour));
  // The two that are correctly out are the only ones with nothing to do.
  ok(
    `${key} offers an action exactly when there is one`,
    isCorrectlyOut(key) ? p.action === null : typeof p.action === "string" && p.action.length > 0
  );
}

// ── The Reason dropdown counts what the OTHER filters leave ────────────────
// It counted the unfiltered result, so "Closed (1)" was offered under "Open
// only" and opened on an empty list.
{
  const stores = [store("a"), store("b", { closed: true }), store("c", { gpsLat: "", gpsLng: "" })];
  const r = findNotInCycle({ ...base, stores, routes: null });
  const open = reasonCountsFor(r, reps, { status: "open" });
  const all = reasonCountsFor(r, reps, { status: "all" });
  ok("under Open only, no closed store is counted", open.closed === 0, JSON.stringify(open));
  ok("under Open and closed, the closed store is counted", all.closed === 1, JSON.stringify(all));
  const shown = filterNotInCycle(r, reps, { status: "open" }).length;
  const summed = Object.values(open).reduce((a, n) => a + n, 0);
  ok("the counts add up to the rows the other filters show", summed === shown, `${summed} vs ${shown}`);
  ok("a picked reason does not zero the other reasons' counts",
    reasonCountsFor(r, reps, { status: "all", reason: "closed" }).closed === 1 && summed > 0);
}

// ── The page: Team Admins are scoped, and Save GPS stores the parsed numbers ──
{
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const page = fs.readFileSync(path.join(__dirname, "..", "app", "not-in-cycle", "page.tsx"), "utf8");
  ok("the page scopes by isTeamRole, so a Team Admin sees only their team", /isTeamRole\(session\?\.role\)/.test(page));
  ok("the page never tests the one spelling teamManager", !/role === "teamManager"/.test(page));
  ok("Save GPS sends the validated numbers, not the box text",
    /onSave=\{\(lat, lng\) => saveGps\(r\.store\.id, lat, lng\)\}/.test(page) && !/gpsLat: edit\.lat/.test(page));
  ok("the reason dropdown counts follow the other filters", /reasonCounts\[r\]/.test(page) && !/result\.counts\[r\]/.test(page));
  const entry = fs.readFileSync(path.join(__dirname, "..", "components", "CoordinateEntry.tsx"), "utf8");
  ok("CoordinateEntry hands its validated numbers to onSave", /onSave\(check\.lat!, check\.lng!\)/.test(entry));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
