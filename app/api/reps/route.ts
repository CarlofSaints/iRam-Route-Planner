import { NextRequest, NextResponse } from "next/server";
import { getReps, saveReps } from "@/lib/data";
import { Rep } from "@/lib/types";
import { getSession, requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

/**
 * These writes were gated only by the middleware's "is there a valid session",
 * so any signed-in account could rewrite any rep's email, team, visit role or
 * home coordinates. That was survivable while every user was an admin; it stops
 * being survivable the moment reps have logins of their own. The middleware
 * already refuses a rep everything outside their profile — this is the second
 * gate, and the one that also covers viewers.
 */
function authFailure(err: unknown): NextResponse | null {
  const text = String(err);
  if (text.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (text.includes("Forbidden")) {
    return NextResponse.json({ error: "You do not have permission to change rep records." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const reps = await getReps();
    return NextResponse.json(reps);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requirePermission("manage_reps");
    const body = await request.json();
    const { id, ...updates } = body as Partial<Rep> & { id: string };

    const reps = await getReps();
    const idx = reps.findIndex((r) => r.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Explicitly handle known fields to avoid overwriting with garbage
    if (updates.code !== undefined) reps[idx].code = updates.code;
    if (updates.name !== undefined) reps[idx].name = updates.name;
    if (updates.email !== undefined) reps[idx].email = updates.email;
    if (updates.cell !== undefined) reps[idx].cell = updates.cell;
    // A changed home address invalidates coordinates derived from the old one.
    // Leaving them would anchor the rep's whole week on where they used to
    // live, silently and plausibly — so drop them and let the address be
    // geocoded again. An update that supplies coordinates itself is respected.
    const addressChanged =
      updates.homeAddress !== undefined &&
      updates.homeAddress.trim() !== (reps[idx].homeAddress || "").trim();

    if (updates.homeAddress !== undefined) reps[idx].homeAddress = updates.homeAddress;
    if (addressChanged && updates.homeGpsLat === undefined && updates.homeGpsLng === undefined) {
      reps[idx].homeGpsLat = "";
      reps[idx].homeGpsLng = "";
    }
    if (updates.homeGpsLat !== undefined) reps[idx].homeGpsLat = updates.homeGpsLat;
    if (updates.homeGpsLng !== undefined) reps[idx].homeGpsLng = updates.homeGpsLng;
    if (updates.teamId !== undefined) reps[idx].teamId = updates.teamId;
    if (updates.workingHoursPerDay !== undefined) reps[idx].workingHoursPerDay = updates.workingHoursPerDay;
    if (updates.assignedChannels !== undefined) reps[idx].assignedChannels = updates.assignedChannels;
    if (updates.visitRoleId !== undefined) reps[idx].visitRoleId = updates.visitRoleId || undefined;
    await saveReps(reps);

    const session = await getSession();
    logActivity({ action: "Updated rep", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated rep ${reps[idx].name} (${reps[idx].code})` });

    return NextResponse.json(reps[idx]);
  } catch (err) {
    return authFailure(err) || NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission("manage_reps");
    const body = await request.json();
    const reps = await getReps();

    // Prevent duplicate rep codes
    const code = (body.code || "").trim();
    if (!code) {
      return NextResponse.json({ error: "Rep code is required" }, { status: 400 });
    }
    if (reps.some((r) => r.code.toLowerCase() === code.toLowerCase())) {
      return NextResponse.json({ error: `Rep code "${code}" already exists` }, { status: 409 });
    }

    const newRep: Rep = {
      id: crypto.randomUUID(),
      code,
      name: body.name || "",
      email: body.email || "",
      cell: body.cell || "",
      homeAddress: body.homeAddress || "",
      homeGpsLat: body.homeGpsLat || "",
      homeGpsLng: body.homeGpsLng || "",
      teamId: body.teamId || "",
      workingHoursPerDay: body.workingHoursPerDay ?? 8.5,
      ...(body.visitRoleId ? { visitRoleId: body.visitRoleId } : {}),
    };
    reps.push(newRep);
    await saveReps(reps);

    const session = await getSession();
    logActivity({ action: "Created rep", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created rep ${newRep.name} (${newRep.code})` });

    return NextResponse.json(newRep, { status: 201 });
  } catch (err) {
    return authFailure(err) || NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requirePermission("manage_reps");
    const { id } = await request.json();
    const reps = await getReps();
    const target = reps.find((r) => r.id === id);
    const filtered = reps.filter((r) => r.id !== id);
    await saveReps(filtered);

    const session = await getSession();
    logActivity({ action: "Deleted rep", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Deleted rep ${target?.name || id} (${target?.code || ""})` });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authFailure(err) || NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
