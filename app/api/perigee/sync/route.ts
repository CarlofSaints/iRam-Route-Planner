import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getSession } from "@/lib/auth";
import { appendSyncLog, getPerigeeConfig } from "@/lib/perigeeData";
import { importPerigeeVisits } from "@/lib/perigeeImport";
import { PerigeeFetchError } from "@/lib/perigeeApi";
import { logActivity } from "@/lib/activityLog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// POST — pull visits for a date range.
// Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", mode: "test" | "import" }
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { from, to, mode } = await request.json();
  if (!ISO_DATE.test(from ?? "") || !ISO_DATE.test(to ?? "")) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "'from' is after 'to'" }, { status: 400 });
  }
  if (!["test", "import"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const config = await getPerigeeConfig();
  if (!config.apiKey || !config.endpoint) {
    return NextResponse.json({ error: "Perigee API is not configured" }, { status: 400 });
  }

  try {
    const result = await importPerigeeVisits({ from, to, mode, source: "manual", config });

    if (mode === "import") {
      const session = await getSession();
      logActivity({
        action: "Synced Perigee visits",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Perigee visits ${from} → ${to}: ${result.imported} imported, ${result.skipped} skipped`,
      });
    }

    return NextResponse.json({ mode, ...result });
  } catch (err) {
    const errorMsg =
      err instanceof PerigeeFetchError
        ? `Perigee HTTP ${err.status}${err.detail ? ` — ${err.detail.slice(0, 200)}` : ""}`
        : err instanceof Error
          ? err.message
          : "Unknown error";

    await appendSyncLog({
      timestamp: new Date().toISOString(),
      source: "manual",
      from,
      to,
      recordsFetched: 0,
      recordsImported: 0,
      recordsSkipped: 0,
      error: errorMsg,
    });
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }
}
