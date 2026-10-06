/**
 * Why a store is not in its rep's call cycle.
 *
 * "It is not on the route" is not one fact, it is several, and they call for
 * completely different actions: allocate a rep, fix a coordinate, confirm an
 * outlier, lighten a rep's load, reopen a shop, or just regenerate. A list that
 * greys out the missing stores without saying which one applies moves the
 * question rather than answering it.
 *
 * Two families sit behind it, and keeping them apart is the point:
 *
 *   NOT ELIGIBLE  closed, or a channel nobody calls on. Correctly absent.
 *                 Answered by lib/routable.ts, the same rule route generation
 *                 uses, so this list can never disagree with the routes.
 *   DROPPED       eligible, and the router still could not place it: over the
 *                 working day, no usable GPS, or too far out to include without
 *                 a manager saying so.
 *
 * And the ones that are neither: a store no rep owns, a store outside its rep's
 * channels under Channel Dedicated, and a store loaded after the routes were
 * generated, where the answer is simply "regenerate".
 *
 * Ported from Clippa and adapted for iRam:
 *  - Only the PRIMARY (sales) role's plans count. QC and Training plans visit
 *    the same stores on their own rhythm, and a store a QC rep calls on every
 *    quarter is not "in the cycle" if no sales rep ever goes there.
 *  - Store data comes from Perigee through Store Upload, so the fixes point
 *    there. A coordinate corrected only in this app is overwritten by the next
 *    Store Upload if Perigee still has the old one.
 */

import type { CallCycleStrategy, Channel, Rep, RoutePlanDocument, Store, StoreOverride, Team, VisitRole } from "./types";
import { PRIMARY_VISIT_ROLE_ID } from "./types";
import { exclusionReason, approvedOverrideStoreIds } from "./routable";
import { checkCoordinate } from "./saCoordinates";
import { isClosed } from "./closedStores";
import { matchesTeam, isActive as isTeamFilterActive, type TeamSelection } from "./teamFilter";

export type NotInCycleReason =
  | "no_rep"
  | "over_target"
  | "over_capacity"
  | "bad_gps"
  | "out_of_range"
  | "outside_assigned_channels"
  | "not_in_plan"
  | "channel_not_called_on"
  | "closed";

export interface ReasonPresentation {
  /** What is true, in the words a manager would use. */
  label: string;
  /** What to do about it, or null when the answer is "nothing, this is right". */
  action: string | null;
  /** Where the fix has to happen so it sticks, for the export. */
  fixIn: string;
  /** Hex, for the dot and the legend swatch. */
  colour: string;
  /** False when the store cannot be drawn on a map at all. */
  plottable: boolean;
  /** Ordering: what a manager can act on comes first. */
  rank: number;
}

export const REASONS: Record<NotInCycleReason, ReasonPresentation> = {
  no_rep: {
    label: "No rep allocated",
    action: "Allocate it to a rep, then regenerate routes.",
    fixIn: "Perigee: allocate the store to a rep, then load it again through Store Upload. A rep set only on the Stores page is replaced by the next Store Upload.",
    colour: "#B91C1C",
    plottable: true,
    rank: 1,
  },
  over_target: {
    label: "Over the calls-per-day target",
    action: "Raise the target, or move the store to another rep.",
    fixIn: "This app: planning, not data. Lower call frequencies on the Channels page or move stores to another rep.",
    colour: "#DC2626",
    plottable: true,
    rank: 2,
  },
  over_capacity: {
    label: "Over the working day",
    action: "The rep's days ran out of hours before this store was reached.",
    fixIn: "This app: planning, not data. Lower call frequencies or durations on the Channels page, or move stores to another rep.",
    colour: "#EA580C",
    plottable: true,
    rank: 3,
  },
  out_of_range: {
    label: "Too far outside the rep's area",
    action: "Confirm it on the Routes page to force it into the cycle.",
    fixIn: "If the rep really covers it, confirm it on the Routes page. If it belongs to someone else, move it to the right rep in Perigee and load it through Store Upload.",
    colour: "#D97706",
    plottable: true,
    rank: 4,
  },
  bad_gps: {
    label: "No usable coordinates",
    action: "Set the coordinates (type them or drop a pin), then regenerate routes.",
    fixIn: "Perigee as well as here: Store Upload copies Perigee's coordinates over this app's, so a pin fixed only here comes back wrong on the next upload.",
    colour: "#7C3AED",
    plottable: false,
    rank: 5,
  },
  outside_assigned_channels: {
    label: "Outside the rep's assigned channels",
    action: "Add the channel to the rep on the Channel Map page, or move the store to a rep who covers it.",
    fixIn: "This app: Channel Map page (Channel Dedicated call cycle only).",
    colour: "#0891B2",
    plottable: true,
    rank: 6,
  },
  not_in_plan: {
    label: "Loaded after these routes were generated",
    action: "Regenerate routes to bring it into the cycle.",
    fixIn: "This app: regenerate routes on the Routes page.",
    colour: "#2563EB",
    plottable: true,
    rank: 7,
  },
  channel_not_called_on: {
    label: "In a channel nobody calls on",
    action: null,
    fixIn: "Nothing to fix. Switch the channel's Called on? back on (Channels page) if reps should visit it.",
    colour: "#6B7280",
    plottable: true,
    rank: 8,
  },
  closed: {
    label: "Closed",
    action: null,
    fixIn: "Nothing to fix. Set the store back to Active on the Stores page if it has reopened.",
    colour: "#9CA3AF",
    plottable: true,
    rank: 9,
  },
};

