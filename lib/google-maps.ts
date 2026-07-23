/**
 * Google Maps Directions API wrapper + polyline decoder.
 * Falls back gracefully when GOOGLE_MAPS_API_KEY is not set.
 */

interface DirectionsLeg {
  distanceMeters: number;
  durationSeconds: number;
}

export interface OptimizedRouteResult {
  waypointOrder: number[];
  legs: DirectionsLeg[];
  polyline: string; // encoded polyline
}

const API_KEY = () => process.env.GOOGLE_MAPS_API_KEY || "";

export function hasGoogleMapsKey(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

/**
 * Call Google Maps Directions API with waypoint optimization.
 * Max 25 waypoints per request (Google's limit).
 */
export async function getOptimizedRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  waypoints: { lat: number; lng: number }[]
): Promise<OptimizedRouteResult | null> {
  if (!hasGoogleMapsKey()) return null;

  const originStr = `${origin.lat},${origin.lng}`;
  const destStr = `${destination.lat},${destination.lng}`;

  const waypointsParam =
    waypoints.length > 0
      ? `&waypoints=optimize:true|${waypoints.map((w) => `${w.lat},${w.lng}`).join("|")}`
      : "";

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${originStr}` +
    `&destination=${destStr}` +
    waypointsParam +
    `&key=${API_KEY()}`;

  // Rate limit: small delay between calls
  await delay(80);

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== "OK" || !data.routes?.length) return null;

  const route = data.routes[0];
  const legs: DirectionsLeg[] = route.legs.map(
    (leg: { distance: { value: number }; duration: { value: number } }) => ({
      distanceMeters: leg.distance.value,
      durationSeconds: leg.duration.value,
    })
  );

  return {
    waypointOrder: route.waypoint_order || [],
    legs,
    polyline: route.overview_polyline?.points || "",
  };
}

/**
 * Decode Google's encoded polyline format into lat/lng pairs.
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode latitude
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/**
 * Reverse-geocode a lat/lng to get the administrative area (province/region).
 * Returns the `administrative_area_level_1` short name, or null.
 */
export async function reverseGeocodeRegion(
  lat: number,
  lng: number
): Promise<string | null> {
  if (!hasGoogleMapsKey()) return null;

  await delay(100); // rate limit

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${lat},${lng}` +
    `&result_type=administrative_area_level_1` +
    `&key=${API_KEY()}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) return null;

  for (const result of data.results) {
    for (const comp of result.address_components || []) {
      if (comp.types?.includes("administrative_area_level_1")) {
        return comp.long_name as string;
      }
    }
  }
  return null;
}

/**
 * Reverse-geocode a lat/lng to a human-readable place: "City, Province, Country".
 * Used to tell the client exactly where a wrong coordinate actually points.
 */
export async function reverseGeocodePlace(
  lat: number,
  lng: number
): Promise<string | null> {
  if (!hasGoogleMapsKey()) return null;

  await delay(80);

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${lat},${lng}` +
    `&key=${API_KEY()}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) return null;

  const comps = data.results[0].address_components as {
    long_name: string;
    types: string[];
  }[];
  const pick = (...types: string[]) => {
    for (const t of types) {
      const c = comps.find((comp) => comp.types?.includes(t));
      if (c) return c.long_name;
    }
    return "";
  };

  const city = pick("locality", "postal_town", "sublocality", "administrative_area_level_2");
  const province = pick("administrative_area_level_1");
  const country = pick("country");
  const parts = [city, province, country].filter(Boolean);
  return parts.length ? parts.join(", ") : (data.results[0].formatted_address || null);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
