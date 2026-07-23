import { Store } from "./types";

// Group key: same store name + same rep = the same physical store.
export function dupGroupKey(s: Store): string {
  return `${(s.name || "").trim().toUpperCase()}|${s.repCode}`;
}

// Score a record so we keep the "best" one in a duplicate group: prefer a valid
// in-SA coordinate, then any valid GPS, then a real channel / province / confirmation.
export function scoreStore(s: Store): number {
  const lat = parseFloat(s.gpsLat);
  const lng = parseFloat(s.gpsLng);
  const validGps =
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
  const inSA = validGps && lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33;
  let n = 0;
  if (inSA) n += 100;
  else if (validGps) n += 40;
  if ((s.channelId || "").trim()) n += 10;
  if ((s.province || "").trim()) n += 5;
  if (s.rangeConfirmed) n += 3;
  return n;
}

export interface DupRecord {
  id: string;
  placeId: string;
  channelId: string;
  gpsLat: string;
  gpsLng: string;
  keep: boolean;
}

export interface DupGroup {
  key: string;
  storeName: string;
  repCode: string;
  keepId: string;
  records: DupRecord[];
}

export function buildDuplicateGroups(
  stores: Store[]
): { groups: DupGroup[]; removeIds: Set<string> } {
  const byKey = new Map<string, Store[]>();
  for (const s of stores) {
    const k = dupGroupKey(s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }

  const groups: DupGroup[] = [];
  const removeIds = new Set<string>();

  for (const [key, recs] of byKey) {
    if (recs.length < 2) continue;
    let keep = recs[0];
    for (const r of recs) if (scoreStore(r) > scoreStore(keep)) keep = r;
    for (const r of recs) if (r.id !== keep.id) removeIds.add(r.id);

    groups.push({
      key,
      storeName: keep.name,
      repCode: keep.repCode,
      keepId: keep.id,
      records: recs.map((r) => ({
        id: r.id,
        placeId: r.placeId,
        channelId: r.channelId,
        gpsLat: r.gpsLat,
        gpsLng: r.gpsLng,
        keep: r.id === keep.id,
      })),
    });
  }

  groups.sort((a, b) => b.records.length - a.records.length);
  return { groups, removeIds };
}