/** The two reasons that mean the store is right to be absent. */
export function isCorrectlyOut(reason: NotInCycleReason): boolean {
  return reason === "closed" || reason === "channel_not_called_on";
}

/** Was this plan built for the primary (sales) role? Plans that predate roles were. */
export function isPrimaryPlan(plan: { visitRoleId?: string }, roles: VisitRole[] = []): boolean {
  if (!plan.visitRoleId) return true;
  const role = roles.find((r) => r.id === plan.visitRoleId);
  return role ? role.isPrimary : plan.visitRoleId === PRIMARY_VISIT_ROLE_ID;
}

export interface NotInCycleInput {
  stores: Store[];
  channels: Channel[];
  overrides: StoreOverride[];
  routes: RoutePlanDocument | null;
  /** Every rep, so a rep code that names nobody is reported as "no rep". */
  reps: Rep[];
  visitRoles?: VisitRole[];
  /** The strategy the routes were generated under, for Channel Dedicated. */
  strategy?: CallCycleStrategy | null;
  /** Restrict to one rep, or leave out for every rep in scope. */
  repCode?: string;
  /** Rep codes the signed-in user may see. */
  visibleRepCodes?: Set<string>;
}

export interface NotInCycleStore {
  store: Store;
  reason: NotInCycleReason;
}

export interface NotInCycleResult {
  /** Every store that no day of its rep's cycle visits. */
  missing: NotInCycleStore[];
  reasonOf: Map<string, NotInCycleReason>;
  counts: Record<NotInCycleReason, number>;
  /** Stores in scope after user scoping. The denominator. */
  totalStores: number;
  /** Stores the cycle DOES visit at least once. */
  scheduled: number;
  /** Stores that cannot be drawn on a map (no usable coordinate). */
  notPlottable: number;
}

/**
 * `stats.unassignedStores` holds one entry per DROPPED VISIT, not per store,
 * and carries no week. A weekly store dropped from three weeks appears three
 * times, and a store dropped from Wk3 while kept in Wk1 appears there too while
 * still being genuinely in the cycle.
 *
 * So it can only be consulted for stores the cycle visits NOWHERE. For those,
 * the first reason recorded is the reason: they were all the same decision.
 */
export function reasonFromUnassigned(text: string): NotInCycleReason {
  const t = text.toLowerCase();
  if (t.includes("calls per day") || t.includes("calls-per-day")) return "over_target";
  if (t.includes("daily capacity") || t.includes("capacity")) return "over_capacity";
  if (t.includes("out of range")) return "out_of_range";
  if (t.includes("gps") || t.includes("coordinates")) return "bad_gps";
  // A reason this file has never seen. Treating it as a stale plan would be
  // wrong, so it is reported as a capacity drop: the honest default, and the
  // one a manager can act on.
  return "over_capacity";
}

