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
 * So the pages measure. Every reader of a day's cost uses this one function, so
 * the grid cell, the day panel and the map can never quote three different
 * answers for the same day.
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

  const returnKm = home && last ? haversineKm(last.lat, last.lng, home.lat, home.lng) : null;
  const returnMinutes = returnKm === null ? null : driveMinutes(returnKm);

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
