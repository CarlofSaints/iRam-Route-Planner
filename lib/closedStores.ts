import type { ClosedReason, Store } from "./types";

/**
 * Which stores are shut, and therefore must not be visited.
 *
 * Ported from Clippa, where an IMS feed could close stores automatically. iRam
 * has no such feed (Perigee sends visits, not account status), so here a store
 * is only ever closed or reopened by a PERSON on the Stores page. That removes
 * the whole automatic-pass half of the Clippa file; what stays is the single
 * definition of "closed" and the one write that changes it.
 */

export const CLOSED_REASON_LABEL: Record<ClosedReason, string> = {
  manual: "Closed by hand",
};

/**
 * Is this store shut?
 *
 * The single definition. Every consumer that plans or measures a VISIT reads
 * this rather than testing the field itself, so there is one place to change
 * when the rule moves.
 */
export function isClosed(store: Pick<Store, "closed">): boolean {
  return store.closed === true;
}

/** Stores a rep could be routed to, as far as closure goes. */
export function activeStores<T extends Pick<Store, "closed">>(stores: T[]): T[] {
  return stores.filter((s) => !isClosed(s));
}

/** What the status badge says, and what the filter groups on. */
export type StoreStatus = "active" | "closed";

export function storeStatus(store: Pick<Store, "closed">): StoreStatus {
  return isClosed(store) ? "closed" : "active";
}

/**
 * Why this store is shut, in words, or null when it is open.
 *
 * An older record closed before `closedReason` existed falls back to a generic
 * label rather than rendering an empty tooltip.
 */
export function closedReasonLabel(store: Pick<Store, "closed" | "closedReason">): string | null {
  if (!isClosed(store)) return null;
  return store.closedReason ? CLOSED_REASON_LABEL[store.closedReason] ?? "Closed" : "Closed";
}

/**
 * The fields to write when a PERSON flips a store between active and closed.
 *
 * Pure, and returns a patch rather than mutating, because this is the write
 * that stops a rep being sent to a shop. It is asserted directly in
 * scripts/check-closed-stores.ts instead of being inferred from the route that
 * calls it.
 *
 * Reopening CLEARS the reason and the timestamp: a store that is open has no
 * reason to be shut, and leaving the old one behind is how a reopened shop goes
 * on showing "Closed by hand" in its tooltip forever.
 */
export function setStatusByHand(
  closed: boolean,
  now: string = new Date().toISOString()
): Pick<Store, "closed" | "closedReason" | "closedAt" | "statusDecidedByHand"> {
  if (closed) {
    return { closed: true, closedReason: "manual", closedAt: now, statusDecidedByHand: true };
  }
  return { closed: false, closedReason: undefined, closedAt: undefined, statusDecidedByHand: true };
}

/**
 * Apply a patch from setStatusByHand to a store, deleting cleared keys rather
 * than writing `undefined` into the JSON. Returns true when anything changed.
 */
export function applyStatus(store: Store, closed: boolean, now?: string): boolean {
  // Saying what is already true changes nothing, and must not restamp the date
  // a store was first shut: an edit form sends its status on every save.
  if (isClosed(store) === closed) return false;
  const patch = setStatusByHand(closed, now);
  if (patch.closed) {
    store.closed = true;
    store.closedReason = patch.closedReason;
    store.closedAt = patch.closedAt;
  } else {
    delete store.closed;
    delete store.closedReason;
    delete store.closedAt;
  }
  store.statusDecidedByHand = true;
  return true;
}

/**
 * Read an Active/Closed cell from a spreadsheet.
 *
 * Returns undefined for a blank cell (leave the store alone) and null for text
 * that is neither, so the importer can report it instead of guessing.
 */
export function parseStatusCell(raw: string): boolean | undefined | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return undefined;
  if (["closed", "close", "shut", "yes", "y", "true", "1"].includes(v)) return true;
  if (["active", "open", "no", "n", "false", "0"].includes(v)) return false;
  return null;
}
