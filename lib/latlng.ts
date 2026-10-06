/**
 * The one definition of a usable coordinate.
 *
 * It lives apart from `route-engine.ts` only so a browser page can ask the
 * question without pulling the whole routing engine into its bundle — the
 * engine re-exports it, so every existing import still works. There must never
 * be a second copy of this rule: the map showing a rep a home the engine will
 * not route from is exactly the disagreement it prevents.
 */

/**
 * Parse and validate a lat/lng pair. Returns null for missing, non-numeric,
 * out-of-range, or null-island (0,0) coordinates so corrupted rows can't be
 * routed or distance-measured.
 */
export function parseLatLng(
  latStr: string | undefined,
  lngStr: string | undefined
): { lat: number; lng: number } | null {
  const lat = parseFloat(latStr ?? "");
  const lng = parseFloat(lngStr ?? "");
  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return null; // (0,0) placeholder
  return { lat, lng };
}
