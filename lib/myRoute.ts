/**
 * What the My Route page is allowed to see: ONE rep's own plan and the names
 * of the stores they call on, shaped for a phone.
 *
 * Pure, so a script can check it without the blob store. The API route
 * resolves the rep from the session and hands the data in; nothing here ever
 * takes a rep code from a request.
 *
 * iRam difference from Clippa: a store can carry several reps, one per visit
 * role (Store.roleReps). A QC or training person is not the store's repCode,
 * so "the rep's stores" has to mean every store where they hold ANY role, or a
 * QC rep would be told they have no stores at all.
 */

import { haversineKm } from "./route-engine";
import { parseClock, formatClock } from "./clock";
import type {
  RepRoutePlan,
  RouteDayPlan,
  RoutePlanDocument,
  Store,
  VisitRole,
} from "./types";

/** Matches the engine's Haversine fallback speed. */
const FALLBACK_SPEED_KMH = 40;

const norm = (v: string | undefined | null) => (v || "").trim().toLowerCase();

/**
 * A day as a plan may carry it. The return-leg fields are read only if the
 * engine stored them; a plan without them is measured instead, so this works
 * on plans saved before and after the engine learned to charge the drive home.
 */
type DayWithReturn = RouteDayPlan & {
  returnDistanceKm?: number;
  returnTravelTime?: number;
};

export interface MyStop {
  storeId: string;
  storeName: string;
  lat: number;
  lng: number;
  visitDuration: number;
  travelTimeFromPrev: number;
  distanceFromPrev: number;
  arrivalTime: string;
  departureTime: string;
}

export interface MyDay {
  week: RouteDayPlan["week"];
  day: RouteDayPlan["day"];
  stops: MyStop[];
  polyline?: string;
  /** Calls, leave home, back home, km and minutes on the road, for the stat row. */
  calls: number;
  leaveHome: string | null;
  arriveHome: string | null;
  distanceKm: number;
  travelMinutes: number;
  returnKm: number | null;
  returnMinutes: number | null;
}

export interface MyPlan {
  visitRoleName: string;
  homeLatLng: { lat: number; lng: number } | null;
  workingHoursPerDay: number;
  days: MyDay[];
}

export interface MyStore {
  storeId: string;
  name: string;
  /** Every visit role this rep holds at the store, e.g. ["Sales Rep", "QC"]. */
  roles: string[];
  /** On at least one planned day of their route. */
  planned: boolean;
}

export function shapeDay(day: DayWithReturn, home: { lat: number; lng: number } | null): MyDay {
  const first = day.stops[0];
  const last = day.stops[day.stops.length - 1];
  const stopsKm = day.stops.reduce((s, st) => s + st.distanceFromPrev, 0);
  const stopsMin = day.stops.reduce((s, st) => s + st.travelTimeFromPrev, 0);

  // Prefer the leg the plan recorded; measure only when there is none.
  const returnKm =
    day.returnDistanceKm !== undefined
      ? day.returnDistanceKm
      : home && last
        ? haversineKm(last.lat, last.lng, home.lat, home.lng)
        : null;
  const returnMinutes =
    returnKm === null ? null : (day.returnTravelTime ?? (returnKm / FALLBACK_SPEED_KMH) * 60);

  return {
    week: day.week,
    day: day.day,
    stops: day.stops.map((s) => ({
      storeId: s.storeId,
      storeName: s.storeName,
      lat: s.lat,
      lng: s.lng,
      visitDuration: s.visitDuration,
      travelTimeFromPrev: s.travelTimeFromPrev,
      distanceFromPrev: s.distanceFromPrev,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
    })),
    polyline: day.polyline,
    calls: day.stops.length,
    // The plan records no departure from home: it is the first arrival less
    // the drive out.
    leaveHome: first ? formatClock(parseClock(first.arrivalTime) - first.travelTimeFromPrev) : null,
    arriveHome:
      last && returnMinutes !== null ? formatClock(parseClock(last.departureTime) + returnMinutes) : null,
    distanceKm: Math.round((stopsKm + (returnKm ?? 0)) * 10) / 10,
    travelMinutes: Math.round(stopsMin + (returnMinutes ?? 0)),
    returnKm: returnKm === null ? null : Math.round(returnKm * 10) / 10,
    returnMinutes: returnMinutes === null ? null : Math.round(returnMinutes),
  };
}

/** Every plan in the book that belongs to this rep code. Normally one. */
export function plansForRep(doc: RoutePlanDocument | null, repCode: string): RepRoutePlan[] {
  const code = norm(repCode);
  if (!doc || !code) return [];
  return doc.repPlans.filter((p) => norm(p.repCode) === code);
}

export function shapePlan(plan: RepRoutePlan, fallbackRoleName: string): MyPlan {
  return {
    visitRoleName: plan.visitRoleName || fallbackRoleName,
    homeLatLng: plan.homeLatLng,
    workingHoursPerDay: plan.workingHoursPerDay,
    days: plan.days.map((d) => shapeDay(d, plan.homeLatLng)),
  };
}

/**
 * The stores where this rep holds ANY visit role.
 *
 * - primary: Store.repCode
 * - other roles: Store.roleReps, keyed by visit role id
 * - a store that predates roleReps: the old repCode2/repCode3 slots, which
 *   never said which role they were for, so they are named by the rep's own
 *   role, the same reading lib/repStores.ts gives them.
 */
export function storesForRepAnyRole(
  stores: Store[],
  repCode: string,
  ownRoleName: string,
  visitRoles: VisitRole[],
  plannedStoreIds: Set<string>
): MyStore[] {
  const code = norm(repCode);
  if (!code) return [];
  const primaryName = visitRoles.find((r) => r.isPrimary)?.name ?? "Sales Rep";
  const roleName = (id: string) => visitRoles.find((r) => r.id === id)?.name ?? id;

  const out: MyStore[] = [];
  for (const s of stores) {
    const roles: string[] = [];
    if (norm(s.repCode) === code) roles.push(primaryName);
    if (s.roleReps) {
      for (const [roleId, rc] of Object.entries(s.roleReps)) {
        if (norm(rc) === code) roles.push(roleName(roleId));
      }
    } else if (norm(s.repCode2) === code || norm(s.repCode3) === code) {
      roles.push(ownRoleName);
    }
    if (roles.length === 0) continue;
    out.push({
      storeId: s.id,
      name: s.name,
      roles: [...new Set(roles)],
      planned: plannedStoreIds.has(s.id),
    });
  }
  return out.sort((a, b) => Number(a.planned) - Number(b.planned) || a.name.localeCompare(b.name));
}
