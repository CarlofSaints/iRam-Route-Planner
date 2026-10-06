/**
 * Assertions for closing stores by hand.
 *
 * Run: npx tsx scripts/check-closed-stores.ts
 *
 * Ported from Clippa without its IMS half: iRam has no feed that closes a
 * store, so the only write is a person on the Stores page (or the STATUS column
 * of the Stores export sent back through Import Excel).
 *
 * The cases that matter most are the ones that must stay SILENT: a blank STATUS
 * cell, a store that was never touched, and every bulk path that writes the
 * store list without knowing the field exists.
 */

import fs from "fs";
import path from "path";
import {
  isClosed,
  activeStores,
  storeStatus,
  closedReasonLabel,
  setStatusByHand,
  applyStatus,
  parseStatusCell,
  importStatusOutcome,
} from "../lib/closedStores";
import type { Store } from "../lib/types";

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

function store(placeId: string, extra: Partial<Store> = {}): Store {
  return {
    id: placeId,
    placeId,
    name: `Store ${placeId}`,
    channelId: "c1",
    repCode: "R1",
    gpsLat: "-26",
    gpsLng: "28",
    monthlySales: 0,
    frequency: "monthly",
    duration: 30,
    dayOfWeek: "",
    weekNumber: "",
    ...extra,
  };
}

// ── The single definition ───────────────────────────────────────────────────
{
  ok("a store with no flag is open", !isClosed(store("A")));
  ok("closed: true is closed", isClosed(store("A", { closed: true })));
  ok("closed: false is open", !isClosed(store("A", { closed: false })));
  ok("activeStores drops only the shut ones",
    activeStores([store("A"), store("B", { closed: true }), store("C")]).map((s) => s.id).join() === "A,C");
  ok("status reads active / closed", storeStatus(store("A")) === "active" && storeStatus(store("B", { closed: true })) === "closed");
  ok("an open store has no reason label", closedReasonLabel(store("A")) === null);
  ok("a hand-closed store says so", closedReasonLabel(store("A", { closed: true, closedReason: "manual" })) === "Closed by hand");
  ok("a closed store with no reason still says Closed", closedReasonLabel(store("A", { closed: true })) === "Closed",
    "an empty tooltip on a shut store reads as a bug");
}

// ── The patch a person's decision writes ────────────────────────────────────
{
  const close = setStatusByHand(true, "2026-10-06T08:00:00.000Z");
  ok("closing records the reason as manual", close.closed === true && close.closedReason === "manual");
  ok("closing records when", close.closedAt === "2026-10-06T08:00:00.000Z");
  ok("closing marks it a human decision", close.statusDecidedByHand === true);
  const open = setStatusByHand(false);
  ok("reopening clears the reason and the date", open.closed === false && open.closedReason === undefined && open.closedAt === undefined,
    "a reopened shop must not keep saying Closed by hand");
}

// ── applyStatus mutates in place and reports change ─────────────────────────
{
  const s = store("A");
  ok("closing an open store reports a change", applyStatus(s, true, "2026-10-01T00:00:00.000Z") === true);
  ok("and it is now closed", isClosed(s) && s.closedAt === "2026-10-01T00:00:00.000Z");
  ok("closing it AGAIN is not a change", applyStatus(s, true, "2026-10-09T00:00:00.000Z") === false);
  ok("and does not restamp the date it was first shut", s.closedAt === "2026-10-01T00:00:00.000Z",
    "an edit form sends its status on every save");
  ok("reopening reports a change", applyStatus(s, false) === true);
  ok("and removes the keys rather than writing undefined into the JSON",
    !("closed" in s) && !("closedReason" in s) && !("closedAt" in s));
  ok("a reopened store remembers a person ruled on it", s.statusDecidedByHand === true);
  const untouched = store("B");
  ok("saying an open store is open changes nothing", applyStatus(untouched, false) === false);
  ok("and does not stamp it as hand-decided", untouched.statusDecidedByHand === undefined);
}

