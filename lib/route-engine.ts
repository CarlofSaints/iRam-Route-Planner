import {
  Rep,
  Store,
  FrequencyType,
  RouteStop,
  RouteDayPlan,
  RepRoutePlan,
  WeekLabel,
  DayLabel,
} from "./types";
import { getOptimizedRoute, hasGoogleMapsKey } from "./google-maps";

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];
const DAYS: DayLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DEFAULT_SPEED_KMH = 40; // estimated avg speed for Haversine fallback
const DEFAULT_WORKING_HOURS = 8.5;
const DEFAULT_START_TIME = "08:00";

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export async function generateRepRoute(
  rep: Rep,
  stores: Store[],
  startTime: string = DEFAULT_START_TIME,
  googleDeadline?: number,
  outlierRadiusKm?: number
): Promise<RepRoutePlan> {
  // Separate stores we can actually route (valid GPS) from those with missing
  // or corrupted coordinates. Bad coords (e.g. a lat of -260896520 from a lost
  // decimal point, or a (0,0) placeholder) would otherwise produce astronomical
  // distances and poison both the centroid anchor and every travel estimate.
  const withGps: Store[] = [];
  const noGps: Store[] = [];
  for (const s of stores) {
    (parseLatLng(s.gpsLat, s.gpsLng) ? withGps : noGps).push(s);
  }

  // Hold out stores that are far outside the rep's working area (likely an
  // allocation error) until a manager confirms they belong in the cycle. A
  // store flagged `rangeConfirmed` is always kept regardless of distance.
  const routable: Store[] = [];
  const outOfRange: { store: Store; distanceKm: number }[] = [];
  const center = outlierRadiusKm ? medianCenter(withGps) : null;
  for (const s of withGps) {
    if (center && !s.rangeConfirmed) {
      const p = parseLatLng(s.gpsLat, s.gpsLng)!;
      const d = haversineKm(center.lat, center.lng, p.lat, p.lng);
      if (d > outlierRadiusKm!) {
        outOfRange.push({ store: s, distanceKm: Math.round(d) });
        continue;
      }
    }
    routable.push(s);
  }

  // If the rep has no valid home GPS loaded, default the start/end point to the
  // centroid of their routable stores so routes still generate (and Google
  // optimisation still runs) from a sensible anchor in the middle of their patch.
  const home = parseLatLng(rep.homeGpsLat, rep.homeGpsLng) ?? storeCentroid(routable);
  const workingMinutes = (rep.workingHoursPerDay ?? DEFAULT_WORKING_HOURS) * 60;

  // Step 1: Distribute stores across weeks based on frequency
  const weekAssignments = distributeToWeeks(routable);

  // Step 2: For each week, cluster stores into 5 day-groups
  const dayPlans: RouteDayPlan[] = [];
  const unassigned: { storeId: string; storeName: string; reason: string }[] = [];

  for (const week of WEEKS) {
    const weekStores = weekAssignments.get(week) || [];
    if (weekStores.length === 0) continue;

    // Cluster into 5 day groups
    const clusters = clusterIntoDays(weekStores, home);

    for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
      const dayStores = clusters[dayIdx] || [];
      if (dayStores.length === 0) continue;

      // Step 3: Optimize visit order
      const plan = await buildDayPlan(
        dayStores,
        home,
        week,
        DAYS[dayIdx],
        startTime,
        workingMinutes,
        googleDeadline
      );

      // Step 3b: If over capacity, remove last stores
      if (plan.overCapacity) {
        const removed = trimToCapacity(plan, workingMinutes);
        for (const r of removed) {
          unassigned.push({
            storeId: r.storeId,
            storeName: r.storeName,
            reason: "Over daily capacity",
          });
        }
      }

      dayPlans.push(plan);
    }
  }

  // Step 4: Try to fit unassigned stores into days with remaining capacity
  const stillUnassigned = await rebalanceOverflow(
    dayPlans,
    unassigned,
    home,
    startTime,
    workingMinutes
  );

  const noGpsUnassigned = noGps.map((s) => ({
    storeId: s.id,
    storeName: s.name,
    reason: "Missing or invalid GPS coordinates",
  }));

  const outOfRangeUnassigned = outOfRange.map(({ store, distanceKm }) => ({
    storeId: store.id,
    storeName: store.name,
    reason: `Out of range (${distanceKm} km from rep's area) — confirm to include`,
  }));

  return {
    repCode: rep.code,
    repName: rep.name,
    homeLatLng: home,
    workingHoursPerDay: rep.workingHoursPerDay ?? DEFAULT_WORKING_HOURS,
    generatedAt: new Date().toISOString(),
    days: dayPlans,
    stats: {
      totalStores: stores.length,
      unassignedStores: [...noGpsUnassigned, ...outOfRangeUnassigned, ...stillUnassigned],
    },
  };
}

