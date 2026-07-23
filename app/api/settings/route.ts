import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/data";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    return NextResponse.json(await getSettings());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const current = await getSettings();
    const next = { ...current };

    if (body.outlierRadiusKm !== undefined) {
      const km = Number(body.outlierRadiusKm);
      if (!isNaN(km) && km > 0) next.outlierRadiusKm = Math.round(km);
    }

    await saveSettings(next);

    const session = await getSession();
    const { logActivity } = await import("@/lib/activityLog");
    logActivity({
      action: "Updated settings",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Set out-of-range radius to ${next.outlierRadiusKm} km`,
    });

    return NextResponse.json(next);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
