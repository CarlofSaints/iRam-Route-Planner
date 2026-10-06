import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/data";
import { getSession, sessionHasPermission } from "@/lib/auth";

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
    const changes: string[] = [];
    const session = await getSession();

    if (body.outlierRadiusKm !== undefined) {
      const km = Number(body.outlierRadiusKm);
      if (!isNaN(km) && km > 0 && Math.round(km) !== current.outlierRadiusKm) {
        next.outlierRadiusKm = Math.round(km);
        changes.push(`out-of-range radius set to ${next.outlierRadiusKm} km`);
      }
    }

    // The Monday home-address reminder. Only a real boolean moves it: a stray
    // "false" string from a form would otherwise silently switch off a job whose
    // only failure symptom is mail that stops arriving. It needs manage_reps,
    // the same permission that can see the panel, because this route otherwise
    // only asks "are you signed in".
    if (typeof body.homeAddressRemindersEnabled === "boolean") {
      if (!session || !(await sessionHasPermission(session, "manage_reps"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const previous = next.homeAddressRemindersEnabled !== false;
      if (body.homeAddressRemindersEnabled !== previous) {
        next.homeAddressRemindersEnabled = body.homeAddressRemindersEnabled;
        changes.push(`home address reminders ${body.homeAddressRemindersEnabled ? "back on" : "off"}`);
      }
    }

    await saveSettings(next);

    if (changes.length) {
      const { logActivity } = await import("@/lib/activityLog");
      logActivity({
        action: "Updated settings",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Settings: ${changes.join(", ")}`,
      });
    }

    return NextResponse.json(next);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