// ──────────────────────────────────────────────
// Step 1: Frequency → Week Distribution
// ──────────────────────────────────────────────

function distributeToWeeks(stores: Store[]): Map<WeekLabel, Store[]> {
  const result = new Map<WeekLabel, Store[]>();
  for (const w of WEEKS) result.set(w, []);

  // Counters for round-robin balancing
  let rrMonthly = 0;
  let rrBimonthly = 0;

  for (const store of stores) {
    const freq: FrequencyType = store.frequency || "monthly";
    switch (freq) {
      case "weekly":
        // Visit every week
        for (const w of WEEKS) result.get(w)!.push(store);
        break;
      case "3x_monthly":
        // Weeks 1, 2, 3
        result.get("Wk1")!.push(store);
        result.get("Wk2")!.push(store);
        result.get("Wk3")!.push(store);
        break;
      case "2x_monthly":
        // Alternate: half in Wk1+Wk3, half in Wk2+Wk4
        if (rrBimonthly % 2 === 0) {
          result.get("Wk1")!.push(store);
          result.get("Wk3")!.push(store);
        } else {
          result.get("Wk2")!.push(store);
          result.get("Wk4")!.push(store);
        }
        rrBimonthly++;
        break;
      case "monthly":
        // Round-robin across 4 weeks
        result.get(WEEKS[rrMonthly % 4])!.push(store);
        rrMonthly++;
        break;
      case "bimonthly":
      case "quarterly":
        // Wk1 only, round-robin to balance
        result.get("Wk1")!.push(store);
        break;
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// Step 2: Geographic Clustering (K-Means, K=5)
// ──────────────────────────────────────────────

interface GeoStore {
  store: Store;
  lat: number;
  lng: number;
}

function clusterIntoDays(
  stores: Store[],
  home: { lat: number; lng: number } | null
): Store[][] {
  const geoStores: GeoStore[] = stores
    .map((s) => ({
      store: s,
      lat: parseFloat(s.gpsLat),
      lng: parseFloat(s.gpsLng),
    }))
    .filter((g) => !isNaN(g.lat) && !isNaN(g.lng));

  if (geoStores.length === 0) return [[], [], [], [], []];

  // For very small sets, just distribute evenly
  if (geoStores.length <= 5) {
    const clusters: Store[][] = [[], [], [], [], []];
    geoStores.forEach((g, i) => clusters[i % 5].push(g.store));
    return clusters;
  }

  // K-Means clustering with K=5
  const K = 5;
  const maxIterations = 20;

  // Initialize centroids using K-means++ style
  const centroids = initializeCentroids(geoStores, K);
  let assignments = new Array(geoStores.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each store to nearest centroid
    const newAssignments = geoStores.map((g) => {
      let minDist = Infinity;
      let closest = 0;
      for (let k = 0; k < K; k++) {
        const d = haversineKm(g.lat, g.lng, centroids[k].lat, centroids[k].lng);
        if (d < minDist) {
          minDist = d;
          closest = k;
        }
      }
      return closest;
    });

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Recompute centroids
    for (let k = 0; k < K; k++) {
      const members = geoStores.filter((_, i) => assignments[i] === k);
      if (members.length > 0) {
        centroids[k] = {
          lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length,
          lng: members.reduce((sum, m) => sum + m.lng, 0) / members.length,
        };
      }
    }
  }

  // Balance cluster sizes (target ±2 stores)
  const clusters: GeoStore[][] = Array.from({ length: K }, () => []);
  geoStores.forEach((g, i) => clusters[assignments[i]].push(g));
  balanceClusters(clusters, centroids);

  // Sort clusters by angle from home (or centroid center) for geographic ordering
  const refPoint = home || {
    lat: geoStores.reduce((s, g) => s + g.lat, 0) / geoStores.length,
    lng: geoStores.reduce((s, g) => s + g.lng, 0) / geoStores.length,
  };

  const sorted = clusters
    .map((cluster, idx) => ({
      cluster,
      angle: Math.atan2(
        centroids[idx].lat - refPoint.lat,
        centroids[idx].lng - refPoint.lng
      ),
    }))
    .sort((a, b) => a.angle - b.angle)
    .map((c) => c.cluster.map((g) => g.store));

  return sorted;
}

function initializeCentroids(
  stores: GeoStore[],
  k: number
): { lat: number; lng: number }[] {
  const centroids: { lat: number; lng: number }[] = [];
  // First centroid: random
  const first = stores[Math.floor(Math.random() * stores.length)];
  centroids.push({ lat: first.lat, lng: first.lng });

  // Subsequent centroids: farthest from existing
  for (let i = 1; i < k; i++) {
    let maxMinDist = -1;
    let best = stores[0];
    for (const s of stores) {
      const minDist = Math.min(
        ...centroids.map((c) => haversineKm(s.lat, s.lng, c.lat, c.lng))
      );
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        best = s;
      }
    }
    centroids.push({ lat: best.lat, lng: best.lng });
  }

  return centroids;
}

function balanceClusters(
  clusters: GeoStore[][],
  centroids: { lat: number; lng: number }[]
): void {
  const totalStores = clusters.reduce((s, c) => s + c.length, 0);
  const target = Math.ceil(totalStores / clusters.length);
  const maxSize = target + 2;

  // Move stores from oversized clusters to undersized ones
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < clusters.length; i++) {
      while (clusters[i].length > maxSize) {
        // Find the store farthest from this centroid
        let farthestIdx = 0;
        let farthestDist = 0;
        for (let j = 0; j < clusters[i].length; j++) {
          const d = haversineKm(
            clusters[i][j].lat,
            clusters[i][j].lng,
            centroids[i].lat,
            centroids[i].lng
          );
          if (d > farthestDist) {
            farthestDist = d;
            farthestIdx = j;
          }
        }

        // Find nearest undersized cluster
        const store = clusters[i][farthestIdx];
        let bestCluster = -1;
        let bestDist = Infinity;
        for (let k = 0; k < clusters.length; k++) {
          if (k === i || clusters[k].length >= maxSize) continue;
          const d = haversineKm(
            store.lat,
            store.lng,
            centroids[k].lat,
            centroids[k].lng
          );
          if (d < bestDist) {
            bestDist = d;
            bestCluster = k;
          }
        }

        if (bestCluster === -1) break;
        clusters[bestCluster].push(store);
        clusters[i].splice(farthestIdx, 1);
      }
    }
  }
}

