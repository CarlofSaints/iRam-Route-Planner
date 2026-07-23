import { Rep, Store } from "./types";
import { parseLatLng, haversineKm, medianCenter } from "./route-engine";

export interface OutlierStore {
  repCode: string;
  repName: string;
  storeId: string;
  storeName: string;
  channelId: string;
  distanceKm: number;
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
 */
export function computeOutliers(
  reps: Rep[],
  stores: Store[],
  radiusKm: number
): OutlierResult {
  const byRep = new Map<string, Store[]>();
  for (const s of stores) {
    if (!byRep.has(s.repCode)) byRep.set(s.repCode, []);
    byRep.get(s.repCode)!.push(s);
  }

  const out: OutlierStore[] = [];
  const perRep: Record<string, number> = {};

  for (const rep of reps) {
    const repStores = byRep.get(rep.code) || [];
    const center = medianCenter(repStores);
    if (!center) continue;

    for (const s of repStores) {
      if (s.rangeConfirmed) continue;
      const p = parseLatLng(s.gpsLat, s.gpsLng);
      if (!p) continue; // invalid GPS is a separate exception
      const d = haversineKm(center.lat, center.lng, p.lat, p.lng);
      if (d > radiusKm) {
        out.push({
          repCode: rep.code,
          repName: rep.name,
          storeId: s.id,
          storeName: s.name,
          channelId: s.channelId,
          distanceKm: Math.round(d),
        });
        perRep[rep.code] = (perRep[rep.code] || 0) + 1;
      }
    }
  }

  out.sort((a, b) => b.distanceKm - a.distanceKm);
  return { radiusKm, perRep, stores: out };
}
