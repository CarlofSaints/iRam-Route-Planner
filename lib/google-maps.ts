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

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** What Google thinks the address is — show this so a human can eyeball it. */
  formattedAddress: string;
  /** ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE */
  locationType: string;
  /** Google matched something, but not everything it was given. */
  partialMatch: boolean;
  /** More than one candidate came back — the address is ambiguous. */
  multipleMatches: boolean;
}

/**
 * Forward-geocode an address to a coordinate.
 *
 * Deliberately returns Google's confidence signals rather than just a point.
 * Rep home addresses here are largely informal — "Stand no 644 moletjie ga
 * semenya polokwane", "Bushbuckridge college view stand no B480" — and Google
 * answers those by falling back to the suburb, the town, or the province
 * centroid, with no error. Saving that silently would anchor a rep's entire
 * week on a point tens of kilometres from where they live, and it would look
 * perfectly plausible on the map. Callers must decide what confidence is good
 * enough; this function does not decide for them.
 *
 * `region=za` biases results to South Africa, so a bare street name doesn't
 * resolve to a same-named street on another continent.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!hasGoogleMapsKey()) return null;
  const query = (address || "").trim();
  if (!query) return null;

  await delay(80); // rate limit

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(query)}` +
    `&region=za` +
    `&key=${API_KEY()}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) return null;

  const top = data.results[0];
  const loc = top.geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;

  return {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: top.formatted_address || "",
    locationType: top.geometry?.location_type || "APPROXIMATE",
    partialMatch: !!top.partial_match,
    multipleMatches: data.results.length > 1,
  };
}

/**
 * Is a geocode precise enough to write to a rep record without a human looking
 * at it? Only an exact building (ROOFTOP) or a point interpolated along a known
 * street range qualifies, and only when Google matched the whole address and
 * had exactly one candidate. Everything else is a suburb/town centroid wearing
 * a street address's clothes.
 */
export function isConfidentGeocode(g: GeocodeResult): boolean {
  return (
    (g.locationType === "ROOFTOP" || g.locationType === "RANGE_INTERPOLATED") &&
    !g.partialMatch &&
    !g.multipleMatches
  );
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