// ──────────────────────────────────────────────
// Step 3: Visit Order Optimization
// ──────────────────────────────────────────────

async function buildDayPlan(
  stores: Store[],
  home: { lat: number; lng: number } | null,
  week: WeekLabel,
  day: DayLabel,
  startTime: string,
  workingMinutes: number,
  googleDeadline?: number
): Promise<RouteDayPlan> {
  const storePoints = stores.map((s) => ({
    store: s,
    lat: parseFloat(s.gpsLat),
    lng: parseFloat(s.gpsLng),
  }));

  let orderedStores: typeof storePoints;
  let legs: { distanceKm: number; durationMin: number }[] = [];
  let polyline: string | undefined;

  // Try Google Maps optimization — but only while we're inside the time budget.
  // Past the deadline we fall back to the instant Haversine method so a bulk
  // "generate all reps" run always finishes within the function timeout.
  const withinBudget = googleDeadline === undefined || Date.now() < googleDeadline;
  if (hasGoogleMapsKey() && home && storePoints.length > 0 && withinBudget) {
    const waypoints = storePoints.map((s) => ({ lat: s.lat, lng: s.lng }));
    const result = await getOptimizedRoute(home, home, waypoints);

    if (result) {
      // Reorder stores by Google's optimized order
      orderedStores = result.waypointOrder.map((i) => storePoints[i]);
      legs = result.legs.map((l) => ({
        distanceKm: l.distanceMeters / 1000,
        durationMin: l.durationSeconds / 60,
      }));
      polyline = result.polyline;
    } else {
      // Fallback to Haversine
      const nn = nearestNeighborOrder(storePoints, home);
      orderedStores = nn.ordered;
      legs = nn.legs;
    }
  } else {
    // Haversine nearest-neighbor
    const nn = nearestNeighborOrder(storePoints, home);
    orderedStores = nn.ordered;
    legs = nn.legs;
  }

  // Build stops with arrival/departure times
  const stops: RouteStop[] = [];
  let currentTime = parseTime(startTime);

  for (let i = 0; i < orderedStores.length; i++) {
    const s = orderedStores[i];
    const travelTime = legs[i]?.durationMin || 0;
    const travelDist = legs[i]?.distanceKm || 0;

    currentTime += travelTime;
    const arrivalTime = formatTime(currentTime);
    const visitDuration = s.store.duration || 30;
    const departureTime = formatTime(currentTime + visitDuration);

    stops.push({
      storeId: s.store.id,
      storeName: s.store.name,
      lat: s.lat,
      lng: s.lng,
      visitDuration,
      travelTimeFromPrev: Math.round(travelTime * 10) / 10,
      distanceFromPrev: Math.round(travelDist * 10) / 10,
      arrivalTime,
      departureTime,
      sequence: i + 1,
    });

    currentTime += visitDuration;
  }

  // Add return-home travel time to total
  const lastLeg = legs[orderedStores.length];
  const returnTravel = lastLeg?.durationMin || 0;
  const returnDist = lastLeg?.distanceKm || 0;

  const totalTravelTime =
    stops.reduce((s, st) => s + st.travelTimeFromPrev, 0) + returnTravel;
  const totalVisitTime = stops.reduce((s, st) => s + st.visitDuration, 0);
  const totalDistance =
    stops.reduce((s, st) => s + st.distanceFromPrev, 0) + returnDist;

  return {
    day,
    week,
    stops,
    totalTravelTime: Math.round(totalTravelTime),
    totalVisitTime: Math.round(totalVisitTime),
    totalTime: Math.round(totalTravelTime + totalVisitTime),
    totalDistance: Math.round(totalDistance * 10) / 10,
    overCapacity: totalTravelTime + totalVisitTime > workingMinutes,
    polyline,
  };
}

