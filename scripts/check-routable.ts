/**
 * Assertions for which stores a rep may be sent to.
 *
 * Run: npx tsx scripts/check-routable.ts
 *
 * Three rules compose here — closed, channel, override — and the ones that
 * matter most are where they DISAGREE: a shut store in a rep channel, an open
 * store in an excluded channel, and the single store a manager has excused from
 * that exclusion. Getting the last one wrong silently strands the exception
 * a manager made on purpose.
 *
 * Ported from Clippa; the sub-channel section is replaced by iRam visit roles.
 */

import {
  isRepChannel,
  approvedOverrideStoreIds,
  routableStores,
  countExclusions,
  exclusionReason,
  storeCountsByChannel,
  switchOffImpact,
  switchOffSentence,
  channelsStillHoldingStores,
  describeCalledOnChanges,
  describeCalledOnChange,
} from "../lib/routable";
import type { Channel, Rep, Store, StoreOverride } from "../lib/types";
import { DEFAULT_VISIT_ROLES } from "../lib/types";
import { getStoresForRep } from "../lib/repStores";

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
const eq = (label: string, actual: unknown, expected: unknown) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const channel = (id: string, o: Partial<Channel> = {}): Channel => ({
  id,
  name: o.name ?? id,
  frequency: o.frequency ?? "monthly",
  duration: o.duration ?? 30,
  ...(o.notARepChannel !== undefined ? { notARepChannel: o.notARepChannel } : {}),
});

const store = (id: string, channelId: string, o: Partial<Store> = {}): Store => ({
  id,
  placeId: id,
  name: `Store ${id}`,
  channelId,
  repCode: o.repCode ?? "R1",
  gpsLat: "-26",
  gpsLng: "28",
  monthlySales: 0,
  frequency: "monthly",
  duration: 30,
  dayOfWeek: "",
  weekNumber: "",
  ...o,
});

const override = (storeId: string, status: "pending" | "approved"): StoreOverride => ({
  id: `o-${storeId}`,
  storeId,
  storeName: `Store ${storeId}`,
  placeId: storeId,
  channelId: "makro",
  repCode: "R1",
  defaultFrequency: "monthly",
  defaultDuration: 30,
  frequency: "weekly",
  duration: 45,
  approvalStatus: status,
  createdBy: "test",
  createdAt: "",
  updatedAt: "",
});

const CHANNELS = [channel("indep"), channel("makro", { notARepChannel: true })];

// ── The flag reads the safe way round ───────────────────────────────────────
{
  // 🔴 Absent means a rep channel. Every channel in the live app predates this
  // field; if absence excluded them, shipping it would empty every call cycle.
  ok("a channel with no flag is called on", isRepChannel(channel("c")));
  ok("an explicit false is called on", isRepChannel(channel("c", { notARepChannel: false })));
  ok("only an explicit true excludes", !isRepChannel(channel("c", { notARepChannel: true })));
  // A store whose channel was deleted must keep being visited rather than
  // silently vanish from every route.
  ok("an unknown channel is called on", isRepChannel(undefined));
}

// ── Only an APPROVED override excuses a store ───────────────────────────────
{
  const ids = approvedOverrideStoreIds([override("a", "approved"), override("b", "pending")]);
  ok("an approved override counts", ids.has("a"));
  // Otherwise anyone who can raise an override can undo a channel exclusion for
  // themselves, without a manager ever seeing it.
  ok("a PENDING override does not", !ids.has("b"), "pending must not excuse a store");
}

// ── The three rules together ────────────────────────────────────────────────
{
  const stores = [
    store("open-indep", "indep"),
    store("shut-indep", "indep", { closed: true, closedReason: "manual" }),
    store("open-makro", "makro"),
    store("excused-makro", "makro"),
    store("pending-makro", "makro"),
    store("shut-makro", "makro", { closed: true, closedReason: "manual" }),
  ];
  const overrides = [override("excused-makro", "approved"), override("pending-makro", "pending")];

  const routable = routableStores({ stores, channels: CHANNELS, overrides }).map((s) => s.id).sort();
  eq("only the open, called-on and excused stores route", routable, ["excused-makro", "open-indep"]);

  const byId = new Map(CHANNELS.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);
  eq("an ordinary store has no reason", exclusionReason(stores[0], byId, excused), null);
  eq("a shut store says closed", exclusionReason(stores[1], byId, excused), "closed");
  eq("an excluded channel says so", exclusionReason(stores[2], byId, excused), "channel_not_called_on");
  eq("an excused store has no reason", exclusionReason(stores[3], byId, excused), null);
  eq("a pending override does not excuse", exclusionReason(stores[4], byId, excused), "channel_not_called_on");

  // 🔴 Closure wins over the channel. Reporting a shut store as a channel
  // problem sends somebody to fix the wrong thing — and un-excluding the
  // channel would not bring it back, because it is still shut.
  eq("a shut store in an excluded channel reads as closed", exclusionReason(stores[5], byId, excused), "closed");

  const counts = countExclusions({ stores, channels: CHANNELS, overrides });
  eq("the split is counted, not hidden", counts, {
    routable: 2,
    closed: 2,
    channelNotCalledOn: 2,
    excusedByOverride: 1,
  });
}

