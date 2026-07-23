import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getCronLog, getPerigeeSyncLog } from "@/lib/perigeeData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [sync, cron] = await Promise.all([getPerigeeSyncLog(), getCronLog()]);
  return NextResponse.json(
    { sync, cron },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
