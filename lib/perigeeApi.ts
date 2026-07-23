import { PerigeeVisit } from "./types";

export const DEFAULT_PERIGEE_ENDPOINT = "https://live.perigeeportal.co.za/api/visits";

export class PerigeeFetchError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`Perigee API returned ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export interface PerigeePageInfo {
  pagesFetched: number;
  totalRows: number;
  reportedTotal: number | null;
  reportedLastPage: number | null;
  stoppedReason: string;
}

export interface PerigeeFetchResult {
  rows: Record<string, unknown>[];
  pageInfo: PerigeePageInfo;
  /** Page-1 pagination metadata, surfaced in the admin "Test" preview. */
  firstPageMeta: Record<string, unknown>;
  rawTopLevelKeys: string[];
}

// ---------- Response shape helpers ----------

/**
 * Perigee wraps visits as { visits: { data: [...], ...paginator } } (Laravel
 * style), but older/other endpoints return a bare array or { data: [...] }.
 */
function extractData(resp: unknown): Record<string, unknown>[] {
  if (Array.isArray(resp)) return resp as Record<string, unknown>[];
  const r = resp as Record<string, unknown> | null;
  const visits = r?.visits as Record<string, unknown> | undefined;
  if (visits && !Array.isArray(visits) && Array.isArray(visits.data)) {
    return visits.data as Record<string, unknown>[];
  }
  if (Array.isArray(r?.visits)) return r!.visits as Record<string, unknown>[];
  if (Array.isArray(r?.data)) return r!.data as Record<string, unknown>[];
  return [];
}

/** The paginator object (the `visits` wrapper minus its `data` array). */
function extractMeta(resp: unknown): Record<string, unknown> {
  const r = resp as Record<string, unknown> | null;
  if (r && typeof r.visits === "object" && r.visits !== null && !Array.isArray(r.visits)) {
    const { data: _data, ...meta } = r.visits as Record<string, unknown>;
    return meta;
  }
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const { data: _data, visits: _visits, ...meta } = r;
    return meta;
  }
  return {};
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstRowKey(row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  return String(row.visitGuid ?? row.guid ?? row.visitId ?? JSON.stringify(row).slice(0, 120));
}

// ---------- Paginating fetch ----------

/**
 * Fetch EVERY page of visits for the given request body. The next page is asked
 * for both as a `?page=N` query param and a `page` body field. Stops on: last
 * page reached, reported total collected, an empty/short page, the server not
 * advancing the page, or a hard page cap — so it can never loop forever.
 */
export async function fetchAllPerigeeVisits(
  endpoint: string,
  apiKey: string,
  baseBody: Record<string, unknown>,
  opts?: { maxPages?: number }
): Promise<PerigeeFetchResult> {
  const maxPages = opts?.maxPages ?? 500;
  const all: Record<string, unknown>[] = [];
  let reportedTotal: number | null = null;
  let reportedLastPage: number | null = null;
  let stoppedReason = "complete";
  let firstPageMeta: Record<string, unknown> = {};
  let rawTopLevelKeys: string[] = [];
  let prevFirstKey = "";
  let page = 1;

  for (; page <= maxPages; page++) {
    const url =
      page === 1 ? endpoint : `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...baseBody, page }),
    });

    if (!res.ok) {
      if (page === 1) {
        const detail = await res.text().catch(() => "");
        throw new PerigeeFetchError(res.status, detail.slice(0, 500));
      }
      stoppedReason = `page ${page} returned ${res.status}`;
      break;
    }

    const json = await res.json();
    const data = extractData(json);
    const meta = extractMeta(json);

    if (page === 1) {
      firstPageMeta = meta;
      rawTopLevelKeys =
        json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [];
    }

    reportedTotal =
      num(meta.total ?? meta.totalRows ?? meta.totalRecords ?? meta.count) ?? reportedTotal;
    reportedLastPage =
      num(meta.last_page ?? meta.lastPage ?? meta.totalPages ?? meta.pages) ?? reportedLastPage;
    const currentPage = num(meta.current_page ?? meta.currentPage ?? meta.page);
    const perPage = num(meta.per_page ?? meta.perPage ?? meta.pageSize);

    if (data.length === 0) {
      stoppedReason = page === 1 ? "no rows returned" : "empty page";
      break;
    }

    // Server ignored the page param and handed back the same page again.
    const fKey = firstRowKey(data[0]);
    if (page > 1 && fKey === prevFirstKey) {
      stoppedReason = "server returned same page (ignores page param)";
      break;
    }
    prevFirstKey = fKey;

    if (page > 1 && currentPage !== null && currentPage < page) {
      stoppedReason = `server returned page ${currentPage} for requested ${page}`;
      break;
    }

    all.push(...data);

    if (reportedLastPage !== null) {
      if (page >= reportedLastPage) {
        stoppedReason = "reached last page";
        break;
      }
    } else if (reportedTotal !== null) {
      if (all.length >= reportedTotal) {
        stoppedReason = "collected reported total";
        break;
      }
    } else if (perPage === null || data.length < perPage) {
      // No pagination metadata: a short (or unknown-size) page is the end.
      stoppedReason = "no pagination metadata";
      break;
    }
  }

  if (page > maxPages) stoppedReason = `hit max page cap (${maxPages})`;

  return {
    rows: all,
    pageInfo: {
      pagesFetched: Math.min(page, maxPages),
      totalRows: all.length,
      reportedTotal,
      reportedLastPage,
      stoppedReason,
    },
    firstPageMeta,
    rawTopLevelKeys,
  };
}