export function findNotInCycle({
  stores,
  channels,
  overrides,
  routes,
  reps,
  visitRoles = [],
  strategy = null,
  repCode,
  visibleRepCodes,
}: NotInCycleInput): NotInCycleResult {
  const channelsById = new Map(channels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);
  const repByCode = new Map(reps.map((r) => [r.code, r]));

  const mine = stores.filter((s) => {
    if (repCode && s.repCode !== repCode) return false;
    if (visibleRepCodes && !visibleRepCodes.has(s.repCode)) return false;
    return true;
  });

  // Every store a SALES plan visits at least once, across all four weeks and
  // all five days. Deliberately ignores any week or day on screen: the question
  // is "never visited", and a store visited only in Wk3 is in the cycle.
  const visited = new Set<string>();
  const droppedReason = new Map<string, string>();
  for (const plan of routes?.repPlans ?? []) {
    if (!isPrimaryPlan(plan, visitRoles)) continue;
    if (repCode && plan.repCode !== repCode) continue;
    if (visibleRepCodes && !visibleRepCodes.has(plan.repCode)) continue;
    for (const dp of plan.days) for (const stop of dp.stops) visited.add(stop.storeId);
    for (const u of plan.stats?.unassignedStores ?? []) {
      if (!droppedReason.has(u.storeId)) droppedReason.set(u.storeId, u.reason);
    }
  }

  const missing: NotInCycleStore[] = [];
  const reasonOf = new Map<string, NotInCycleReason>();
  const counts = Object.fromEntries(Object.keys(REASONS).map((k) => [k, 0])) as Record<NotInCycleReason, number>;
  let scheduled = 0;
  let notPlottable = 0;

  for (const store of mine) {
    if (visited.has(store.id)) {
      scheduled++;
      continue;
    }

    // Not eligible in the first place beats anything the router did with it: a
    // shut shop reported as "over the working day" would send somebody to
    // lighten a load that was never the problem.
    const excluded = exclusionReason(store, channelsById, excused);
    const rep = repByCode.get((store.repCode || "").trim());
    const dropped = droppedReason.get(store.id);

    /**
     * A coordinate outside South Africa is BROKEN, not distant. Clippa found
     * stores geocoded by name without a country (one sat in Montana, USA); the
     * outlier check offered to "confirm" them into a rep's week. Reported as an
     * unusable coordinate instead, which is true and fixable.
     */
    const foreign = !excluded && checkCoordinate(store.gpsLat ?? "", store.gpsLng ?? "").problem !== null;

    const outsideChannels =
      !excluded &&
      !!rep &&
      strategy === "channel_dedicated" &&
      !!rep.assignedChannels?.length &&
      !rep.assignedChannels.includes(store.channelId);

    const reason: NotInCycleReason = excluded
      ? excluded
      : !rep
        ? "no_rep"
        : outsideChannels
          ? "outside_assigned_channels"
          : foreign
            ? "bad_gps"
            : dropped
              ? reasonFromUnassigned(dropped)
              : "not_in_plan";

    missing.push({ store, reason });
    reasonOf.set(store.id, reason);
    counts[reason]++;
    if (reason === "bad_gps" || checkCoordinate(store.gpsLat ?? "", store.gpsLng ?? "").problem !== null) {
      notPlottable++;
    }
  }

  missing.sort(
    (a, b) => REASONS[a.reason].rank - REASONS[b.reason].rank || a.store.name.localeCompare(b.store.name)
  );

  return { missing, reasonOf, counts, totalStores: mine.length, scheduled, notPlottable };
}

export type StatusFilter = "open" | "closed" | "all";

export interface NotInCycleFilter {
  repCode?: string;
  teams?: Team[];
  teamSel?: TeamSelection;
  channelId?: string;
  status?: StatusFilter;
  reason?: NotInCycleReason | "";
  /** Leave out the two reasons that mean "correctly absent". */
  actionableOnly?: boolean;
  search?: string;
}

/**
 * Narrow the list for a grid.
 *
 * Every filter narrows the ROWS against one denominator. Clippa first ran the
 * rep filter through findNotInCycle, which made it change the total ("77 of
 * 82") while team and channel changed only the count ("451 of 3 943"): two
 * filters on one toolbar meaning different things. Role scoping belongs in
 * findNotInCycle (visibleRepCodes); everything a user can pick belongs here.
 */
export function filterNotInCycle(
  result: NotInCycleResult,
  reps: Rep[],
  f: NotInCycleFilter
): NotInCycleStore[] {
  const repByCode = new Map(reps.map((r) => [r.code, r]));
  const q = (f.search ?? "").trim().toLowerCase();
  const teamActive = !!f.teamSel && isTeamFilterActive(f.teamSel);
  return result.missing.filter(({ store, reason }) => {
    if (f.repCode && store.repCode !== f.repCode) return false;
    if (teamActive) {
      // A store whose rep code matches no rep has no team; it only survives a
      // team filter under "No team", which matchesTeam decides.
      if (!matchesTeam(f.teams ?? [], f.teamSel!, repByCode.get(store.repCode)?.teamId)) return false;
    }
    if (f.channelId && store.channelId !== f.channelId) return false;
    if (f.status === "open" && isClosed(store)) return false;
    if (f.status === "closed" && !isClosed(store)) return false;
    if (f.reason && reason !== f.reason) return false;
    if (f.actionableOnly && isCorrectlyOut(reason)) return false;
    if (q && !`${store.name} ${store.placeId} ${store.repCode}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
