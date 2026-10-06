/**
 * Reading a coordinate a human typed, for South Africa.
 *
 * The rule worth remembering, and the one the UI states: **in South Africa the
 * latitude is the NEGATIVE one.** Latitude runs about −22 (Limpopo) to −35
 * (Cape Agulhas); longitude runs about +16 (Namibian border) to +33 (Mozambique
 * border). They cannot be confused once that is said out loud, which is exactly
 * why it is said out loud.
 *
 * ⚠️ On the current data NOTHING is swapped — all 1 815 unusable coordinates
 * are blank, (0,0), or one lost decimal point. This guards the manual entry we
 * are about to ask people to do, not a mess that already exists. A swapped pair
 * is the failure that looks plausible: it lands the store in the Arabian Sea,
 * the router happily plans a 6 000 km drive, and nothing says a word.
 */

/** Generous bounds around mainland South Africa. */
export const SA_LAT = { min: -35.2, max: -21.9 };
export const SA_LNG = { min: 16.2, max: 33.1 };

export type CoordinateProblem =
  | "empty"
  | "not_a_number"
  | "null_island"
  | "swapped"
  | "outside_sa";

export interface CoordinateCheck {
  lat: number | null;
  lng: number | null;
  problem: CoordinateProblem | null;
  /** Plain English, written for whoever is typing. */
  message: string | null;
  /** Present for `swapped`: the same pair the right way round. */
  suggestion: { lat: number; lng: number } | null;
}

const inSaLat = (n: number) => n >= SA_LAT.min && n <= SA_LAT.max;
const inSaLng = (n: number) => n >= SA_LNG.min && n <= SA_LNG.max;

function toNumber(value: string): number | null {
  const cleaned = (value ?? "")
    .trim()
    // A pasted degree symbol, a stray "S"/"E", and thousands spaces are all
    // things people paste from Google Maps or a spreadsheet.
    .replace(/[°\s]/g, "")
    .replace(/,$/, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Check a typed pair and say what is wrong in words.
 *
 * Deliberately returns a PROBLEM rather than just true/false: "that is not in
 * South Africa" and "those two look swapped" need different answers from the
 * person typing, and only one of them can be fixed with a button.
 */
export function checkCoordinate(latText: string, lngText: string): CoordinateCheck {
  const lat = toNumber(latText);
  const lng = toNumber(lngText);
  const none = { lat, lng, suggestion: null };

  if (lat === null && lng === null) {
    return { ...none, problem: "empty", message: null };
  }
  if (lat === null || lng === null) {
    return {
      ...none,
      problem: "not_a_number",
      message: "Both a latitude and a longitude are needed.",
    };
  }
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) {
    return {
      ...none,
      problem: "null_island",
      message: "0, 0 is a placeholder, not a place — it is in the sea off West Africa.",
    };
  }

  // 🔴 Checked BEFORE the plain out-of-range message. "Outside South Africa" is
  // true of a swapped pair but useless: it sends someone hunting for the right
  // coordinate when they already have it, in the wrong order.
  if (inSaLat(lng) && inSaLng(lat)) {
    return {
      lat,
      lng,
      problem: "swapped",
      message: "These look the wrong way round — in South Africa the latitude is the negative one.",
      suggestion: { lat: lng, lng: lat },
    };
  }

  if (!inSaLat(lat) || !inSaLng(lng)) {
    const parts: string[] = [];
    if (!inSaLat(lat)) parts.push(`latitude should be between ${SA_LAT.min} and ${SA_LAT.max}`);
    if (!inSaLng(lng)) parts.push(`longitude should be between ${SA_LNG.min} and ${SA_LNG.max}`);
    return {
      ...none,
      problem: "outside_sa",
      message: `That is outside South Africa — ${parts.join(", and ")}.`,
    };
  }

  return { lat, lng, problem: null, message: null, suggestion: null };
}

/**
 * Split a pasted pair like "-26.107, 28.056" into its two halves.
 *
 * People copy a coordinate out of Google Maps as one string and paste it into
 * whichever box they clicked first. Refusing it teaches them to hand-edit the
 * text, which is where a typo comes from; accepting it removes the step.
 * Returns null when the text is not a pair, so a single number still behaves
 * as a single number.
 */
export function splitPastedPair(text: string): { lat: string; lng: string } | null {
  const parts = (text ?? "")
    .trim()
    .split(/[,;|]|\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const a = toNumber(parts[0]);
  const b = toNumber(parts[1]);
  if (a === null || b === null) return null;
  // Put them in the order that makes sense for South Africa, whichever way
  // round they were pasted.
  if (inSaLat(b) && inSaLng(a)) return { lat: String(b), lng: String(a) };
  return { lat: String(a), lng: String(b) };
}