// ---------- Request body ----------

/** Build the Perigee POST body for a date range. */
export function buildPerigeeBody(
  from: string,
  to: string,
  customer: string,
  extraJson: string
): Record<string, unknown> {
  let body: Record<string, unknown> = {};
  if (extraJson) {
    try {
      const parsed = JSON.parse(extraJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      /* malformed extras are ignored rather than failing the poll */
    }
  }
  body.startDate = from;
  body.endDate = to;
  if (customer && !body.customers) body.customers = [customer];
  return body;
}

// ---------- Row → PerigeeVisit ----------

function str(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function toNumber(v: string): number {
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "DD/MM/YYYY" → "YYYY-MM-DD"; anything already ISO passes through. */
function normaliseDate(raw: string): string {
  if (!raw) return "";
  const value = raw.includes(" ") ? raw.split(" ")[0] : raw;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return value.slice(0, 10);
}

/** Minutes from either a number of minutes or an "HH:MM(:SS)" duration. */
function parseDuration(raw: string): number {
  if (!raw) return 0;
  const hms = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (hms) return Number(hms[1]) * 60 + Number(hms[2]);
  return toNumber(raw);
}

/**
 * Normalise one raw Perigee row. Field names vary between Perigee report
 * configurations, so every value has a list of fallbacks.
 */
export function mapPerigeeVisit(row: Record<string, unknown>): PerigeeVisit {
  const rawStore = str(row, "store", "Store Full Name", "storeName", "place", "placeName");

  let storeCode = str(row, "storeCode", "placeId", "storeId", "siteCode");
  // Perigee often only gives "Store Name - CODE" — take the trailing segment.
  if (!storeCode && rawStore.includes(" - ")) {
    storeCode = rawStore.substring(rawStore.lastIndexOf(" - ") + 3).trim();
  }

  const checkInAt = str(row, "startDateFull", "checkInDateTime", "checkIn", "dateTimeStart");
  const checkOutAt = str(row, "endDateFull", "checkOutDateTime", "checkOut", "dateTimeEnd");
  const date = normaliseDate(str(row, "checkInDate", "date") || checkInAt);

  const visitId =
    str(row, "visitGuid", "guid", "visitId", "id") ||
    `${storeCode}|${date}|${str(row, "email", "username", "Username")}`;

  return {
    visitId,
    date,
    repCode: "", // resolved on import against Rep.email / Store.repCode
    repName: str(row, "repName", "displayName", "representativeName", "user"),
    repEmail: str(row, "email", "username", "Username", "representativeId").toLowerCase(),
    storeCode,
    storeName: rawStore,
    status: str(row, "status", "callStatus", "visitStatus"),
    durationMinutes: parseDuration(str(row, "visitDuration", "timeAtPlace", "duration")),
    checkInAt,
    checkOutAt,
    lat: toNumber(str(row, "latitude", "lat", "gpsLatitude")),
    lng: toNumber(str(row, "longitude", "lng", "gpsLongitude")),
  };
}

/** Stable key for de-duplicating visits across overlapping polls. */
export function visitDedupKey(v: PerigeeVisit): string {
  return `${v.visitId}`.toLowerCase();
}
