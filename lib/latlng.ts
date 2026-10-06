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

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Average driving speed assumed when there is no Google leg to measure.
 *
 * It lives here rather than in the engine because the map has to be able to
 * price the leg home on a plan that was saved without one, and a second copy
 * of the number would let the map and the engine quote different drives.
 */
export const DEFAULT_SPEED_KMH = 40;

/** Minutes behind a distance, at the assumed average speed. */
export function driveMinutes(km: number): number {
  return (km / DEFAULT_SPEED_KMH) * 60;
}
