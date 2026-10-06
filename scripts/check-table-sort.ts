/**
 * Assertions for the shared table sorting.
 *
 * Run: npx tsx scripts/check-table-sort.ts
 *
 * Ported from Clippa without its store-rank half: iRam carries no sales data,
 * so there is nothing to rank stores on. The comparator rules are the same.
 */

import { compareCells, sortRows } from "../lib/tableSort";

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

// ── compareCells ────────────────────────────────────────────────────────────
const asc = (a: string | number | boolean | null, b: typeof a) => compareCells(a, b, "asc");
const desc = (a: string | number | boolean | null, b: typeof a) => compareCells(a, b, "desc");

ok("numbers compare numerically", asc(2, 10) < 0 && desc(2, 10) > 0);
ok("numbers are not compared as text", asc(9, 100) < 0, "'9' vs '100' as text inverts this");
ok("strings compare alphabetically", asc("ALPHA", "BETA") < 0);
ok("strings compare numeric-aware", asc("S2", "S10") < 0, "every Place ID is shaped like this");
ok("string compare ignores case", asc("alpha", "ALPHA") === 0);
ok("booleans sort false before true ascending", asc(false, true) < 0);
ok("null sinks ascending", asc(null, 5) > 0);
ok("null sinks descending too", desc(null, 5) > 0, "a blank must never top either direction");
ok("empty string sinks like null", asc("", "X") > 0 && desc("", "X") > 0);
ok("two blanks tie", asc(null, "") === 0);
ok("zero is a value and does not sink", asc(0, 5) < 0 && desc(0, 5) > 0);
ok("negative numbers order correctly", asc(-10, -2) < 0);
ok("latitudes sort as numbers, not text", asc(-33.9, -26.1) < 0);

// ── sortRows ────────────────────────────────────────────────────────────────
{
  const rows = [{ n: "b", v: 2 }, { n: "a", v: 30 }, { n: "c", v: null as number | null }];
  const acc = { n: (r: typeof rows[0]) => r.n, v: (r: typeof rows[0]) => r.v };

  ok("sortRows orders by the named column", sortRows(rows, acc, "n", "asc").map((r) => r.n).join("") === "abc");
  ok("sortRows sorts numerically where asked", sortRows(rows, acc, "v", "desc")[0].v === 30);
  ok("sortRows sinks the blank in both directions",
    sortRows(rows, acc, "v", "asc")[2].v === null && sortRows(rows, acc, "v", "desc")[2].v === null);
  ok("an unknown column leaves the order alone", sortRows(rows, acc, "nope", "asc")[0].n === "b");

  const original = [...rows];
  sortRows(rows, acc, "v", "desc");
  ok("sortRows does NOT mutate its input", rows[0] === original[0],
    "in-place sorting would reorder the caller's memoised source");
}

// Store codes in iRam look like this; numeric-aware ordering keeps them human.
{
  const codes = ["GAU10", "GAU2", "GAU1", "KZN3"];
  const sorted = sortRows(codes.map((c) => ({ c })), { c: (r) => r.c }, "c", "asc").map((r) => r.c);
  ok("rep and place codes sort the way a person reads them",
    sorted.join(",") === "GAU1,GAU2,GAU10,KZN3", sorted.join(","));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
