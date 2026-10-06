/**
 * Assertions for reading a coordinate somebody typed.
 *
 * Run: npx tsx scripts/check-sa-coordinates.ts
 *
 * 🔴 The failure this exists to stop is the one that LOOKS fine: a swapped
 * pair. -26.1 / 28.0 reversed puts the store in the Arabian Sea, the router
 * plans a 6 000 km day around it, and nothing anywhere says a word. A blank
 * coordinate is reported as blank; a wrong one is obeyed.
 */

import {
  checkCoordinate,
  splitPastedPair,
  SA_LAT,
  SA_LNG,
} from "../lib/saCoordinates";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

// ── A good coordinate ─────────────────────────────────────────────────────
{
  const c = checkCoordinate("-26.1075", "28.0567");
  ok("Johannesburg is accepted", c.problem === null);
  ok("and parsed", c.lat === -26.1075 && c.lng === 28.0567);
  ok("no message when nothing is wrong", c.message === null);

  ok("Cape Town is accepted", checkCoordinate("-33.9249", "18.4241").problem === null);
  ok("Musina, near the top of the country", checkCoordinate("-22.35", "30.04").problem === null);
  ok("Springbok, near the west", checkCoordinate("-29.66", "17.89").problem === null);
}

// ── 🔴 Swapped ────────────────────────────────────────────────────────────
{
  const c = checkCoordinate("28.0567", "-26.1075");
  ok("a swapped pair is caught", c.problem === "swapped", String(c.problem));
  ok("and explained in the words that fix it",
    !!c.message && c.message.toLowerCase().includes("negative"), c.message ?? "");
  ok("and offered back the right way round",
    c.suggestion?.lat === -26.1075 && c.suggestion?.lng === 28.0567,
    JSON.stringify(c.suggestion));

  // 🔴 "Outside South Africa" is TRUE of a swapped pair but useless — it sends
  // somebody hunting for a coordinate they already have.
  ok("swapped is reported as swapped, NOT as outside South Africa",
    checkCoordinate("28.0567", "-26.1075").problem !== "outside_sa");

  // The suggestion must itself be valid, or the button offers a second error.
  const fixed = c.suggestion!;
  ok("the suggested swap is itself a valid coordinate",
    checkCoordinate(String(fixed.lat), String(fixed.lng)).problem === null);
}

// ── Empty and malformed ───────────────────────────────────────────────────
{
  ok("both empty is 'empty', with nothing shouted at anyone",
    checkCoordinate("", "").problem === "empty" && checkCoordinate("", "").message === null);
  ok("one empty asks for the other", checkCoordinate("-26.1", "").problem === "not_a_number");
  ok("letters are refused", checkCoordinate("abc", "28.0").problem === "not_a_number");
  ok("a lone minus is refused", checkCoordinate("-", "28.0").problem === "not_a_number");
}

// ── (0,0) ─────────────────────────────────────────────────────────────────
{
  const c = checkCoordinate("0", "0");
  ok("(0,0) is refused", c.problem === "null_island");
  ok("and named as a placeholder rather than a location",
    !!c.message && /placeholder/i.test(c.message));
  // 28 stores in the live data carry exactly this.
  ok("0.0 / 0.0 too", checkCoordinate("0.0", "0.0").problem === "null_island");
}

// ── Outside South Africa ──────────────────────────────────────────────────
{
  ok("London is refused", checkCoordinate("51.5", "-0.12").problem === "outside_sa");
  ok("a lost decimal point is refused",
    checkCoordinate("-260896520", "27.969334").problem === "outside_sa");
  const c = checkCoordinate("-26.1", "120.0");
  ok("the message names WHICH value is wrong",
    !!c.message && c.message.includes("longitude") && !c.message.includes("latitude should"),
    c.message ?? "");
  // A positive latitude in SA is always wrong; it is the northern hemisphere.
  ok("a positive latitude is refused", checkCoordinate("26.1", "28.0").problem !== null);
}

// ── Bounds are the stated ones ────────────────────────────────────────────
{
  ok("the stated latitude bounds accept their own edges",
    checkCoordinate(String(SA_LAT.min), "28").problem === null &&
      checkCoordinate(String(SA_LAT.max), "28").problem === null);
  ok("the stated longitude bounds accept their own edges",
    checkCoordinate("-26", String(SA_LNG.min)).problem === null &&
      checkCoordinate("-26", String(SA_LNG.max)).problem === null);
}

// ── Messy input people actually paste ─────────────────────────────────────
{
  ok("a degree symbol is tolerated", checkCoordinate("-26.1075°", "28.0567°").problem === null);
  ok("surrounding spaces are tolerated", checkCoordinate("  -26.1075 ", " 28.0567 ").problem === null);
  ok("a trailing comma is tolerated", checkCoordinate("-26.1075,", "28.0567").problem === null);
}

// ── Pasting a pair into one box ───────────────────────────────────────────
{
  ok("a comma-separated pair splits",
    JSON.stringify(splitPastedPair("-26.1075, 28.0567")) ===
      JSON.stringify({ lat: "-26.1075", lng: "28.0567" }));
  ok("a space-separated pair splits",
    JSON.stringify(splitPastedPair("-26.1075 28.0567")) ===
      JSON.stringify({ lat: "-26.1075", lng: "28.0567" }));
  // 🔴 Pasted the wrong way round, it is still put in the right boxes.
  ok("a pair pasted backwards is ordered correctly",
    JSON.stringify(splitPastedPair("28.0567, -26.1075")) ===
      JSON.stringify({ lat: "-26.1075", lng: "28.0567" }));

  ok("a single number is not a pair", splitPastedPair("-26.1075") === null);
  ok("three numbers are not a pair", splitPastedPair("1, 2, 3") === null);
  ok("text is not a pair", splitPastedPair("Sandton City") === null);
  ok("empty is not a pair", splitPastedPair("") === null);
  // Anything that does split must then pass the same check as typed input.
  const p = splitPastedPair("-26.1075, 28.0567")!;
  ok("a split pair validates cleanly", checkCoordinate(p.lat, p.lng).problem === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
