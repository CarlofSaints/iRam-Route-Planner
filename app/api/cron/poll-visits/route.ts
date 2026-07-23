import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { appendCronLog, getPerigeeConfig, getPollSchedule } from "@/lib/perigeeData";
import { importPerigeeVisits } from "@/lib/perigeeImport";
import { PerigeeFetchError } from "@/lib/perigeeApi";
import { CronLogEntry, PollSlot } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel cron fires every 30 min, so a slot matches within ±14 minutes. */
const SLOT_WINDOW_MINUTES = 14;
const DAY_MS = 86_400_000;

/** Wall-clock date and time in the given IANA timezone. */
function localNow(timeZone: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

function daysBefore(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Cron-triggered Perigee poll. Vercel calls this every 30 minutes; it only does
 * work when the current SAST time lands on a configured slot.
 *
 * `?force=true` runs an immediate poll regardless of the schedule — that is what
 * the "Run now" button on the Perigee admin page uses.
 */
export async function GET(req: NextRequest) {
  const forceRun = req.nextUrl.searchParams.get("force") === "true";

  // Auth: Vercel cron sends CRON_SECRET; a human must be an admin.
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;
  if (!isCronAuth) {
    try {
      await requireAdmin();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const logEntry: CronLogEntry = { timestamp: new Date().toISOString(), matched: false };

  try {
    const config = await getPerigeeConfig();
    if (!config.enabled && !forceRun) {
      logEntry.result = "Perigee integration disabled";
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: "none", reason: logEntry.result });
    }
    if (!config.endpoint || !config.apiKey) {
      logEntry.result = "Perigee API not configured";
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: "none", reason: logEntry.result });
    }

    const schedule = await getPollSchedule();
    const tz = schedule.timezone || "Africa/Johannesburg";
    const now = localNow(tz);
    const nowMins = now.hour * 60 + now.minute;
    const clock = `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;

    let matchedSlot: PollSlot | undefined;
    if (forceRun) {
      matchedSlot = {
        id: "manual",
        time: clock,
        type: schedule.slots.find((s) => s.enabled)?.type ?? "short",
        enabled: true,
      };
    } else {
      matchedSlot = schedule.slots.find((slot) => {
        if (!slot.enabled) return false;
        const [h, m] = slot.time.split(":").map(Number);
        return Math.abs(nowMins - (h * 60 + m)) <= SLOT_WINDOW_MINUTES;
      });
    }

    if (!matchedSlot) {
      logEntry.result = `No poll slot at ${clock} (${tz})`;
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: "none", reason: logEntry.result });
    }

    logEntry.matched = true;
    logEntry.slotTime = matchedSlot.time;
    logEntry.slotType = matchedSlot.type;

    // short = today only; long = last 7 days, which re-picks up back-dated edits.
    const to = now.date;
    const from = matchedSlot.type === "long" ? daysBefore(to, 7) : to;

    const result = await importPerigeeVisits({ from, to, mode: "import", source: "cron", config });

    logEntry.result = result.imported > 0 ? "Success" : "No new visits";
    logEntry.imported = result.imported;
    logEntry.skipped = result.skipped;
    await appendCronLog(logEntry);

    return NextResponse.json({
      ok: true,
      action: "imported",
      from,
      to,
      imported: result.imported,
      skipped: result.skipped,
      unmatchedReps: result.unmatchedReps,
      pageInfo: result.pageInfo,
    });
  } catch (err) {
    logEntry.error =
      err instanceof PerigeeFetchError
        ? `Perigee HTTP ${err.status}${err.detail ? ` — ${err.detail.slice(0, 200)}` : ""}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await appendCronLog(logEntry);
    console.error("Perigee cron poll error:", err);
    return NextResponse.json({ ok: false, error: logEntry.error }, { status: 500 });
  }
}
