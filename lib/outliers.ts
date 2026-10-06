import { Rep, Store, Channel, VisitRole, DEFAULT_VISIT_ROLES } from "./types";
import { parseLatLng, haversineKm, medianCenter } from "./route-engine";
import { getStoresForRep, getRoleForRep } from "./repStores";
import { isForeignCoordinate } from "./saCoordinates";

export interface OutlierStore {
  repCode: string;
  repName: string;
  storeId: string;
  storeName: string;
  channelId: string;
  distanceKm: number;
  /**
   * The coordinate is a real number pair but not in South Africa (a name
   * geocoded without a country, or lat/lng swapped). Broken, not distant:
   * the route engine never routes it, so it must not be offered "Confirm in
   * cycle". Listed even when already confirmed, because confirming did not
   * and cannot make it routable.
   */
  foreignCoordinate: boolean;
}

export interface OutlierResult {
  radiusKm: number;
  perRep: Record<string, number>; // repCode -> count of out-of-range (unconfirmed) stores
  stores: OutlierStore[];
}

/**
 * Find stores that sit far outside their rep's working area. Distance is
 * measured from the rep's median store location (robust to the outliers
 * themselves). Stores already confirmed in-cycle (`rangeConfirmed`) or with
 * invalid GPS are skipped.
 *
 * Visit roles with `checkOutliers` off are skipped entirely: a QC or training
 * rep covering a whole province is not misallocated, so flagging their stores
 * would bury the genuine sales-rep exceptions in noise.
 */
export function computeOutliers(
  reps: Rep[],
  stores: Store[],
  radiusKm: number,
  visitRoles: VisitRole[] = DEFAULT_VISIT_ROLES,
  channels: Channel[] = []
): OutlierResult {
  const out: OutlierStore[] = [];
  const perRep: Record<string, number> = {};

  for (const rep of reps) {
    const role = getRoleForRep(rep, visitRoles);
    if (!role.checkOutliers) continue;

    const repStores = getStoresForRep(rep, stores, role, null, channels);
    // The rep's area is measured from their South African stores only, the
    // same as the route engine, so a store in Montana cannot drag it.
    const center = medianCenter(repStores.filter((s) => !isForeignCoordinate(s.gpsLat, s.gpsLng)));

    for (const s of repStores) {
      const p = parseLatLng(s.gpsLat, s.gpsLng);
      if (!p) continue; // invalid GPS is a separate exception
      const foreign = isForeignCoordinate(s.gpsLat, s.gpsLng);
      if (!foreign && s.rangeConfirmed) continue;
      if (!foreign && !center) continue;
      const d = center ? haversineKm(center.lat, center.lng, p.lat, p.lng) : 0;
      if (foreign || d > radiusKm) {
        out.push({
          repCode: rep.code,
          repName: rep.name,
          storeId: s.id,
          storeName: s.name,
          channelId: s.channelId,
          distanceKm: Math.round(d),
          foreignCoordinate: foreign,
        });
        perRep[rep.code] = (perRep[rep.code] || 0) + 1;
      }
    }
  }

  out.sort((a, b) => b.distanceKm - a.distanceKm);
  return { radiusKm, perRep, stores: out };
}
