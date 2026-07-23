import { put, list, del } from "@vercel/blob";
import {
  PerigeeVisit,
  PerigeeSyncConfig,
  PerigeeSyncLogEntry,
  PollSchedule,
  CronLogEntry,
} from "./types";
import { DEFAULT_PERIGEE_ENDPOINT } from "./perigeeApi";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

const MAX_SYNC_LOG_ENTRIES = 100;
const MAX_CRON_LOG_ENTRIES = 100;

// ---------- low-level helpers (mirrors data.ts pattern) ----------

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      if (blobs.length === 0) return fallback;
      const res = await fetch(blobs[0].url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  }
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON<T>(key: string, data: T): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      for (const b of blobs) await del(b.url);
    } catch {
      /* ignore */
    }
    await put(`${key}.json`, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return;
  }
  const filePath = path.join(DATA_DIR, `${key}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf-8");
}

// ---------- Perigee Config ----------

const DEFAULT_CONFIG: PerigeeSyncConfig = {
  apiKey: "",
  endpoint: DEFAULT_PERIGEE_ENDPOINT,
  customer: "",
  requestBody: "",
  enabled: false,
  lastVisitSync: null,
};

export async function getPerigeeConfig(): Promise<PerigeeSyncConfig> {
  const cfg = await readJSON<PerigeeSyncConfig>("config/perigee-api", DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...cfg };
}

export async function savePerigeeConfig(config: PerigeeSyncConfig): Promise<void> {
  await writeJSON("config/perigee-api", config);
}

// ---------- Poll schedule ----------

const DEFAULT_SCHEDULE: PollSchedule = {
  slots: [],
  timezone: "Africa/Johannesburg",
};

export async function getPollSchedule(): Promise<PollSchedule> {
  const s = await readJSON<PollSchedule>("config/perigee-schedule", DEFAULT_SCHEDULE);
  return { timezone: s.timezone || DEFAULT_SCHEDULE.timezone, slots: Array.isArray(s.slots) ? s.slots : [] };
}

export async function savePollSchedule(schedule: PollSchedule): Promise<void> {
  await writeJSON("config/perigee-schedule", schedule);
}

// ---------- Visits ----------

export async function getPerigeeVisits(): Promise<PerigeeVisit[]> {
  return readJSON<PerigeeVisit[]>("perigee-visits", []);
}

export async function savePerigeeVisits(visits: PerigeeVisit[]): Promise<void> {
  await writeJSON("perigee-visits", visits);
}

// ---------- Sync log (manual + cron imports) ----------

export async function getPerigeeSyncLog(): Promise<PerigeeSyncLogEntry[]> {
  return readJSON<PerigeeSyncLogEntry[]>("logs/perigee-sync", []);
}

export async function appendSyncLog(entry: PerigeeSyncLogEntry): Promise<void> {
  const log = await getPerigeeSyncLog();
  log.unshift(entry); // newest first
  if (log.length > MAX_SYNC_LOG_ENTRIES) log.length = MAX_SYNC_LOG_ENTRIES;
  await writeJSON("logs/perigee-sync", log);
}

// ---------- Cron log (every wake-up, matched or not) ----------

export async function getCronLog(): Promise<CronLogEntry[]> {
  return readJSON<CronLogEntry[]>("logs/perigee-cron", []);
}

export async function appendCronLog(entry: CronLogEntry): Promise<void> {
  try {
    const log = await getCronLog();
    log.unshift(entry);
    if (log.length > MAX_CRON_LOG_ENTRIES) log.length = MAX_CRON_LOG_ENTRIES;
    await writeJSON("logs/perigee-cron", log);
  } catch {
    // Logging must never fail the poll itself.
  }
}
