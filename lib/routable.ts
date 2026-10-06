import type { Channel, Store, StoreOverride } from "./types";
import { isClosed } from "./closedStores";

/**
 * Which stores anybody may actually be sent to.
 *
 * A store is visited when it is:
 *
 *   1. not closed                       (lib/closedStores.ts)
 *   2. in a channel reps call on        (here)
 *   3. or, failing 2, individually excused by an APPROVED Call Override
 *
 * They compose here rather than at each call site, because route generation,
 * the capacity page, Data Health and the not-in-cycle list all ask the same
 * question, and a page that disagrees with the routes it describes is worse
 * than no page.
 *
 * This is the channel-wide rule. iRam also has a per-ROLE switch on a channel
 * (roleDefaults[role].enabled, read in lib/repStores.ts) for "QC never visits
 * this channel". That one narrows a single role; this one takes the store out
 * for every role. A store that fails here never reaches the per-role check.
 *
 * Ported from Clippa without sub-channels: iRam has none.
 */

/** Does anybody call on this channel at all? */
export function isRepChannel(channel: Channel | undefined): boolean {
  // Absent means yes. A channel predating the flag, or a store whose channel has
  // been deleted, must keep being visited rather than silently vanish.
  return channel?.notARepChannel !== true;
}

/**
 * Store ids a manager has individually put back into the cycle.
 *
 * APPROVED only. An override starts life pending, and a pending one is a
 * request, not a decision: letting it re-include a store would mean anyone who
 * can raise an override could undo a channel-level exclusion for themselves.
 */
export function approvedOverrideStoreIds(overrides: StoreOverride[]): Set<string> {
  return new Set(overrides.filter((o) => o.approvalStatus === "approved").map((o) => o.storeId));
}

export interface RoutableInput {
  stores: Store[];
  channels: Channel[];
  overrides: StoreOverride[];
}

/** Why a store is not being visited, or null when it is. */
export type ExclusionReason = "closed" | "channel_not_called_on";

export function exclusionReason(
  store: Store,
  channelsById: Map<string, Channel>,
  excused: Set<string>
): ExclusionReason | null {
  // Closure wins. A shut shop in a rep channel is still shut, and reporting it
  // as a channel problem would send somebody to fix the wrong thing.
  if (isClosed(store)) return "closed";
  if (isRepChannel(channelsById.get(store.channelId))) return null;
  // Nobody calls on the channel, but this one store was excused by a manager.
  if (excused.has(store.id)) return null;
  return "channel_not_called_on";
}

/** The stores a call cycle may contain, for any visit role. */
export function routableStores({ stores, channels, overrides }: RoutableInput): Store[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);
  return stores.filter((s) => exclusionReason(s, byId, excused) === null);
}

export interface ExclusionCounts {
  routable: number;
  closed: number;
  channelNotCalledOn: number;
  /** Stores kept in the cycle by an approved override despite their channel. */
  excusedByOverride: number;
}

/**
 * The same split, counted.
 *
 * Reported rather than silently subtracted: "2 250 stores" and "2 250 stores,
 * of which 300 are in channels nobody calls on" are different facts, and only
 * the second explains why a rep's week looks empty.
 */
export function countExclusions({ stores, channels, overrides }: RoutableInput): ExclusionCounts {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);
  let routable = 0;
  let closed = 0;
  let channelNotCalledOn = 0;
  let excusedByOverride = 0;
  for (const s of stores) {
    const reason = exclusionReason(s, byId, excused);
    if (reason === "closed") closed++;
    else if (reason === "channel_not_called_on") channelNotCalledOn++;
    else {
      routable++;
      if (!isRepChannel(byId.get(s.channelId))) excusedByOverride++;
    }
  }
  return { routable, closed, channelNotCalledOn, excusedByOverride };
}

/**
 * How many stores each channel holds, and how many of those a switch would drop.
 *
 * Feeds the Channels page, so switching "Called on?" off can say what it is
 * about to remove from the cycle BEFORE it is switched. A count that only
 * appears afterwards is how somebody takes a thousand stores out by accident.
 */
