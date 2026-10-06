/**
 * Which saved plan a run for SOME reps merges into.
 *
 * 🔴 A partial run (a subset Apply, or Generate with reps ticked) rebuilds a
 * few reps and has to keep everybody else's week. It used to merge only into
 * the per-type file, and when that file did not exist it saved a document
 * holding just the ticked reps over BOTH the per-type file and the `routes`
 * snapshot: every other rep's week gone, and the only sign an almost-empty
 * Routes page.
 *
 * Now: the per-type file when there is one; otherwise the snapshot, but only
 * when it describes the same call cycle type (or none); otherwise refuse, and
 * say what to do instead. Refusing costs one click; guessing costs the book.
 */

import type { RoutePlanDocument } from "./types";

export const PARTIAL_RUN_REFUSAL =
  "There is no saved plan for this call cycle type to add these reps to. Generate everyone first, then rebuild a few reps.";

export function mergeBaseForPartialRun(
  activeTypeId: string | undefined,
  perType: RoutePlanDocument | null,
  snapshot: RoutePlanDocument | null
): { base: RoutePlanDocument } | { refusal: string } {
  if (activeTypeId && perType) return { base: perType };
  if (snapshot && (!snapshot.callCycleTypeId || snapshot.callCycleTypeId === activeTypeId)) {
    return { base: snapshot };
  }
  return { refusal: PARTIAL_RUN_REFUSAL };
}