// ── An override on a NORMAL channel is not an "exception" ───────────────────
{
  // Overrides mostly exist to change frequency, and most are on channels reps
  // already call on. Counting those as exceptions would report hundreds where
  // there are none.
  const stores = [store("a", "indep"), store("b", "indep")];
  const counts = countExclusions({
    stores,
    channels: CHANNELS,
    overrides: [override("a", "approved")],
  });
  eq("an override on a called-on channel is not counted as an exception", counts.excusedByOverride, 0);
  eq("and both stores still route", counts.routable, 2);
}

// ── What the Channels page shows before anyone ticks anything ───────────────
{
  const stores = [
    store("a", "makro"),
    store("b", "makro"),
    store("c", "makro", { closed: true, closedReason: "manual" }),
    store("d", "indep"),
  ];
  const counts = storeCountsByChannel(stores, [override("a", "approved")]);
  eq("total counts every store in the channel", counts.get("makro")?.total, 3);
  // The number that matters when deciding: closed stores are already out.
  eq("open excludes the shut ones", counts.get("makro")?.open, 2);
  eq("excused counts the exceptions in force", counts.get("makro")?.excused, 1);
  eq("a channel nobody has touched still reports", counts.get("indep")?.open, 1);
}

// ── Nothing configured ──────────────────────────────────────────────────────
{
  eq("no stores is not an error", routableStores({ stores: [], channels: [], overrides: [] }), []);
  // No channels loaded must not silently exclude the whole store base.
  const stores = [store("a", "indep")];
  eq(
    "no channels loaded still routes everything",
    routableStores({ stores, channels: [], overrides: [] }).length,
    1
  );
}


// -- iRam: the channel-wide switch beats the per-role switch, in both roles ---
//
// iRam has a narrower tool too: roleDefaults[role].enabled switches ONE visit
// role off a channel. The channel-wide flag must take the store out for every
// role, the sales rep included, and must not need the per-role switch flipped.
{
  const roles = DEFAULT_VISIT_ROLES;
  const sales = roles.find((r) => r.isPrimary)!;
  const qc = roles.find((r) => r.id === "qc")!;
  const salesRep: Rep = { id: "r1", code: "R1", name: "Sales", email: "", cell: "", homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId: "" };
  const qcRep: Rep = { ...salesRep, id: "r2", code: "Q1", name: "QC", visitRoleId: "qc" };
  const stores = [
    store("i1", "indep", { roleReps: { qc: "Q1" } }),
    store("m1", "makro", { roleReps: { qc: "Q1" } }),
  ];
  const routable = routableStores({ stores, channels: CHANNELS, overrides: [] });
  eq("the sales rep loses the excluded channel", getStoresForRep(salesRep, routable, sales, null, CHANNELS).map((s) => s.id), ["i1"]);
  eq("so does the QC rep, with no per-role switch touched", getStoresForRep(qcRep, routable, qc, null, CHANNELS).map((s) => s.id), ["i1"]);

  // An approved override puts the store back for every role, not only sales.
  const excused = routableStores({ stores, channels: CHANNELS, overrides: [override("m1", "approved")] });
  eq("an approved override brings it back for QC too", getStoresForRep(qcRep, excused, qc, null, CHANNELS).map((s) => s.id).sort(), ["i1", "m1"]);
}

// ── Switching a channel off: what the confirm says ──────────────────────────
{
  const stores = [
    store("o1", "makro"),
    store("o2", "makro"),
    store("o3", "makro"),
    store("x1", "makro", { closed: true }),
  ];
  const counts = storeCountsByChannel(stores, [override("o3", "approved")]);
  const impact = switchOffImpact(counts.get("makro"));
  eq("an override-kept store is not counted as leaving", impact, { leaving: 2, kept: 1 });
  eq("the confirm names both numbers", switchOffSentence(impact), "2 open stores will leave every call cycle, 1 kept in by a Call Override");
  eq("with no override it names only the leavers", switchOffSentence({ leaving: 1, kept: 0 }), "1 open store will leave every call cycle");
}

