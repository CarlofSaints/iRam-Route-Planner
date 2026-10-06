import {
  Rep,
  Store,
  FrequencyType,
  RouteStop,
  RouteDayPlan,
  RepRoutePlan,
  WeekLabel,
  DayLabel,
  getVisitsPerWeek,
} from "./types";
import { getOptimizedRoute, hasGoogleMapsKey } from "./google-maps";
import { parseLatLng, haversineKm, DEFAULT_SPEED_KMH, driveMinutes } from "./latlng";
import { parseClock, formatClock } from "./clock";
import { isForeignCoordinate } from "./saCoordinates";

/**
 * Why a store with a coordinate outside South Africa was not routed. Says "GPS"
 * on purpose: the Routes page offers its coordinate-fix boxes on any reason
 * that does, and that is the fix this store needs.
 */
export const FOREIGN_GPS_REASON = "GPS is outside South Africa, fix the coordinates";

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];
const DAYS: DayLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DEFAULT_WORKING_HOURS = 8.5;
const DEFAULT_START_TIME = "08:00";

/**
 * How many Google Directions calls are in flight at once.
 *
 * Google's own ceiling is 3 000 requests a minute. At roughly 260 ms a call,
 * six in flight is about 1 380 a minute — comfortably under, with room for the
 * latency to be worse than measured. Raising this is the lever if generation
 * ever gets slow again; it is not free above about 12, where the rate starts
 * approaching Google's limit and a 429 would cost more than the wait saved.
 *
 * This replaced a fixed `delay(80)` before every call, which was rate limiting
 * by sleeping: it throttled the whole run to three calls a second whether or
 * not anything was in flight, and accounted for a quarter of the time budget.
 */
const GOOGLE_CONCURRENCY = 6;

