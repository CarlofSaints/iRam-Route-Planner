import { Rep, Store, RoutePlanDocument, getMonthlyRate } from "./types";

// A generated route document covers one 4-week cycle = one month.
export const WORKING_DAYS_PER_MONTH = 20; // 5 days x 4 weeks
const DEFAULT_WORKING_HOURS = 8.5;

export interface RepCapacity {
  repCode: string;
  repName: string;
  teamId: string;
  workingHoursPerDay: number;
  storeCount: number;
  callsPerMonth: number; // total store visits per month (frequency-weighted)
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
  doc: RoutePlanDocument | null
): CapacityResult {
  const planByRep = new Map((doc?.repPlans ?? []).map((p) => [p.repCode, p]));

  const rows: RepCapacity[] = reps.map((rep) => {
    const allocated = stores.filter((s) => s.repCode === rep.code);
    const callsPerMonth = allocated.reduce(
      (sum, s) => sum + getMonthlyRate(s.frequency || "monthly"),
      0
    );

    const workingHoursPerDay = rep.workingHoursPerDay ?? DEFAULT_WORKING_HOURS;
    const availableHours = workingHoursPerDay * WORKING_DAYS_PER_MONTH;

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
      teamId: rep.teamId,
      workingHoursPerDay,
      storeCount: allocated.length,
      callsPerMonth: Math.round(callsPerMonth),
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