function nearestNeighborOrder(
  stores: { store: Store; lat: number; lng: number }[],
  home: { lat: number; lng: number } | null
): {
  ordered: typeof stores;
  legs: { distanceKm: number; durationMin: number }[];
} {
  if (stores.length === 0) return { ordered: [], legs: [] };

  const remaining = [...stores];
  const ordered: typeof stores = [];
  const legs: { distanceKm: number; durationMin: number }[] = [];
  let current = home || { lat: remaining[0].lat, lng: remaining[0].lng };

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(
        current.lat,
        current.lng,
        remaining[i].lat,
        remaining[i].lng
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    const next = remaining.splice(nearestIdx, 1)[0];
    legs.push({
      distanceKm: nearestDist,
      durationMin: (nearestDist / DEFAULT_SPEED_KMH) * 60,
    });
    ordered.push(next);
    current = { lat: next.lat, lng: next.lng };
  }

  // Add return-home leg
  if (home && ordered.length > 0) {
    const last = ordered[ordered.length - 1];
    const returnDist = haversineKm(last.lat, last.lng, home.lat, home.lng);
    legs.push({
      distanceKm: returnDist,
      durationMin: (returnDist / DEFAULT_SPEED_KMH) * 60,
    });
  }

  return { ordered, legs };
}

// ──────────────────────────────────────────────
// Step 3b: Trim over-capacity days
// ──────────────────────────────────────────────

