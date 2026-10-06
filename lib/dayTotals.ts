/**
 * What a planned day actually costs, measured from the stops it ended up with.
 *
 * 🔴 Why this is not just `day.totalDistance`: the figures stored on a plan are
 * true at the moment the day is built, and the calls-per-day trim then pops
 * stops off the END without re-measuring the drive home. On the plan generated
 * 20 Sep that leaves 241 of 705 days charging a drive home from a shop the rep
 * no longer visits. The engine now keeps those fields honest, but a plan saved before
 * that still carries the old numbers, and a page reading them would keep
 * showing them until someone regenerates. On the worst single day the stored
 * figure is 108 km out.
 *
 * So the pages take the recorded leg when there is one and MEASURE when there
 * is not, which is right on both a current plan and an old one. Every reader of
 * a day's cost uses this one function, so the grid cell, the day panel and the
 * map can never quote three different answers for the same day.
 */

import { haversineKm, driveMinutes } from "./latlng";
import { parseClock, formatClock } from "./clock";
import type { RouteDayPlan } from "./types";

export interface DayTotals {
  stops: number;
  distanceKm: number;
  travelMinutes: number;
  visitMinutes: number;
  totalMinutes: number;
  /** Null when the plan has no start point, so nothing pretends the leg is 0 km. */
  returnKm: number | null;
  returnMinutes: number | null;
  arriveHome: string | null;
  leaveHome: string | null;
  overBy: number | null;
}

export function dayTotals(
  day: RouteDayPlan,
  home: { lat: number; lng: number } | null | undefined,
  workingHoursPerDay?: number
): DayTotals {
  const first = day.stops[0];
  const last = day.stops[day.stops.length - 1];

  const stopsKm = day.stops.reduce((s, st) => s + st.distanceFromPrev, 0);
  const stopsMin = day.stops.reduce((s, st) => s + st.travelTimeFromPrev, 0);
  const visitMinutes = day.stops.reduce((s, st) => s + st.visitDuration, 0);

  // 🔴 Prefer the leg the plan recorded, and measure only when there isn't one.
  //
  // A plan from the current engine stores a leg home that is already correct
  // for the stop the day ends on, and on the 133 days Google routed it is a
  // REAL ROAD distance. Re-measuring those as a straight line threw away 931 km
  // across the book — about 7 km a day — and quietly understated exactly the
  // leg this whole change exists to charge for. On the 572 days with no Google
  // geometry the two agree to 0.00 km, which is what proves the fallback right.
  //
  // The fallback still matters: a plan saved before the field existed has none,
  // and measuring is the only way those pages tell the truth before the next
  // regeneration.
  const stored = day.returnDistanceKm;
  const returnKm =
    stored !== undefined
      ? stored
      : home && last
        ? haversineKm(last.lat, last.lng, home.lat, home.lng)
        : null;
  const returnMinutes =
    returnKm === null ? null : (day.returnTravelTime ?? driveMinutes(returnKm));

  const travelMinutes = stopsMin + (returnMinutes ?? 0);
  const totalMinutes = travelMinutes + visitMinutes;
  const workingMinutes = workingHoursPerDay ? workingHoursPerDay * 60 : null;
  const over = workingMinutes === null ? null : totalMinutes - workingMinutes;

  return {
    stops: day.stops.length,
    distanceKm: stopsKm + (returnKm ?? 0),
    travelMinutes,
    visitMinutes,
    totalMinutes,
    returnKm: returnKm === null ? null : Math.round(returnKm * 10) / 10,
    returnMinutes: returnMinutes === null ? null : Math.round(returnMinutes),
    // The day starts when the rep leaves home, which is the first arrival less
    // the drive out — the plan records no departure-from-home of its own.
    leaveHome: first ? formatClock(parseClock(first.arrivalTime) - first.travelTimeFromPrev) : null,
    arriveHome:
      last && returnMinutes !== null
        ? formatClock(parseClock(last.departureTime) + returnMinutes)
        : null,
    overBy: over !== null && over > 0 ? Math.round(over) : null,
  };
}