// ── A channel that still holds stores cannot be deleted ────────────────────
{
  const stores = [store("a", "makro"), store("b", "makro", { closed: true }), store("c", "spar")];
  eq("each requested channel with stores is named, with its count (closed ones too)",
    channelsStillHoldingStores(["makro", "empty"], stores), [{ id: "makro", stores: 2 }]);
  eq("an empty channel may go", channelsStillHoldingStores(["empty"], stores), []);
  // Why it matters: a store whose channel is gone counts as called on.
  ok("(a store pointing at a deleted channel is routable, which is why delete is refused)",
    routableStores({ stores: [store("z", "gone")], channels: [], overrides: [] }).length === 1);

  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const route = fs.readFileSync(path.join(__dirname, "..", "app", "api", "channels", "route.ts"), "utf8");
  const del = route.slice(route.indexOf("export async function DELETE"));
  ok("DELETE checks for stores before it saves", /channelsStillHoldingStores\(/.test(del) &&
    del.indexOf("channelsStillHoldingStores(") < del.indexOf("saveChannels("));
  ok("DELETE refuses with the server's message", /status: 409/.test(del));
}

// ── An import that flips "Reps Call Here" says so, with counts ─────────────
{
  const stores = [store("m1", "makro"), store("m2", "makro"), store("m3", "makro", { closed: true }), store("s1", "spar")];
  const changes = describeCalledOnChanges(
    [channel("makro", { name: "Makro", notARepChannel: true }), channel("spar", { name: "Spar" })],
    stores,
    [override("m2", "approved")]
  );
  eq("switched off: the open stores leaving, override-kept counted apart", changes[0], {
    id: "makro", name: "Makro", calledOn: false, openStores: 1, keptByOverride: 1,
  });
  eq("switched back on: the open stores returning", changes[1], {
    id: "spar", name: "Spar", calledOn: true, openStores: 1, keptByOverride: 0,
  });
  ok("the line says OFF and the count", /switched OFF\. 1 open store leave/.test(describeCalledOnChange(changes[0])));
  ok("the line names the override-kept stores", /1 kept in by a Call Override/.test(describeCalledOnChange(changes[0])));

  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const imp = fs.readFileSync(path.join(__dirname, "..", "app", "api", "channels", "import", "route.ts"), "utf8");
  ok("the channel import records every flipped Reps Call Here", /if \(calledOnChanged\) calledOnFlipped\.set/.test(imp));
  ok("the channel import returns the flips", /calledOnChanges,/.test(imp));
  const page = fs.readFileSync(path.join(__dirname, "..", "app", "channels", "page.tsx"), "utf8");
  ok("the Channels page lists the flips from an import", /data\.calledOnChanges/.test(page) && /describeCalledOnChange\)/.test(page));
  ok("the Called on? confirm uses the two-number sentence", /switchOffSentence\(switchOffImpact\(/.test(page));
  // The body of one `const name = async (...) => {` handler, up to the next one.
  const body = (name: string) => {
    const start = page.indexOf(`const ${name} = async`);
    if (start === -1) return "";
    const next = page.slice(start + 1).search(/\n  const \w+ = /);
    return next === -1 ? page.slice(start) : page.slice(start, start + 1 + next);
  };
  const calledOn = body("setCalledOn");
  ok("switching off refuses before the counts load, ahead of the confirm",
    /if \(countsState !== "loaded"\) \{/.test(calledOn) && calledOn.indexOf("countsState") < calledOn.indexOf("confirm("));
  ok("the Called on? switch is locked off until the counts load", /on && countsState !== "loaded"\)/.test(page));
  ok("the Channels page gates its controls on canEdit(..., \"channels\")", /canEdit\(session\?\.role, "channels"\)/.test(page));
  for (const fn of ["setRoleEnabled", "setCalledOn", "saveEdit", "addChannel", "deleteChannel", "deleteSelected", "handleImport", "applyDefaults"]) {
    const b = body(fn);
    ok(`${fn} waits for any write already in flight`, /beginWrite\(\)/.test(b) && /endWrite\(\)/.test(b));
  }
  ok("the in-flight guard actually refuses a second write", /if \(inFlight\.current\) return false;/.test(page));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);


