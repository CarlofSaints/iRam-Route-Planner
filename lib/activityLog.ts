import { put, get } from "@vercel/blob";
import { after } from "next/server";
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
    // Read by key, not via list() — see the note on readJSON in lib/data.ts.
    // The listing index lags a write, and the old code turned the resulting
    // 404 into an empty log, which then got written back over the month's
    // real entries. That is why 4 Aug's activity history disappeared.
    const result = await get(`${key}.json`, { access: "private", useCache: false });
    if (!result) return [];
    const text = await new Response(result.stream).text();
    if (!text.trim()) return [];
    return JSON.parse(text) as ActivityLogEntry[];
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
    await put(`${key}.json`, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  const dir = path.dirname(path.join(DATA_DIR, `${key}.json`));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), body, "utf-8");
}

/**
 * Activity logger. Call without await in API routes — the write is handed to
 * Next's after(), which keeps the serverless instance alive until it finishes.
 *
 * A bare fire-and-forget promise does NOT survive on Vercel: once the response
 * is sent the instance can be frozen mid-write, so entries were being dropped.
 * after() is the supported way to run work past the response.
 */
export function logActivity(entry: Omit<ActivityLogEntry, "id" | "timestamp">): void {
  const full: ActivityLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  const month = monthKey();

  const write = async () => {
    const entries = await readLog(month);
    entries.unshift(full);
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    await writeLog(month, entries);
  };

  const run = () => write().catch((err) => {
    // Logging must never break the app, but it should be visible in the
    // function logs rather than vanishing.
    console.error("logActivity failed:", err);
  });

  try {
    // Only available inside a request lifecycle; scripts and tests fall back.
    after(run);
  } catch {
    run();
  }
}

/**
 * Read log entries for a given month.
 */
export async function getActivityLog(month?: string): Promise<ActivityLogEntry[]> {
  return readLog(monthKey(month));
}
