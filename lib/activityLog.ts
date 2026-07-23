import { put, list, del } from "@vercel/blob";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const MAX_ENTRIES = 500;

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;      // email
  actorName: string;
  summary: string;
  details?: string;
}

function monthKey(month?: string): string {
  if (month && /^\d{4}-\d{2}$/.test(month)) return month;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function blobKey(month: string): string {
  return `logs/activity/${month}`;
}

async function readLog(month: string): Promise<ActivityLogEntry[]> {
  const key = blobKey(month);
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      if (blobs.length === 0) return [];
      const res = await fetch(blobs[0].url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      return (await res.json()) as ActivityLogEntry[];
    } catch {
      return [];
    }
  }
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ActivityLogEntry[];
  } catch {
    return [];
  }
}

async function writeLog(month: string, entries: ActivityLogEntry[]): Promise<void> {
  const key = blobKey(month);
  const body = JSON.stringify(entries, null, 2);
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      for (const b of blobs) await del(b.url);
    } catch { /* ignore */ }
    await put(`${key}.json`, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return;
  }
  const dir = path.dirname(path.join(DATA_DIR, `${key}.json`));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), body, "utf-8");
}

/**
 * Fire-and-forget activity logger. Call without await in API routes.
 */
export function logActivity(entry: Omit<ActivityLogEntry, "id" | "timestamp">): void {
  const full: ActivityLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  const month = monthKey();

  // Fire and forget — don't block the response
  readLog(month)
    .then((entries) => {
      entries.unshift(full);
      if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
      return writeLog(month, entries);
    })
    .catch(() => { /* swallow errors — logging should never break the app */ });
}

/**
 * Read log entries for a given month.
 */
export async function getActivityLog(month?: string): Promise<ActivityLogEntry[]> {
  return readLog(monthKey(month));
}
