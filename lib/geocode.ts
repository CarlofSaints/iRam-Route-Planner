import { getGeocodeCache, saveGeocodeCache } from "./data";
import { reverseGeocodePlace, hasGoogleMapsKey } from "./google-maps";

export function geoKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Resolve a batch of coordinates to place names, using a persistent cache so
 * repeat exports don't re-call Google. Only misses are geocoded, capped per
 * call to keep an export responsive. Returns a Map keyed by geoKey().
 */
export async function resolveLocations(
  coords: { lat: number; lng: number }[],
  cap = 350
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const cache = await getGeocodeCache();

  // Unique coordinates only — duplicates share the same point.
  const unique = new Map<string, { lat: number; lng: number }>();
  for (const c of coords) unique.set(geoKey(c.lat, c.lng), c);

  let changed = false;
  let calls = 0;
  for (const [key, c] of unique) {
    if (cache[key] !== undefined) {
      result.set(key, cache[key]);
      continue;
    }
    if (!hasGoogleMapsKey() || calls >= cap) continue;
    const place = await reverseGeocodePlace(c.lat, c.lng);
    calls++;
    cache[key] = place || "";
    result.set(key, cache[key]);
    changed = true;
  }

  if (changed) await saveGeocodeCache(cache);
  return result;
}
