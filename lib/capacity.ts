import { Rep, Store, Channel, RoutePlanDocument, VisitRole, DEFAULT_VISIT_ROLES, getMonthlyRate } from "./types";
import { getStoresForRep, getRoleForRep } from "./repStores";

// A generated route document covers one 4-week cycle = one month.
export const WORKING_DAYS_PER_MONTH = 20; // 5 days x 4 weeks
const WEEKS_PER_CYCLE = 4;
/**
 * Above this, a book asks for more calls a day than a working day holds.
 * Not enforced anywhere: it only colours a number, so a manager sees which
 * books are arithmetically impossible before blaming the routing.
 */
export const DAILY_CALL_WARNING = 10;
const DEFAULT_WORKING_HOURS = 8.5;

export interface RepCapacity {
  repCode: string;
  repName: string;
  visitRoleId: string;
  visitRoleName: string;
  teamId: string;
  workingHoursPerDay: number;
  storeCount: number;
  callsPerMonth: number; // total store visits per month (frequency-weighted)
  /**
   * The same load per week and per working day, on the planner's own calendar
   * (4 weeks of 5 days), not a calendar month. Derived here so the grid, the
   * roll-up and the export cannot drift apart on the arithmetic.
   *
   * ⚠️ What the rep's BOOK implies, not what any route plan schedules. A rep
   * whose stores ask for 37 calls a day still shows 37 here after a plan capped
   * them at 8. That gap is the point of the column.
   */
  callsPerWeek: number;
  callsPerDay: number;
  /**
   * Hours of in-store time the book asks for in a cycle: every store's visits a
   * month times its visit length, with NO travel. Measured on visit time alone
   * on purpose: travel is an estimate and would make the finding arguable,
   * while visits that alone exceed the rep's hours are impossible on
   * arithmetic nobody can dispute. Real days are worse than this.
   */
  bookVisitHours: number;
  /** True when bookVisitHours is more than availableHours. */
  bookExceedsHours: boolean;
  /** bookVisitHours / availableHours, to one decimal ("3.9" means 3.9x). */
  bookOverBy: number;
  /**
   * Stores in the book visited weekly or more often. Named on the row because
   * the FREQUENCIES are usually what makes a book impossible, so the fix is
   * obvious from the number.
   */
  weeklyOrMoreStores: number;
  hasRoute: boolean;
  scheduledVisits: number; // visits actually placed on the schedule
  visitHours: number; // hours in-store per month
  travelHours: number; // hours driving per month
  scheduledHours: number; // visit + travel per month
  availableHours: number; // capacity per month
  utilization: number; // scheduledHours / availableHours (0..1+)
  spareHours: number; // availableHours - scheduledHours
  overCapacityDays: number;
  unassignedStores: number;
}

export interface CapacityResult {
  generatedAt: string | null;
  typeName: string | null;
  hasRoutes: boolean;
  workingDaysPerMonth: number;
  reps: RepCapacity[];
}

export function computeCapacity(
  reps: Rep[],
  stores: Store[],
  doc: RoutePlanDocument | null,
  visitRoles: VisitRole[] = DEFAULT_VISIT_ROLES,
  channels: Channel[] = []
): CapacityResult {
  const planByRep = new Map((doc?.repPlans ?? []).map((p) => [p.repCode, p]));

  const rows: RepCapacity[] = reps.map((rep) => {
    // Same helper the route generator uses, so a QC rep's utilisation is
    // measured against the QC stores and rhythm their route was built from.
    const role = getRoleForRep(rep, visitRoles);
    const allocated = getStoresForRep(rep, stores, role, null, channels);
    const callsPerMonth = allocated.reduce(
      (sum, s) => sum + getMonthlyRate(s.frequency || "monthly"),
      0
    );

    const workingHoursPerDay = rep.workingHoursPerDay ?? DEFAULT_WORKING_HOURS;
    const availableHours = workingHoursPerDay * WORKING_DAYS_PER_MONTH;

    // The book on its own, before any route is built. The copies that
    // getStoresForRep returns already carry the frequency and duration of THIS
    // rep's visit role on each store's channel, so a quarterly 60-minute QC
    // call is measured as exactly that.
    let bookMinutes = 0;
    let weeklyOrMoreStores = 0;
    for (const s of allocated) {
      const rate = getMonthlyRate(s.frequency || "monthly");
      bookMinutes += rate * (s.duration || 0);
      if (rate >= 4) weeklyOrMoreStores++;
    }
    const bookVisitHours = bookMinutes / 60;
    const bookExceedsHours = allocated.length > 0 && bookVisitHours > availableHours;

    const plan = planByRep.get(rep.code);
    let hasRoute = false;
    let scheduledVisits = 0;
    let visitHours = 0;
    let travelHours = 0;
    let overCapacityDays = 0;
    let unassignedStores = 0;

    if (plan) {
      hasRoute = true;
      for (const d of plan.days) {
        scheduledVisits += d.stops.length;
        visitHours += d.totalVisitTime / 60;
        travelHours += d.totalTravelTime / 60;
        if (d.overCapacity) overCapacityDays++;
      }
      unassignedStores = plan.stats?.unassignedStores?.length ?? 0;
    }

    const scheduledHours = visitHours + travelHours;
    const utilization = availableHours > 0 ? scheduledHours / availableHours : 0;
    const spareHours = availableHours - scheduledHours;

    return {
      repCode: rep.code,
      repName: rep.name,
      visitRoleId: role.id,
      visitRoleName: role.name,
      teamId: rep.teamId,
      workingHoursPerDay,
      storeCount: allocated.length,
      callsPerMonth: Math.round(callsPerMonth),
      callsPerWeek: Math.round((callsPerMonth / WEEKS_PER_CYCLE) * 10) / 10,
      callsPerDay: Math.round((callsPerMonth / WORKING_DAYS_PER_MONTH) * 10) / 10,
      bookVisitHours: Math.round(bookVisitHours * 10) / 10,
      bookExceedsHours,
      bookOverBy: availableHours > 0 ? Math.round((bookVisitHours / availableHours) * 10) / 10 : 0,
      weeklyOrMoreStores,
      hasRoute,
      scheduledVisits,
      visitHours: Math.round(visitHours * 10) / 10,
      travelHours: Math.round(travelHours * 10) / 10,
      scheduledHours: Math.round(scheduledHours * 10) / 10,
      availableHours: Math.round(availableHours * 10) / 10,
      utilization: Math.round(utilization * 1000) / 1000,
      spareHours: Math.round(spareHours * 10) / 10,
      overCapacityDays,
      unassignedStores,
    };
  });

  return {
    generatedAt: doc?.generatedAt ?? null,
    typeName: doc?.callCycleTypeName ?? null,
    hasRoutes: !!doc,
    workingDaysPerMonth: WORKING_DAYS_PER_MONTH,
    reps: rows,
  };
}