function trimToCapacity(
  plan: RouteDayPlan,
  workingMinutes: number
): RouteStop[] {
  const removed: RouteStop[] = [];
  while (plan.totalTime > workingMinutes && plan.stops.length > 1) {
    const last = plan.stops.pop()!;
    removed.push(last);
    plan.totalVisitTime -= last.visitDuration;
    plan.totalTravelTime -= last.travelTimeFromPrev;
    plan.totalTime = plan.totalTravelTime + plan.totalVisitTime;
    plan.totalDistance -= last.distanceFromPrev;
  }
  plan.overCapacity = plan.totalTime > workingMinutes;
  return removed;
}

// ──────────────────────────────────────────────
// Step 4: Overflow Rebalancing
// ──────────────────────────────────────────────

async function rebalanceOverflow(
  dayPlans: RouteDayPlan[],
  unassigned: { storeId: string; storeName: string; reason: string }[],
  home: { lat: number; lng: number } | null,
  startTime: string,
  workingMinutes: number
): Promise<{ storeId: string; storeName: string; reason: string }[]> {
  const stillUnassigned = [...unassigned];
  const fitted: number[] = [];

  for (let i = stillUnassigned.length - 1; i >= 0; i--) {
    const store = stillUnassigned[i];

    // Find day with most remaining capacity
    let bestDay: RouteDayPlan | null = null;
    let bestRemaining = 0;

    for (const plan of dayPlans) {
      const remaining = workingMinutes - plan.totalTime;
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        bestDay = plan;
      }
    }

    // Need at least 30 min for a visit + some travel
    if (bestDay && bestRemaining > 45) {
      // Add store as last stop with estimated travel
      const lastStop = bestDay.stops[bestDay.stops.length - 1];
      const estimatedTravel = 15; // rough estimate in minutes
      const estimatedDist = 10; // rough estimate in km
      const visitDuration = 30; // default

      if (bestDay.totalTime + estimatedTravel + visitDuration <= workingMinutes) {
        const currentTime =
          parseTime(startTime) +
          bestDay.totalTravelTime +
          bestDay.totalVisitTime;

        bestDay.stops.push({
          storeId: store.storeId,
          storeName: store.storeName,
          lat: 0,
          lng: 0,
          visitDuration,
          travelTimeFromPrev: estimatedTravel,
          distanceFromPrev: estimatedDist,
          arrivalTime: formatTime(currentTime + estimatedTravel),
          departureTime: formatTime(
            currentTime + estimatedTravel + visitDuration
          ),
          sequence: bestDay.stops.length + 1,
        });

        bestDay.totalTravelTime += estimatedTravel;
        bestDay.totalVisitTime += visitDuration;
        bestDay.totalTime += estimatedTravel + visitDuration;
        bestDay.totalDistance += estimatedDist;
        bestDay.overCapacity = bestDay.totalTime > workingMinutes;

        fitted.push(i);
      }
    }
  }

  // Remove fitted stores from unassigned
  for (const idx of fitted) {
    stillUnassigned.splice(idx, 1);
  }

  return stillUnassigned;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

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

/**
 * Component-wise median lat/lng of stores with valid GPS — a robust centre of a
 * rep's working area that isn't dragged toward a few far-flung outliers (unlike
 * the mean). Used for out-of-range detection.
 */
export function medianCenter(stores: Store[]): { lat: number; lng: number } | null {
  const pts = stores
    .map((s) => parseLatLng(s.gpsLat, s.gpsLng))
    .filter((p): p is { lat: number; lng: number } => p !== null);
  if (pts.length === 0) return null;
  const med = (nums: number[]) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return { lat: med(pts.map((p) => p.lat)), lng: med(pts.map((p) => p.lng)) };
}

/** Average lat/lng of all stores with valid GPS — a fallback "home" anchor. */
function storeCentroid(stores: Store[]): { lat: number; lng: number } | null {
  const pts = stores
    .map((s) => parseLatLng(s.gpsLat, s.gpsLng))
    .filter((p): p is { lat: number; lng: number } => p !== null);
  if (pts.length === 0) return null;
  return {
    lat: pts.reduce((sum, p) => sum + p.lat, 0) / pts.length,
    lng: pts.reduce((sum, p) => sum + p.lng, 0) / pts.length,
  };
}

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

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
