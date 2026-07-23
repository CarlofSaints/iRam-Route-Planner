import { getReps, getStores } from "./data";
import {
  buildPerigeeBody,
  fetchAllPerigeeVisits,
  mapPerigeeVisit,
  visitDedupKey,
  type PerigeePageInfo,
} from "./perigeeApi";
import { appendSyncLog, getPerigeeConfig, getPerigeeVisits, savePerigeeConfig, savePerigeeVisits } from "./perigeeData";
import { PerigeeSyncConfig, PerigeeVisit } from "./types";

export interface PerigeeImportResult {
  from: string;
  to: string;
  fetched: number;
  imported: number;
  skipped: number;
  unmatchedReps: number;
  totalStored: number;
  pageInfo: PerigeePageInfo;
  sample: PerigeeVisit[];
}

/**
 * Resolve each visit's `repCode`. Perigee identifies a rep by their login
 * email; this app links stores to reps by `Store.repCode`. Prefer the rep's own
 * email, and fall back to whoever the visited store is allocated to.
 */
async function resolveRepCodes(visits: PerigeeVisit[]): Promise<{ visits: PerigeeVisit[]; unmatched: number }> {
  const [reps, stores] = await Promise.all([getReps(), getStores()]);

  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const r of reps) {
    if (r.email) byEmail.set(r.email.trim().toLowerCase(), r.code);
    if (r.name) byName.set(r.name.trim().toLowerCase(), r.code);
  }

  const storeRep = new Map<string, string>();
  for (const s of stores) {
    if (s.placeId && s.repCode) storeRep.set(s.placeId.trim().toLowerCase(), s.repCode);
  }

  let unmatched = 0;
  const resolved = visits.map((v) => {
    const code =
      (v.repEmail && byEmail.get(v.repEmail)) ||
      (v.repName && byName.get(v.repName.trim().toLowerCase())) ||
      (v.storeCode && storeRep.get(v.storeCode.trim().toLowerCase())) ||
      "";
    if (!code) unmatched++;
    return { ...v, repCode: code };
  });

  return { visits: resolved, unmatched };
}

/**
 * Fetch a date range from Perigee and (unless `mode` is "test") merge it into
 * stored visits, de-duplicated. Shared by the admin page and the cron poller.
 */
export async function importPerigeeVisits(opts: {
  from: string;
  to: string;
  mode: "test" | "import";
  source: "manual" | "cron";
  config?: PerigeeSyncConfig;
}): Promise<PerigeeImportResult> {
  const config = opts.config ?? (await getPerigeeConfig());
  const body = buildPerigeeBody(opts.from, opts.to, config.customer, config.requestBody);

  const { rows, pageInfo } = await fetchAllPerigeeVisits(config.endpoint, config.apiKey, body);

  const mapped = rows.map(mapPerigeeVisit).filter((v) => v.storeCode || v.repEmail || v.repName);
  const { visits: withRepCodes, unmatched } = await resolveRepCodes(mapped);

  // De-duplicate inside the batch first (overlapping pages can repeat rows).
  const batchSeen = new Set<string>();
  const batch: PerigeeVisit[] = [];
  for (const v of withRepCodes) {
    const key = visitDedupKey(v);
    if (batchSeen.has(key)) continue;
    batchSeen.add(key);
    batch.push(v);
  }

  if (opts.mode === "test") {
    return {
      from: opts.from,
      to: opts.to,
      fetched: rows.length,
      imported: 0,
      skipped: 0,
      unmatchedReps: unmatched,
      totalStored: 0,
      pageInfo,
      sample: batch.slice(0, 5),
    };
  }

  const existing = await getPerigeeVisits();
  const existingKeys = new Set(existing.map(visitDedupKey));
  const fresh = batch.filter((v) => !existingKeys.has(visitDedupKey(v)));
  const skipped = withRepCodes.length - fresh.length;

  if (fresh.length > 0) await savePerigeeVisits([...existing, ...fresh]);
  await savePerigeeConfig({ ...config, lastVisitSync: new Date().toISOString() });

  await appendSyncLog({
    timestamp: new Date().toISOString(),
    source: opts.source,
    from: opts.from,
    to: opts.to,
    recordsFetched: rows.length,
    recordsImported: fresh.length,
    recordsSkipped: skipped,
    pagesFetched: pageInfo.pagesFetched,
  });

  return {
    from: opts.from,
    to: opts.to,
    fetched: rows.length,
    imported: fresh.length,
    skipped,
    unmatchedReps: unmatched,
    totalStored: existing.length + fresh.length,
    pageInfo,
    sample: fresh.slice(0, 5),
  };
}