// ── Reading the STATUS cell of the Stores export ────────────────────────────
{
  ok("Closed reads as closed", parseStatusCell("Closed") === true);
  ok("CLOSED in caps reads as closed", parseStatusCell("  CLOSED ") === true);
  ok("Active reads as open", parseStatusCell("Active") === false);
  ok("Open reads as open", parseStatusCell("open") === false);
  // 🔴 Blank must NOT mean open. A deleted cell would otherwise reopen the shop
  // and send a rep back to it without anyone deciding that.
  ok("a blank cell leaves the store alone", parseStatusCell("") === undefined);
  ok("whitespace is blank", parseStatusCell("   ") === undefined);
  ok("nonsense is reported, not guessed", parseStatusCell("maybe") === null);
}

// ── Round trip: what the export writes, the import reads back unchanged ────
{
  const exported = (s: Store) => (isClosed(s) ? "Closed" : "Active");
  const a = store("A", { closed: true, closedReason: "manual", closedAt: "2026-09-01T00:00:00.000Z" });
  const b = store("B");
  ok("an exported Closed comes back as no change", applyStatus(a, parseStatusCell(exported(a)) as boolean) === false);
  ok("and keeps its original date", a.closedAt === "2026-09-01T00:00:00.000Z");
  ok("an exported Active comes back as no change", applyStatus(b, parseStatusCell(exported(b)) as boolean) === false);
}

// ── Every bulk writer of stores.json must leave the flag alone ──────────────
//
// Store Upload, Apply defaults, channel cascades and the duplicates merge all
// rewrite the store list. They mutate existing store objects in place, which
// keeps `closed`; the danger is one of them ever rebuilding a store from a
// spreadsheet row. Asserted on the source, because each of these previously
// shipped a sibling field unguarded first.
{
  const root = path.join(__dirname, "..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const writers = [
    "app/api/stores/upload/route.ts",
    "app/api/channels/apply-defaults/route.ts",
    "app/api/channels/route.ts",
    "app/api/channels/import/route.ts",
    "app/api/store-overrides/route.ts",
    "app/api/stores/duplicates/route.ts",
  ];
  for (const rel of writers) {
    const src = read(rel);
    ok(`${rel} never writes the closed flag`, !/\.closed\s*=|closed:\s*(true|false)/.test(src));
  }
  const upload = read("app/api/stores/upload/route.ts");
  ok("Store Upload updates an existing store in place (keeps its status)",
    /const existing = storeMap\.get\(placeId\)!/.test(upload) && /existing\.name = storeName/.test(upload),
    "if this changes to building a fresh object, closed stores silently reopen");
  const importer = read("app/api/stores/import/route.ts");
  ok("the Stores import only changes status through applyStatus", /applyStatus\(store, closed\)/.test(importer));
  ok("the Stores import decides status through importStatusOutcome", /importStatusOutcome\(store, raw\)/.test(importer));
  ok("the Stores import never reads the raw cell as a reopen", !/parseStatusCell\(/.test(importer));
  ok("the Stores import names the stores it closed and reopened",
    /closedStores: closedNames/.test(importer) && /reopenedStores: reopenedNames/.test(importer));
}

// ── An old export must not reopen a store closed since ─────────────────────
{
  const closedNow = store("C", { closed: true, closedReason: "manual", closedAt: "2026-09-01T00:00:00.000Z" });
  const openNow = store("O");
  ok("Active on a CLOSED store leaves it closed", importStatusOutcome(closedNow, "Active") === "keptClosed");
  ok("Open on a CLOSED store leaves it closed", importStatusOutcome(closedNow, "open") === "keptClosed");
  ok("Reopen on a closed store reopens it", importStatusOutcome(closedNow, "Reopen") === "reopen");
  ok("REOPENED in caps reopens it", importStatusOutcome(closedNow, " REOPENED ") === "reopen");
  ok("Closed on an open store closes it", importStatusOutcome(openNow, "Closed") === "close");
  ok("Closed on a closed store is no change", importStatusOutcome(closedNow, "Closed") === "none");
  ok("Active on an open store is no change", importStatusOutcome(openNow, "Active") === "none");
  ok("Reopen on an open store is no change", importStatusOutcome(openNow, "Reopen") === "none");
  ok("a blank cell is no change", importStatusOutcome(closedNow, "") === "none");
  ok("nonsense is reported", importStatusOutcome(closedNow, "maybe") === "bad");
  // The round trip that used to reopen: export when open, close it, import the old file.
  const exportedWhenOpen = "Active";
  ok("the stale round trip leaves the store closed", importStatusOutcome(closedNow, exportedWhenOpen) !== "reopen");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
