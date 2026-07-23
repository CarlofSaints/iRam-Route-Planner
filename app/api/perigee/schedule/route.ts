import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getSession } from "@/lib/auth";
import { getPollSchedule, savePollSchedule } from "@/lib/perigeeData";
import { PollSlot } from "@/lib/types";
import { logActivity } from "@/lib/activityLog";

export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getPollSchedule(), { headers: NO_CACHE });
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const slots: PollSlot[] = Array.isArray(body.slots) ? body.slots : [];

  for (const slot of slots) {
    if (!slot.id || !HHMM.test(slot.time ?? "") || !["short", "long"].includes(slot.type)) {
      return NextResponse.json(
        { error: "Each slot needs an id, a time (HH:MM) and a type of short or long" },
        { status: 400, headers: NO_CACHE }
      );
    }
  }

  await savePollSchedule({ slots, timezone: body.timezone || "Africa/Johannesburg" });

  const session = await getSession();
  logActivity({
    action: "Updated Perigee poll schedule",
    actor: session?.email || "unknown",
    actorName: session?.name || "Unknown",
    summary: `Perigee poll schedule: ${slots.filter((s) => s.enabled).length} active slot(s)`,
  });

  return NextResponse.json({ ok: true }, { headers: NO_CACHE });
}