export function storeCountsByChannel(
  stores: Store[],
  overrides: StoreOverride[]
): Map<string, { total: number; open: number; excused: number }> {
  const excused = approvedOverrideStoreIds(overrides);
  const out = new Map<string, { total: number; open: number; excused: number }>();
  for (const s of stores) {
    const e = out.get(s.channelId) ?? { total: 0, open: 0, excused: 0 };
    e.total++;
    if (!isClosed(s)) e.open++;
    if (!isClosed(s) && excused.has(s.id)) e.excused++;
    out.set(s.channelId, e);
  }
  return out;
}

/**
 * What switching a channel's "Called on?" OFF would do, from its counts.
 *
 * `open` includes the stores an approved Call Override keeps in the cycle, so
 * quoting `open` as "will leave" overstates it. Split here so the confirm, the
 * import result and the log all say the same two numbers.
 */
export function switchOffImpact(c: { open: number; excused: number } | undefined): {
  leaving: number;
  kept: number;
} {
  const open = c?.open ?? 0;
  const kept = Math.min(c?.excused ?? 0, open);
  return { leaving: open - kept, kept };
}

/** "N open stores will leave every call cycle, M kept in by a Call Override". */
export function switchOffSentence(impact: { leaving: number; kept: number }): string {
  const s = (n: number) => (n === 1 ? "" : "s");
  const base = `${impact.leaving} open store${s(impact.leaving)} will leave every call cycle`;
  return impact.kept > 0 ? `${base}, ${impact.kept} kept in by a Call Override` : base;
}

/**
 * The channels in `ids` that still have stores filed under them, with the count.
 *
 * A channel must not be deleted while it holds stores. Its stores would point at
 * a channel that no longer exists, and `isRepChannel(undefined)` is true on
 * purpose, so a switched-off channel's stores would quietly rejoin every cycle.
 * Closed stores count too: reopening one would bring the same problem back.
 */
export function channelsStillHoldingStores(
  ids: Iterable<string>,
  stores: Pick<Store, "channelId">[]
): { id: string; stores: number }[] {
  const wanted = new Set(ids);
  const counts = new Map<string, number>();
  for (const s of stores) {
    if (wanted.has(s.channelId)) counts.set(s.channelId, (counts.get(s.channelId) ?? 0) + 1);
  }
  return [...wanted].filter((id) => counts.has(id)).map((id) => ({ id, stores: counts.get(id)! }));
}

export interface CalledOnChange {
  id: string;
  name: string;
  /** The new value: true = switched back on, false = switched off. */
  calledOn: boolean;
  /** Open stores leaving (switched off) or returning (switched on), override-kept ones excluded. */
  openStores: number;
  /** Open stores an approved Call Override keeps in the cycle either way. */
  keptByOverride: number;
}

/**
 * Describe channels whose "Called on?" a bulk write flipped, with what that does
 * to their stores. An import that silently switches a channel off takes
 * hundreds of stores out of every cycle without anybody having seen a number.
 */
export function describeCalledOnChanges(
  changed: Channel[],
  stores: Store[],
  overrides: StoreOverride[]
): CalledOnChange[] {
  const counts = storeCountsByChannel(stores, overrides);
  return changed.map((ch) => {
    // Counted for both directions the same way: the stores an override does
    // NOT already keep in are the ones that leave (off) or return (on).
    const { leaving, kept } = switchOffImpact(counts.get(ch.id));
    return { id: ch.id, name: ch.name, calledOn: isRepChannel(ch), openStores: leaving, keptByOverride: kept };
  });
}

/** One line per flipped channel, for the import result and the activity log. */
export function describeCalledOnChange(c: CalledOnChange): string {
  const s = (n: number) => (n === 1 ? "" : "s");
  const kept = c.keptByOverride > 0 ? ` (${c.keptByOverride} kept in by a Call Override either way)` : "";
  return c.calledOn
    ? `${c.name}: Called on? switched ON. ${c.openStores} open store${s(c.openStores)} return to the call cycles at the next route generation${kept}.`
    : `${c.name}: Called on? switched OFF. ${c.openStores} open store${s(c.openStores)} leave every call cycle at the next route generation${kept}.`;
}
