/**
 * Assertions for the guide.
 *
 * Run: npx tsx scripts/check-guide.ts
 *
 * A guide is prose, so most of it cannot be tested. What CAN be tested is the
 * things that rot silently: a diagram id the renderer does not draw, a duplicate
 * screenshot slot quietly overwriting another's image, an anchor that does not
 * match its section, a filename Windows will not accept. Those are the failures
 * that would not be noticed until a client opened the page.
 */

import { GUIDE, GUIDE_VERSION, screenshotSlots } from "../lib/guide";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The ids GuideVisuals.tsx actually knows how to draw. */
const DRAWABLE = ["flow", "model", "doors", "cycle"];

console.log("\n--- structure ---\n");

ok("the guide has sections", GUIDE.length > 0);
ok("every section has an id", GUIDE.every((s) => !!s.id));
ok(
  "section ids are unique",
  new Set(GUIDE.map((s) => s.id)).size === GUIDE.length,
  "a duplicate id makes the contents link to the wrong place"
);
ok(
  "section ids are usable as URL anchors",
  GUIDE.every((s) => /^[a-z][a-z0-9-]*$/.test(s.id)),
  GUIDE.filter((s) => !/^[a-z][a-z0-9-]*$/.test(s.id)).map((s) => s.id).join(", ")
);
ok(
  "section numbers are sequential",
  GUIDE.every((s, i) => s.number === String(i + 1)),
  GUIDE.map((s) => s.number).join(",")
);
ok("every section has a title and a blurb", GUIDE.every((s) => s.title.length > 3 && s.blurb.length > 3));
ok("every section has an icon", GUIDE.every((s) => s.icon.length > 10));
ok(
  "every icon is an SVG path, not markup",
  GUIDE.every((s) => /^[Mm]/.test(s.icon) && !s.icon.includes("<")),
  "an icon carrying a tag would be injected as text"
);
ok("every section has content", GUIDE.every((s) => s.blocks.length > 0));

console.log("\n--- diagrams ---\n");

const diagrams = GUIDE.flatMap((s) => s.blocks.filter((b) => b.kind === "diagram"));
ok("the guide uses diagrams", diagrams.length > 0);
ok(
  "every diagram id can actually be drawn",
  diagrams.every((d) => d.kind === "diagram" && DRAWABLE.includes(d.id)),
  "an unknown id renders as nothing at all"
);
for (const id of DRAWABLE) {
  ok(
    `the "${id}" diagram is used somewhere`,
    diagrams.some((d) => d.kind === "diagram" && d.id === id),
    "a diagram nobody references is dead weight"
  );
}
ok("every diagram has a caption", diagrams.every((d) => d.kind === "diagram" && d.caption.length > 5));

console.log("\n--- screenshots ---\n");

const slots = screenshotSlots();
ok("the guide expects screenshots", slots.length > 0);
ok(
  "screenshot slots are unique",
  new Set(slots.map((s) => s.slot)).size === slots.length,
  "two slots sharing a name would share one image file"
);
ok(
  "slot names are safe as filenames",
  slots.every((s) => /^[a-z][a-z0-9-]*$/.test(s.slot)),
  slots.filter((s) => !/^[a-z][a-z0-9-]*$/.test(s.slot)).map((s) => s.slot).join(", ")
);
ok(
  "every slot says what to capture",
  slots.every((s) => s.capture.length > 15),
  "a slot with no instruction is a picture nobody knows how to take"
);
ok("every slot has a caption for the reader", slots.every((s) => !!s.section));

console.log("\n--- content quality ---\n");

const blocks = GUIDE.flatMap((s) => s.blocks);

ok(
  "every table row matches its header width",
  blocks.every((b) => b.kind !== "table" || b.rows.every((r) => r.length === b.head.length)),
  "a short row silently shifts every cell after it"
);
ok(
  "no table is empty",
  blocks.every((b) => b.kind !== "table" || b.rows.length > 0)
);
ok(
  "every note has a title and body",
  blocks.every((b) => b.kind !== "note" || (b.title.length > 5 && b.text.length > 20))
);
ok(
  "every step says what to do",
  blocks.every((b) => b.kind !== "steps" || b.items.every((i) => i.do.length > 5))
);
ok(
  "no step list is empty",
  blocks.every((b) => b.kind !== "steps" || b.items.length > 0)
);
ok(
  'every "where" block names a real-looking path',
  blocks.every((b) => b.kind !== "where" || b.path.length > 3)
);

// The guide is client-facing copy. An em dash is the tell that gives away
// machine-written text, and these read as Clippa's own documentation.
const withEmDash = blocks.filter((b) => {
  const text = JSON.stringify(b);
  return text.includes("—");
});
ok(
  "no em dashes in client-facing copy",
  withEmDash.length === 0,
  withEmDash.length > 0 ? `${withEmDash.length} block(s): ${JSON.stringify(withEmDash[0]).slice(0, 90)}` : ""
);

ok("the guide is versioned", /^\d+\.\d+$/.test(GUIDE_VERSION));

console.log("\n--- the things a reader must not miss ---\n");

const allText = JSON.stringify(GUIDE).toLowerCase();
for (const [label, needle] of [
  ["regenerating after a change is covered", "regenerat"],
  ["the rep code being the allocation is covered", "rep code"],
  ["the two upload doors are covered", "store upload"],
  ["home addresses are covered", "home address"],
  ["visit roles are covered", "visit role"],
  ["the Perigee export is covered", "perigee"],
  ["capacity is covered", "capacity"],
] as const) {
  ok(label, allText.includes(needle));
}

console.log("\n--- nothing borrowed from the sister app ---\n");

// These are pages the OTHER route planner has and this one does not. A ported
// guide mentioning them sends people looking for a screen that is not there,
// and the content check above happily passed on exactly that.
for (const absent of ["data health", "store coverage", "repsly", "clippa"]) {
  ok(`the guide does not mention "${absent}"`, !allText.includes(absent));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
