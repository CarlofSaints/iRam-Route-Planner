import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { refuseEdit } from "@/lib/editGuard";
import { refusedRouteSettings } from "@/lib/routeAccess";

export async function GET() {
  try {
    return NextResponse.json(await getSettings());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await refuseEdit("settings");
  if (denied) return denied;

  try {
    const body = await request.json();
    const current = await getSettings();
    const next = { ...current };
    const changes: string[] = [];
    const session = await getSession();

    // Checked before anything moves: the out-of-range radius and the
    // calls-per-day target redraw every rep's routes, so they need the same
    // admin rule as generating them (lib/routeAccess.ts).
    if (refusedRouteSettings(session, body).length > 0) {
      return NextResponse.json(
        { error: "Only an admin can change the out-of-range radius or the calls per day target." },
        { status: 403 }
      );
    }

    if (body.outlierRadiusKm !== undefined) {
      const km = Number(body.outlierRadiusKm);
      if (!isNaN(km) && km > 0 && Math.round(km) !== current.outlierRadiusKm) {
        next.outlierRadiusKm = Math.round(km);
        changes.push(`out-of-range radius set to ${next.outlierRadiusKm} km`);
      }
    }

    // The Monday home-address reminder. Only a real boolean moves it: a stray
    // "false" string from a form would otherwise silently switch off a job whose
    // only failure symptom is mail that stops arriving. Admins only: the switch
    // stops the mail for every team, not just the caller's.
    if (typeof body.homeAddressRemindersEnabled === "boolean") {
      if (!session || (session.role !== "admin" && session.role !== "superAdmin")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const previous = next.homeAddressRemindersEnabled !== false;
      if (body.homeAddressRemindersEnabled !== previous) {
        next.homeAddressRemindersEnabled = body.homeAddressRemindersEnabled;
        changes.push(`home address reminders ${body.homeAddressRemindersEnabled ? "back on" : "off"}`);
      }
    }

    // Calls per day. `null` clears the target and returns day sizing to the
    // clock; that is a real choice and has to be expressible, which is why it
    // is not folded in with "undefined" (meaning the caller said nothing).
    // It redraws every rep's week on the next run, so it is admin-only (checked
    // above, with the radius).
    if (body.callsPerDay !== undefined) {
      const previous = next.callsPerDay;
      if (body.callsPerDay === null || body.callsPerDay === "") {
        delete next.callsPerDay;
        if (previous !== undefined) changes.push("calls per day back to no target");
      } else {
        const calls = Number(body.callsPerDay);
        if (!isNaN(calls) && calls >= 1 && calls <= 30 && Math.round(calls) !== previous) {
          next.callsPerDay = Math.round(calls);
          changes.push(`calls per day set to ${next.callsPerDay}`);
        }
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
