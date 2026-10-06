/**
 * How much of a plan is a real drive rather than a straight line.
 *
 * 🔴 The Routes page used to say "(Google Maps optimized)" whenever a key was
 * configured. That is not what it means. `config.useGoogleMaps` records that a
 * key EXISTED, not that this plan used it — so the header read "Google Maps
 * optimized" over a book in which 572 of 705 days were straight-line estimates,
 * and every distance and drive time on those days was understated.
 *
 * Counted from the days themselves, so it is right on a plan saved before the
 * document recorded it. See [[env-var-set-is-not-a-feature-built]].
 */

import type { RepRoutePlan, RoutePlanDocument } from "./types";

export interface RoadRoutingSummary {
  /**
   * Days that COULD have had a road route: they have stops and the rep has an
   * anchor to route from. A rep with no anchor was never going to get one, so
   * counting them as failures would report the wrong problem.
   */
  eligibleDays: number;
  roadRoutedDays: number;
  /** Eligible days left as straight lines — the ones with wrong distances. */
  straightLineDays: number;
  /** True only when every eligible day got a real drive. */
  complete: boolean;
}

export function countRoadRouting(plans: RepRoutePlan[]): RoadRoutingSummary {
  let eligibleDays = 0;
  let roadRoutedDays = 0;
  for (const p of plans) {
    if (!p.homeLatLng) continue;
    for (const d of p.days) {
      if (!d.stops.length) continue;
      eligibleDays++;
      if (d.polyline) roadRoutedDays++;
    }
  }
  return {
    eligibleDays,
    roadRoutedDays,
    straightLineDays: eligibleDays - roadRoutedDays,
    complete: eligibleDays > 0 && roadRoutedDays === eligibleDays,
  };
}

/** The same summary for a whole document, or null when there is nothing to describe. */
export function roadRoutingOf(doc: RoutePlanDocument | null): RoadRoutingSummary | null {
  if (!doc?.repPlans?.length) return null;
  const s = countRoadRouting(doc.repPlans);
  return s.eligibleDays > 0 ? s : null;
}