/**
 * Run an async job over a list, at most `limit` at a time, results in order.
 *
 * Deliberately not `Promise.all` over everything: 705 simultaneous requests
 * would trip Google's per-minute rate limit and bury the function in sockets.
 * Deliberately not a library, either — this is fifteen lines and the engine has
 * no runtime dependencies.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  job: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    // Each worker takes the next index until the list is exhausted. `next++` is
    // safe without a lock: JS is single-threaded between awaits, so no two
    // workers can read the same index.
    while (next < items.length) {
      const i = next++;
      results[i] = await job(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export async function generateRepRoute(
  rep: Rep,
  stores: Store[],
  startTime: string = DEFAULT_START_TIME,
  googleDeadline?: number,
  outlierRadiusKm?: number,
  callsPerDay?: number
): Promise<RepRoutePlan> {
  // Separate stores we can actually route (valid GPS) from those with missing
  // or corrupted coordinates. Bad coords (e.g. a lat of -260896520 from a lost
  // decimal point, or a (0,0) placeholder) would otherwise produce astronomical
  // distances and poison both the centroid anchor and every travel estimate.
  const withGps: Store[] = [];
  const noGps: Store[] = [];
  // A real number pair that is not in South Africa (a store name geocoded
  // without a country, or latitude and longitude swapped) is BROKEN, not far
  // away. Held out before the out-of-range check, so it can never be offered
  // as "confirm to include", is never routed even if someone confirmed it,
  // and cannot drag the rep's median centre or centroid anchor off the map.
  const foreignGps: Store[] = [];
  for (const s of stores) {
    if (!parseLatLng(s.gpsLat, s.gpsLng)) noGps.push(s);
    else if (isForeignCoordinate(s.gpsLat, s.gpsLng)) foreignGps.push(s);
    else withGps.push(s);
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
  const unassigned: OverflowCandidate[] = [];
  /** Every day that has stores, gathered before any of them is optimised. */
  const pending: { week: WeekLabel; dayIdx: number; dayStores: Store[] }[] = [];

  for (const week of WEEKS) {
    const weekStores = weekAssignments.get(week) || [];
    if (weekStores.length === 0) continue;

    // Stores called on more than once a week (daily, 3x/2x weekly) can't be
    // handed to the clusterer, which places each store on exactly one day.
    // They are pinned to evenly spread days instead, and only the once-a-week
    // remainder gets clustered geographically.
    const multiDay: Store[] = [];
    const singleDay: Store[] = [];
    for (const s of weekStores) {
      (getVisitsPerWeek(s.frequency || "monthly") > 1 ? multiDay : singleDay).push(s);
    }

    // A store called on several times a week is pinned to fixed days FIRST, so
    // the balancer knows how much room each day has left. Pinning after the
    // balance would silently push days back over the target.
    const pinnedPerDay = [0, 0, 0, 0, 0];
    const pins: Store[][] = [[], [], [], [], []];
    for (const store of multiDay) {
      for (const dayIdx of spreadAcrossDays(getVisitsPerWeek(store.frequency || "monthly"))) {
        pins[dayIdx].push(store);
        pinnedPerDay[dayIdx]++;
      }
    }

    // Cluster into 5 day groups. The target and the already-pinned stores go
    // in together: the balancer needs both to know how much room a day has.
    const clusters = clusterIntoDays(singleDay, home, { callsPerDay, pinnedPerDay });

    for (let dayIdx = 0; dayIdx < pins.length; dayIdx++) {
      for (const store of pins[dayIdx]) (clusters[dayIdx] ||= []).push(store);
    }

    for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
      const dayStores = clusters[dayIdx] || [];
      if (dayStores.length === 0) continue;
      pending.push({ week, dayIdx, dayStores });
    }
  }

  // Step 3: optimise every day's visit order.
  //
  // 🔴 Run CONCURRENTLY. Each day is one Google Directions round trip of about
  // 260 ms, and there are 705 of them across the book — sequentially that is
  // four minutes, against a 45-second budget inside a 120-second function. The
  // budget always ran out, and when it did the engine fell back to straight
  // lines SILENTLY: 29 of 37 reps carried "as the crow flies" distances, which
  // understates their drive and makes their capacity look better than it is.
  //
  // The days are independent — clustering has already decided which store goes
  // where — so the only thing sequencing bought was slowness. Results are
  // collected in order, so the plan is byte-identical to the sequential one.
  const builtPlans = await mapWithConcurrency(
    pending,
    GOOGLE_CONCURRENCY,
    ({ week, dayIdx, dayStores }) =>
      buildDayPlan(dayStores, home, week, DAYS[dayIdx], startTime, workingMinutes, googleDeadline)
  );

  {
    for (let i = 0; i < pending.length; i++) {
      const plan = builtPlans[i];

      // Step 3b: bring the day back within whichever cap is in force.
      //
      // 🔴 With a calls-per-day target the COUNT is the instruction and the
      // clock is advice. The manager asked for eight calls, so eight are
      // scheduled and a day that runs long says so, rather than quietly
      // dropping the eighth store and looking like the setting was ignored.
      // Without a target, the old time-based trim is untouched.
      const removed = callsPerDay && callsPerDay > 0
        ? trimToCount(plan, callsPerDay, workingMinutes, home)
        : plan.overCapacity
          ? trimToCapacity(plan, workingMinutes, home)
          : [];
      for (const r of removed) {
        // Carry the whole planned stop, not just its name. It already holds
        // the store's real coordinates and visit duration, and rebalancing
        // needs them to put the store back on the map in the right place.
        unassigned.push({
          storeId: r.storeId,
          storeName: r.storeName,
          reason: callsPerDay && callsPerDay > 0
            ? `Over the ${callsPerDay} calls per day target`
            : "Over daily capacity",
          stop: r,
        });
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
    workingMinutes,
    callsPerDay
  );

  const noGpsUnassigned = noGps.map((s) => ({
    storeId: s.id,
    storeName: s.name,
    reason: "Missing or invalid GPS coordinates",
  }));

  const foreignUnassigned = foreignGps.map((s) => ({
    storeId: s.id,
    storeName: s.name,
    reason: FOREIGN_GPS_REASON,
  }));

  const outOfRangeUnassigned = outOfRange.map(({ store, distanceKm }) => ({
    storeId: store.id,
    storeName: store.name,
    reason: `Out of range (${distanceKm} km from rep's area), confirm to include`,
  }));

  return {
    repCode: rep.code,
    repName: rep.name,
    homeLatLng: home,
    workingHoursPerDay: rep.workingHoursPerDay ?? DEFAULT_WORKING_HOURS,
    // Stamped on the rep, so a week can say what it was built on even when the
    // document as a whole was built on something else.
    callsPerDay: callsPerDay && callsPerDay > 0 ? callsPerDay : undefined,
    generatedAt: new Date().toISOString(),
    days: dayPlans,
    stats: {
      totalStores: stores.length,
      unassignedStores: [...noGpsUnassigned, ...foreignUnassigned, ...outOfRangeUnassigned, ...stillUnassigned],
    },
  };
}

// ──────────────────────────────────────────────
// Step 1: Frequency → Week Distribution
// ──────────────────────────────────────────────

/**
 * Which day indexes a store visited n times a week should land on, spread as
 * evenly as the 5-day week allows: 5 → every day, 3 → Mon/Wed/Fri,
 * 2 → Mon/Fri. Keeping the gaps even matters because these are service calls,
 * not just extra volume — two visits on consecutive days is not the same
 * coverage as two visits three days apart.
 */
function spreadAcrossDays(visitsPerWeek: number): number[] {
  const n = Math.max(1, Math.min(visitsPerWeek, DAYS.length));
  if (n === 1) return [0];
  if (n >= DAYS.length) return DAYS.map((_, i) => i);
  const last = DAYS.length - 1;
  const days = new Set<number>();
  for (let i = 0; i < n; i++) days.add(Math.round((i * last) / (n - 1)));
  return [...days].sort((a, b) => a - b);
}

function distributeToWeeks(stores: Store[]): Map<WeekLabel, Store[]> {
  const result = new Map<WeekLabel, Store[]>();
  for (const w of WEEKS) result.set(w, []);

  // Counters for round-robin balancing
  let rrMonthly = 0;
  let rrBimonthly = 0;

  for (const store of stores) {
    const freq: FrequencyType = store.frequency || "monthly";
    switch (freq) {
      case "daily":
      case "3x_weekly":
      case "2x_weekly":
      case "weekly":
        // Present in every week. How many DAYS within each week is decided
        // later, by visitsPerWeek — see generateRepRoute.
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

export interface GeoStore {
  store: Store;
  lat: number;
  lng: number;
}

function clusterIntoDays(
  stores: Store[],
  home: { lat: number; lng: number } | null,
  opts: { callsPerDay?: number; pinnedPerDay?: number[] } = {}
): Store[][] {
  const geoStores: GeoStore[] = stores
    .map((s) => ({
      store: s,
      lat: parseFloat(s.gpsLat),
      lng: parseFloat(s.gpsLng),
    }))
    .filter((g) => !isNaN(g.lat) && !isNaN(g.lng));

  if (geoStores.length === 0) return [[], [], [], [], []];

  // For very small sets, just distribute evenly. Round-robin already respects
  // any sane target, because five stores over five days cannot exceed one a day.
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
  balanceClusters(clusters, centroids, opts);

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

  // 🔴 The first centroid was `stores[Math.floor(Math.random() * ...)]`, which
  // made the WHOLE call cycle non-deterministic: regenerating with no data
  // change at all reshuffled which store fell on which day, for every rep. A
  // rep's week moved under them for no reason, the Perigee schedule shifted with
  // it, and comparing two runs to see whether anything improved was impossible.
  //
  // Every other centroid is already chosen deterministically as "farthest from
  // the ones picked so far". The seed now follows the same rule — the store
  // farthest from the middle of the patch — which is the point k-means++ picks
  // a random one to approximate anyway. Ties break on store id so the answer
  // cannot depend on the order the list happened to arrive in.
  const mid = {
    lat: stores.reduce((s, g) => s + g.lat, 0) / stores.length,
    lng: stores.reduce((s, g) => s + g.lng, 0) / stores.length,
  };
  let first = stores[0];
  let firstDist = -1;
  for (const s of stores) {
    const d = haversineKm(mid.lat, mid.lng, s.lat, s.lng);
    if (d > firstDist || (d === firstDist && s.store.id < first.store.id)) {
      firstDist = d;
      first = s;
    }
  }
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

/**
 * Even out the day groups so no day carries far more calls than the others.
 *
 * K-means answers "which stores are near each other", which is the right
 * question for a driving route and the wrong one for a workload: left alone it
 * happily returns a Monday of 25 and a Friday of 3. This moves only the
 * surplus. From each oversized day it takes the store furthest from that day's
 * own centroid, the one the cluster has least claim to, and gives it to the
 * nearest day that still has room. The route stays sensible, the load evens.
 *
 * Two modes:
 *   - No target: the original behaviour. Aim for an even split of whatever the
 *     rep has, tolerating two stores either way.
 *   - `callsPerDay` set: the manager has named a number, so the cap is exact
 *     and per day, and `pinnedPerDay` (multi-visit stores already fixed to a
 *     day, which cannot be moved) counts against that day's room.
 *
 * A cap can be UNREACHABLE — five days at eight calls holds forty, and the rep
 * may have sixty. Nothing here invents days: the surplus stays put and is
 * trimmed later, where it can be reported as overflow rather than lost here.
 */
export function balanceClusters(
  clusters: GeoStore[][],
  centroids: { lat: number; lng: number }[],
  opts: { callsPerDay?: number; pinnedPerDay?: number[] } = {}
): void {
  const { callsPerDay, pinnedPerDay = [] } = opts;
  const totalStores = clusters.reduce((s, c) => s + c.length, 0);

  // How many stores this day may hold. With a target it is the target less
  // whatever is already pinned there; without one it is the old even split
  // with its two-store tolerance.
  const capFor = (i: number) =>
    callsPerDay && callsPerDay > 0
      ? Math.max(0, callsPerDay - (pinnedPerDay[i] ?? 0))
      : Math.ceil(totalStores / clusters.length) + 2;

  // Move stores from oversized clusters to undersized ones.
  //
  // Runs until a pass changes nothing rather than a fixed three: three passes
  // were plenty for a soft +2 band, but an exact per-day cap can need more,
  // and stopping early would leave the day over the number the manager set.
  // Bounded by the store count, so an unreachable cap terminates instead of
  // spinning.
  for (let pass = 0; pass < totalStores + clusters.length; pass++) {
    let moved = false;
    for (let i = 0; i < clusters.length; i++) {
      while (clusters[i].length > capFor(i)) {
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
          if (k === i || clusters[k].length >= capFor(k)) continue;
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
        moved = true;
      }
    }
    if (!moved) break;
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

  const plan: RouteDayPlan = {
    day,
    week,
    stops,
    totalTravelTime: 0,
    totalVisitTime: 0,
    totalTime: 0,
    totalDistance: 0,
    overCapacity: false,
    polyline,
  };

  // Every total on the day is built in one place, so the leg home can never be
  // in one of them and missing from another. Google's own last leg is handed
  // over when it exists — it is a real road distance, and re-measuring it as a
  // straight line here would throw that away.
  const lastLeg = home ? legs[orderedStores.length] : undefined;
  applyReturnLeg(plan, home, workingMinutes, lastLeg);
  return plan;
}

/**
 * Measure the leg home from whatever stop the day now ends on, and rebuild the
 * day's totals around it.
 *
 * 🔴 This exists because the totals were only ever true at the instant the day
 * was built. Trimming to the calls-per-day target pops stops off the END, and
 * the old code subtracted the dropped stop's leg IN while leaving the leg HOME
 * exactly as it was — still measured from a shop that is no longer on the
 * route. With 3 491 visits trimmed over the 8-call target, almost every day in
 * the current plan carries that stale figure, and `totalTime` is what capacity
 * and the calls-per-day argument are read off.
 *
 * `leg` is the measured drive home when one is known (Google's last leg at
 * build time); without it the distance is a straight line from the new last
 * stop, which is the same basis as every other leg the fallback produces.
 */
function applyReturnLeg(
  plan: RouteDayPlan,
  home: { lat: number; lng: number } | null,
  workingMinutes: number,
  leg?: { distanceKm: number; durationMin: number }
): void {
  const last = plan.stops[plan.stops.length - 1];

  if (!home || !last) {
    // No anchor means there is no drive home to price. Left ABSENT rather than
    // zeroed: a reader must be able to tell "no leg home" from "the rep lives
    // next door to their last call".
    delete plan.returnDistanceKm;
    delete plan.returnTravelTime;
    delete plan.arriveHomeTime;
  } else {
    const distanceKm = leg
      ? leg.distanceKm
      : haversineKm(last.lat, last.lng, home.lat, home.lng);
    const durationMin = leg ? leg.durationMin : driveMinutes(distanceKm);
    plan.returnDistanceKm = Math.round(distanceKm * 10) / 10;
    plan.returnTravelTime = Math.round(durationMin * 10) / 10;
    plan.arriveHomeTime = formatTime(parseTime(last.departureTime) + durationMin);
  }

  const returnTravel = plan.returnTravelTime ?? 0;
  const returnDist = plan.returnDistanceKm ?? 0;
  const travel = plan.stops.reduce((s, st) => s + st.travelTimeFromPrev, 0) + returnTravel;
  const visits = plan.stops.reduce((s, st) => s + st.visitDuration, 0);
  const distance = plan.stops.reduce((s, st) => s + st.distanceFromPrev, 0) + returnDist;

  plan.totalTravelTime = Math.round(travel);
  plan.totalVisitTime = Math.round(visits);
  plan.totalTime = Math.round(travel + visits);
  plan.totalDistance = Math.round(distance * 10) / 10;
  applyOverrun(plan, workingMinutes);
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

/**
 * Cut a day down to the calls-per-day target.
 *
 * Trims from the END of the optimised order, so the stores dropped are the ones
 * furthest along the route rather than an arbitrary few. Unlike the time-based
 * trim this does NOT stop once the clock is satisfied: the count is the
 * instruction.
 *
 * The day's overrun is recorded on the way out. That is the whole bargain of
 * letting the target win: the plan schedules what was asked for AND admits when
 * the day is longer than the rep's hours.
 */
function trimToCount(
  plan: RouteDayPlan,
  callsPerDay: number,
  workingMinutes: number,
  home: { lat: number; lng: number } | null
): RouteStop[] {
  const removed: RouteStop[] = [];
  while (plan.stops.length > callsPerDay && plan.stops.length > 1) {
    removed.push(plan.stops.pop()!);
  }
  // Re-measured, not adjusted: dropping the last three calls changes where the
  // rep drives home FROM.
  if (removed.length > 0) applyReturnLeg(plan, home, workingMinutes);
  else applyOverrun(plan, workingMinutes);
  return removed;
}

/**
 * Record how far past the working day this one runs.
 *
 * `overCapacity` stays a plain boolean because every existing reader uses it.
 * The MINUTES are what make it actionable: "over capacity" on every second day
 * is noise, while "over by 8 minutes" and "over by two hours" are different
 * problems with different answers.
 *
 * Absent rather than zero when the day fits, so nothing renders "over by 0".
 */
export function applyOverrun(plan: RouteDayPlan, workingMinutes: number): void {
  const over = plan.totalTime - workingMinutes;
  plan.overCapacity = over > 0;
  plan.overrunMinutes = over > 0 ? Math.round(over) : undefined;
}

// ──────────────────────────────────────────────
// Step 3b: Trim over-capacity days
// ──────────────────────────────────────────────

function trimToCapacity(
  plan: RouteDayPlan,
  workingMinutes: number,
  home: { lat: number; lng: number } | null
): RouteStop[] {
  const removed: RouteStop[] = [];
  while (plan.totalTime > workingMinutes && plan.stops.length > 1) {
    removed.push(plan.stops.pop()!);
    // Inside the loop, because the new leg home is part of what decides
    // whether the day now fits: a shorter route ending 40 km out may not.
    applyReturnLeg(plan, home, workingMinutes);
  }
  plan.overCapacity = plan.totalTime > workingMinutes;
  return removed;
}

// ──────────────────────────────────────────────
// Step 4: Overflow Rebalancing
// ──────────────────────────────────────────────

/**
 * A store that was trimmed off a day and is waiting to be re-placed. `stop` is
 * the stop exactly as it was originally planned — it is what carries the real
 * coordinates and visit duration through the trim/refit round trip.
 */
type OverflowCandidate = {
  storeId: string;
  storeName: string;
  reason: string;
  stop?: RouteStop;
};

async function rebalanceOverflow(
  dayPlans: RouteDayPlan[],
  unassigned: OverflowCandidate[],
  home: { lat: number; lng: number } | null,
  startTime: string,
  workingMinutes: number,
  callsPerDay?: number
): Promise<{ storeId: string; storeName: string; reason: string }[]> {
  const stillUnassigned = [...unassigned];
  const fitted: number[] = [];

  for (let i = stillUnassigned.length - 1; i >= 0; i--) {
    const store = stillUnassigned[i];

    // Find day with most remaining capacity
    let bestDay: RouteDayPlan | null = null;
    let bestRemaining = 0;

    for (const plan of dayPlans) {
      // A day already at the target has no room, however much clock is left.
      // Without this the refit pass would quietly undo the cap it just applied.
      if (callsPerDay && callsPerDay > 0 && plan.stops.length >= callsPerDay) continue;
      const remaining = workingMinutes - plan.totalTime;
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        bestDay = plan;
      }
    }

    // Need at least 30 min for a visit + some travel
    if (bestDay && bestRemaining > 45) {
      const planned = store.stop;

      // Without the original stop there is no way to know where this store IS.
      // Placing it regardless is what wrote lat/lng 0,0 into saved plans and
      // drew real stores in the Gulf of Guinea. Leaving it unassigned is
      // honest — the plan reports it, an invented coordinate does not.
      if (!planned) continue;

      const lastStop = bestDay.stops[bestDay.stops.length - 1];
      const from = lastStop ? { lat: lastStop.lat, lng: lastStop.lng } : home;
      // Real leg from wherever the day currently ends, not a flat 10 km.
      const distanceKm = from
        ? haversineKm(from.lat, from.lng, planned.lat, planned.lng)
        : 0;
      const travelMin = driveMinutes(distanceKm);
      const visitDuration = planned.visitDuration;

      // What the day WOULD cost with this store on the end: the current total,
      // less the leg home it holds now, plus the new leg in, the visit, and the
      // longer drive home from the store just added. Comparing against the old
      // total alone let a store on at the far edge of the territory look free.
      const newReturnMin = home
        ? driveMinutes(haversineKm(planned.lat, planned.lng, home.lat, home.lng))
        : 0;
      const prospective =
        bestDay.totalTime -
        (bestDay.returnTravelTime ?? 0) +
        travelMin +
        visitDuration +
        newReturnMin;

      if (prospective <= workingMinutes) {
        // Arrive after the last stop departs. totalTravelTime includes the
        // return-home leg, so it can't be used as a clock.
        const departLast = lastStop
          ? parseTime(lastStop.departureTime)
          : parseTime(startTime);

        bestDay.stops.push({
          storeId: planned.storeId,
          storeName: planned.storeName,
          lat: planned.lat,
          lng: planned.lng,
          visitDuration,
          travelTimeFromPrev: Math.round(travelMin * 10) / 10,
          distanceFromPrev: Math.round(distanceKm * 10) / 10,
          arrivalTime: formatTime(departLast + travelMin),
          departureTime: formatTime(departLast + travelMin + visitDuration),
          sequence: bestDay.stops.length + 1,
        });

        // The day ends somewhere new now, so the leg home is re-measured and
        // every total rebuilt around it.
        applyReturnLeg(bestDay, home, workingMinutes);

        fitted.push(i);
      }
    }
  }

  // Remove fitted stores from unassigned
  for (const idx of fitted) {
    stillUnassigned.splice(idx, 1);
  }

  // Drop the carried stop — it exists only to survive the trim/refit round
  // trip, and the saved plan should not gain a duplicate copy of every stop.
  return stillUnassigned.map(({ storeId, storeName, reason }) => ({
    storeId,
    storeName,
    reason,
  }));
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Parse and validate a lat/lng pair — defined in `lib/latlng.ts` and re-exported
 * here, because the map page needs the same rule without the whole engine.
 */
export { parseLatLng };

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

export { haversineKm };

// One definition of a time of day, shared with the pages that now do the same
// arithmetic. The old local copy rounded the minutes AFTER dividing, so a stop
// leaving at 16:59.6 was stamped "16:60".
const parseTime = parseClock;
const formatTime = formatClock;
