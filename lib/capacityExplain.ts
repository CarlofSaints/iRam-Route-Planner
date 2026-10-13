import { Rep, Store, RepRoutePlan, getMonthlyRate } from "./types";
import { haversineKm, parseLatLng } from "./latlng";
import { parseRepHome } from "./saCoordinates";
import type { RepCapacity } from "./capacity";

/**
 * "Tell me why" on the Capacity page: the reasons behind one rep's number,
 * worked out from the same plan and stores the number came from.
 *
 * Written because a rep with 14 stores and 2.5 calls a day showed 502%, and
 * the grid gave no way to see that it was 814 hours of DRIVING: his home was
 * in Gauteng and every store in the Western Cape. Each finding here is arithmetic
 * on the data, never a guess, so a manager can act on it without checking.
 */

/**
 * A home further than this from the middle of the rep's stores is almost
 * certainly the wrong address or the wrong stores. Same figure as the default
 * out-of-range bracket, for the same reason: past it nobody drives daily.
 */
export const FAR_HOME_KM = 150;

/** Coordinates within this distance are the same start point. */
const SAME_POINT_KM = 1;

export type CauseKind =
  | "far_home"
  | "stale_home"
  | "no_home"
  | "book_too_big"
  | "driving_heavy"
  | "overrun"
  | "not_on_route"
  | "possible_duplicate";

export interface Cause {
  kind: CauseKind;
  title: string;
  detail: string;
  /** Click steps, in order. Empty when nothing needs doing. */
  fix: string[];
}

export interface ExplainStore {
  storeId: string;
  storeName: string;
  frequency: string;
  durationMin: number;
  callsPerMonth: number;
  /** Straight line from where the rep's day starts. Null when either end has no GPS. */
  kmFromStart: number | null;
  /** Visits of this store placed on the schedule. */
  scheduled: number;
  /** Visits the plan could not place, and why (first reason given). */
  missed: number;
  missedReason: string;
  /** Visit hours a month this store asks for: frequency x visit length. */
  hoursPerMonth: number;
  /** Visits a month the store asks for that are NOT on the route. */
  notOnRoute: number;
  /** Why they are not, in words a manager can act on. Empty when none are missing. */
  notOnRouteReason: string;
}

/** Visits missing from the route, grouped by why. */
export interface RouteGap {
  reason: string;
  visits: number;
  hours: number;
  stores: string[];
}

export interface ExplainDay {
  week: string;
  day: string;
  stops: number;
  visitMin: number;
  driveMin: number;
  driveKm: number;
  overCapacity: boolean;
}

export interface CapacityExplanation {
  repCode: string;
  repName: string;
  hasRoute: boolean;
  generatedAt: string | null;
  /** The sum, so the percentage can be checked by hand. */
  maths: {
    visitHours: number;
    travelHours: number;
    scheduledHours: number;
    availableHours: number;
    workingHoursPerDay: number;
    workingDays: number;
    utilization: number;
    bookVisitHours: number;
  };
  /** Where the PLAN started each day, and where the rep record says home is now. */
  start: {
    source: "home" | "store_centroid" | "older_home" | "none";
    planStart: { lat: number; lng: number } | null;
    currentHome: { lat: number; lng: number } | null;
    homeAddress: string;
    medianKmToStores: number | null;
  };
  /**
   * What the stores ask for against what the route holds. The grid percentage
   * only counts the route, so a rep whose stores ask for far more than their
   * hours can still show under 100% when half the visits never made it on.
   */
  route: {
    bookVisitHours: number;
    routedVisitHours: number;
    gapHours: number;
    gapVisits: number;
    byReason: RouteGap[];
  };
  causes: Cause[];
  stores: ExplainStore[];
  days: ExplainDay[];
}

const NO_GPS_REASON = "No GPS, so it cannot be placed on a route";
const NOT_PLACED_REASON = "Not placed on the route";

/**
 * The plan's own reason, said so a manager knows what to do about it. Kept
 * close to the engine's wording so it can still be matched to the Routes page.
 */
function plainReason(engineReason: string, hasGps: boolean): string {
  if (!hasGps || /gps|coordinate/i.test(engineReason)) return NO_GPS_REASON;
  if (/capacity/i.test(engineReason)) return "Did not fit in the working days";
  return engineReason || NOT_PLACED_REASON;
}

/** "MAKRO LIQUOR WONDERBOOM - M81L" and "... - M16L" are the same name. */
function baseName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s*[-(]\s*[A-Z]*\d+[A-Z]*\)?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng);
}

export function explainCapacity(
  rep: Rep,
  row: RepCapacity,
  allocated: Store[],
  plan: RepRoutePlan | null,
  generatedAt: string | null,
  workingDays: number
): CapacityExplanation {
  // The same parse the route engine uses for the home (a foreign pin is no home).
  const currentHome = parseRepHome(rep.homeGpsLat, rep.homeGpsLng);

  // Visit time the stores ask for on their own, before any driving. Worked out
  // here from the stores given, rather than read off the capacity row, so
  // this file is the same in iRam and Clippa (whose rows do not carry it).
  const bookVisitHours = allocated.reduce(
    (t, s) => t + getMonthlyRate(s.frequency || "monthly") * (s.duration || 0),
    0
  ) / 60;
  const bookExceedsHours = allocated.length > 0 && bookVisitHours > row.availableHours;
  const bookOverBy = row.availableHours > 0 ? round1(bookVisitHours / row.availableHours) : 0;
  const planStart = plan?.homeLatLng ?? null;
  // The plan is the truth about what was measured; the rep record only says
  // what the NEXT generation will use.
  const startPoint = planStart ?? currentHome;
  const planStartedAtHome =
    !!planStart && !!currentHome && km(planStart, currentHome) <= SAME_POINT_KM;

  // Visits placed and visits missed, per store. The plan lists a store once per
  // missed VISIT, so a weekly store that never fits appears four times.
  const scheduled = new Map<string, number>();
  for (const d of plan?.days ?? []) {
    for (const s of d.stops) scheduled.set(s.storeId, (scheduled.get(s.storeId) ?? 0) + 1);
  }
  const missed = new Map<string, { count: number; reason: string }>();
  for (const u of plan?.stats?.unassignedStores ?? []) {
    const m = missed.get(u.storeId);
    if (m) m.count++;
    else missed.set(u.storeId, { count: 1, reason: u.reason });
  }

  const stores: ExplainStore[] = allocated
    .map((s) => {
      const p = parseLatLng(s.gpsLat, s.gpsLng);
      const rate = getMonthlyRate(s.frequency || "monthly");
      const placed = scheduled.get(s.id) ?? 0;
      // Counted from the store's own rhythm, not from the plan's unassigned
      // list: a store with no GPS is listed there ONCE however many visits it
      // asks for, so that list understates the gap.
      const notOnRoute = Math.max(0, Math.round(rate) - placed);
      return {
        storeId: s.id,
        storeName: s.name,
        frequency: s.frequency || "monthly",
        durationMin: s.duration || 0,
        callsPerMonth: getMonthlyRate(s.frequency || "monthly"),
        kmFromStart: p && startPoint ? Math.round(km(startPoint, p)) : null,
        scheduled: scheduled.get(s.id) ?? 0,
        missed: missed.get(s.id)?.count ?? 0,
        missedReason: missed.get(s.id)?.reason ?? "",
        hoursPerMonth: round1((rate * (s.duration || 0)) / 60),
        notOnRoute,
        notOnRouteReason: notOnRoute > 0 ? plainReason(missed.get(s.id)?.reason ?? "", !!p) : "",
      };
    })
    .sort((a, b) => (b.kmFromStart ?? -1) - (a.kmFromStart ?? -1));

  const distances = stores.map((s) => s.kmFromStart).filter((d): d is number => d !== null);
  const medianKm = median(distances);

  const gapByReason = new Map<string, RouteGap>();
  for (const st of stores) {
    if (st.notOnRoute === 0) continue;
    const g = gapByReason.get(st.notOnRouteReason) ?? { reason: st.notOnRouteReason, visits: 0, hours: 0, stores: [] };
    g.visits += st.notOnRoute;
    g.hours += (st.notOnRoute * st.durationMin) / 60;
    g.stores.push(st.storeName);
    gapByReason.set(st.notOnRouteReason, g);
  }
  const byReason = [...gapByReason.values()]
    .map((g) => ({ ...g, hours: round1(g.hours) }))
    .sort((a, b) => b.hours - a.hours);
  const gapHours = round1(byReason.reduce((t, g) => t + g.hours, 0));
  const gapVisits = byReason.reduce((t, g) => t + g.visits, 0);

  const days: ExplainDay[] = (plan?.days ?? []).map((d) => ({
    week: d.week,
    day: d.day,
    stops: d.stops.length,
    visitMin: Math.round(d.totalVisitTime),
    driveMin: Math.round(d.totalTravelTime),
    driveKm: Math.round(d.totalDistance),
    overCapacity: d.overCapacity,
  }));

  // Which start the plan used. The engine falls back to the middle of the
  // stores when the rep has no home, so a start sitting on that centroid is the
  // fallback; one matching neither is a home the record no longer holds.
  const pts = allocated
    .map((s) => parseLatLng(s.gpsLat, s.gpsLng))
    .filter((p): p is { lat: number; lng: number } => p !== null);
  const centroid = pts.length
    ? { lat: pts.reduce((t, p) => t + p.lat, 0) / pts.length, lng: pts.reduce((t, p) => t + p.lng, 0) / pts.length }
    : null;
  const source: CapacityExplanation["start"]["source"] = !planStart
    ? "none"
    : planStartedAtHome
      ? "home"
      : centroid && km(planStart, centroid) <= SAME_POINT_KM
        ? "store_centroid"
        : "older_home";
  const maxStops = days.reduce((m, d) => Math.max(m, d.stops), 0);

  const causes: Cause[] = [];
  const regenerate = "Go to Routes and regenerate this rep's route. The saved plan does not change until you do.";
  const editHome = `Go to Reps, filter for "${rep.name}", click Edit, correct the Home Address and click Save, then click "Set from address" in the Starts Day At column.`;

  // 1. The start point is nowhere near the stores. Every day pays the drive
  //    there and back, so this alone can multiply a healthy week many times.
  //    Not raised when the record's home has since been corrected to somewhere
  //    near the stores: then the only thing left to do is regenerate.
  const currentHomeMedian = currentHome
    ? median(pts.map((p) => km(currentHome, p)))
    : null;
  const alreadyCorrected =
    source === "older_home" && currentHomeMedian !== null && currentHomeMedian <= FAR_HOME_KM;
  if (startPoint && medianKm !== null && medianKm > FAR_HOME_KM && !alreadyCorrected) {
    const fromHome = !!currentHome && km(startPoint, currentHome) <= SAME_POINT_KM;
    causes.push({
      kind: "far_home",
      title: fromHome
        ? `Home is about ${Math.round(medianKm).toLocaleString()} km from the stores`
        : `The day starts about ${Math.round(medianKm).toLocaleString()} km from the stores`,
      detail: fromHome
        ? `Every day starts and ends at home${rep.homeAddress ? ` (${rep.homeAddress})` : ""}, so each day pays that drive both ways and fits at most ${maxStops} call${maxStops === 1 ? "" : "s"}. Either the home address is wrong, or these stores belong to a rep in another area.`
        : "This plan started each day from a point far from the stores. Either the address the plan used is wrong, or these stores belong to a rep in another area.",
      fix: [editHome, "Or, if the address is right, move the stores to the rep who covers that area.", regenerate],
    });
  }

  // 2. The rep record's home has moved since the plan was built, so the number
  //    on screen describes a start point the next plan will not use.
  if (planStart && currentHome && km(planStart, currentHome) > SAME_POINT_KM) {
    causes.push({
      kind: "stale_home",
      title: "The home address changed after this plan was made",
      detail: `The plan starts each day ${Math.round(km(planStart, currentHome)).toLocaleString()} km from the home now on the rep's record. These figures will change once the route is regenerated.`,
      fix: [regenerate],
    });
  }

  // 3. No home: the engine starts from the middle of the stores. Not wrong, but
  //    worth saying, because the real day starts somewhere else.
  if (!currentHome && plan) {
    causes.push({
      kind: "no_home",
      title: "No home GPS, so the day starts in the middle of the stores",
      detail: "Without a home location the plan assumes the rep starts at the centre of their stores. The real drive is longer, so real days are fuller than this.",
      fix: [editHome, regenerate],
    });
  }

  // 4. The stores alone ask for more time than the rep has, before any driving.
  if (bookExceedsHours) {
    causes.push({
      kind: "book_too_big",
      title: `Store visits alone need ${Math.round(bookVisitHours)}h against ${Math.round(row.availableHours)}h available`,
      detail: `Before any driving, the stores' visit frequencies and lengths add up to ${bookOverBy}x the rep's working hours: ${round1(bookVisitHours / workingDays)}h of visits for every working day, against a ${row.workingHoursPerDay}h day. No route can fit that.`,
      fix: [
        "Lower the visit frequency or visit length on the Channels page (or per store), or move some stores to another rep.",
        regenerate,
      ],
    });
  }

  // 5. Driving outweighs the visits, without the home being the cause: the
  //    stores themselves are spread out.
  if (
    plan &&
    !causes.some((c) => c.kind === "far_home") &&
    row.travelHours > row.visitHours &&
    row.utilization > 0.85
  ) {
    causes.push({
      kind: "driving_heavy",
      title: `Driving takes ${Math.round(row.travelHours)}h, more than the ${Math.round(row.visitHours)}h in stores`,
      detail: "The stores are spread far apart, so most of the day is spent on the road. Check the farthest stores in the list below: one with a wrong GPS pulls a whole day off course.",
      fix: [
        "Check the farthest stores' GPS on the Stores page, or move far-off stores to a nearer rep.",
        regenerate,
      ],
    });
  }

  // 6. A calls-per-day target pushed days past the rep's hours. Only when the
  //    plan was actually built to a target: a one-call day that overruns
  //    because the drive alone is longer than the day is cause 1, not this.
  const overrunDays = (plan?.days ?? []).filter((d) => (d.overrunMinutes ?? 0) > 0);
  if (overrunDays.length > 0 && plan?.callsPerDay && !causes.some((c) => c.kind === "far_home")) {
    const total = overrunDays.reduce((s, d) => s + (d.overrunMinutes ?? 0), 0);
    causes.push({
      kind: "overrun",
      title: `${overrunDays.length} day${overrunDays.length === 1 ? "" : "s"} run past the working hours to meet the calls-per-day target`,
      detail: `The plan was built to ${plan.callsPerDay} calls a day. Meeting it adds ${round1(total / 60)}h beyond the rep's hours across the cycle.`,
      fix: ["Lower the calls-per-day target on the Routes page, or give the rep fewer stores.", regenerate],
    });
  }

  // 7. Visits the stores ask for that are not on the route. The grid's
  //    percentage only counts the route, so this is the gap between the red
  //    "stores need Nx their hours" warning and a grid row that looks fine.
  if (plan && gapHours > 0) {
    const pct = Math.round(row.utilization * 100);
    const masksBook = bookExceedsHours && row.utilization <= 1;
    const fix: string[] = [];
    for (const g of byReason) {
      if (g.reason === NO_GPS_REASON) {
        fix.push(`Give these stores a GPS on the Stores page: ${g.stores.join(", ")}.`);
      } else if (g.reason === "Did not fit in the working days") {
        fix.push("The days are full: fix the causes above (fewer or shorter visits, or fewer stores), and these fit.");
      } else {
        fix.push(`Check why on the Routes page (unassigned list): ${g.stores.join(", ")}.`);
      }
    }
    fix.push(regenerate);
    const cause: Cause = {
      kind: "not_on_route",
      title: masksBook
        ? `The grid shows ${pct}% only because ${gapHours}h of visits are not on the route`
        : `${gapHours}h of visits a month (${gapVisits} visit${gapVisits === 1 ? "" : "s"}) are not on the route`,
      detail: `The stores ask for ${round1(bookVisitHours)}h of visits a month. The route holds ${row.visitHours}h. The grid percentage counts only what is on the route, so the missing ${gapHours}h does not show in it.${masksBook ? " Put them on the route and this rep is over capacity." : ""}`,
      fix,
    };
    // When the gap is what makes a too-big book look healthy, it IS the answer
    // to "why does the grid disagree", so it goes first.
    if (masksBook) causes.unshift(cause);
    else causes.push(cause);
  }

  // 8. The same store twice under two codes: its visits are counted twice.
  const byBase = new Map<string, ExplainStore[]>();
  for (const st of stores) {
    const k = baseName(st.storeName);
    if (!k) continue;
    byBase.set(k, [...(byBase.get(k) ?? []), st]);
  }
  for (const group of byBase.values()) {
    if (group.length < 2) continue;
    const hours = round1(group.slice(1).reduce((t, g) => t + g.hoursPerMonth, 0));
    const times = group.length === 2 ? "twice" : `${group.length} times`;
    const dupe: Cause = {
      kind: "possible_duplicate",
      title: `Possibly the same store ${times}: ${group.map((g) => g.storeName).join(" and ")}`,
      detail: `Same name, different codes. If it is one store, its visits are counted ${times} and ${hours}h a month of the book is not real.`,
      fix: [
        "Go to Stores and search for the name. If it is one store, delete or close the extra record. If they really are separate stores, nothing to do.",
        regenerate,
      ],
    };
    // Check this BEFORE fixing a missing GPS on one of these records: if it is
    // a duplicate, the fix is to delete it, not to put it on the route.
    const gapFirst = causes[0]?.kind === "not_on_route";
    if (gapFirst && group.some((g) => g.notOnRoute > 0)) causes.splice(1, 0, dupe);
    else causes.push(dupe);
  }

  return {
    repCode: rep.code,
    repName: rep.name,
    hasRoute: !!plan,
    generatedAt: plan?.generatedAt ?? generatedAt,
    maths: {
      visitHours: row.visitHours,
      travelHours: row.travelHours,
      scheduledHours: row.scheduledHours,
      availableHours: row.availableHours,
      workingHoursPerDay: row.workingHoursPerDay,
      workingDays,
      utilization: row.utilization,
      bookVisitHours: round1(bookVisitHours),
    },
    route: {
      bookVisitHours: round1(bookVisitHours),
      routedVisitHours: row.visitHours,
      gapHours,
      gapVisits,
      byReason,
    },
    start: {
      source,
      planStart,
      currentHome,
      homeAddress: rep.homeAddress || "",
      medianKmToStores: medianKm === null ? null : Math.round(medianKm),
    },
    causes,
    stores,
    days,
  };
}
