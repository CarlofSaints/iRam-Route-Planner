import { NextRequest, NextResponse } from "next/server";
import { getVisitRoles, saveVisitRoles, getReps } from "@/lib/data";
import { VisitRole, FrequencyType } from "@/lib/types";
import { requireSession, requireAdmin, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await getVisitRoles());
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();
    const { id, name, frequency, duration, checkOutliers } = body as Partial<VisitRole> & { id: string };

    const roles = await getVisitRoles();
    const idx = roles.findIndex((r) => r.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (name) roles[idx].name = name;
    if (frequency) roles[idx].frequency = frequency as FrequencyType;
    if (duration !== undefined) roles[idx].duration = duration;
    if (checkOutliers !== undefined) roles[idx].checkOutliers = checkOutliers;
    // isPrimary is deliberately not editable here — which role is primary is
    // what Store.repCode means, and flipping it would silently re-point every
    // rep's store list.

    await saveVisitRoles(roles);

    const session = await getSession();
    logActivity({ action: "Updated visit role", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated visit role ${roles[idx].name}` });

    return NextResponse.json(roles[idx]);
  } catch (err) {
    if (String(err).includes("Unauthorized") || String(err).includes("Forbidden")) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();
    if (!body.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const roles = await getVisitRoles();
    const id = String(body.name).toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (roles.some((r) => r.id === id)) {
      return NextResponse.json({ error: "A role with that name already exists" }, { status: 409 });
    }

    // Anything added here is a higher-level role — there is only ever one
    // primary, and it already exists.
    const newRole: VisitRole = {
      id,
      name: body.name,
      frequency: body.frequency || "quarterly",
      duration: body.duration || 60,
      isPrimary: false,
      checkOutliers: body.checkOutliers ?? false,
    };
    roles.push(newRole);
    await saveVisitRoles(roles);

    const session = await getSession();
    logActivity({ action: "Created visit role", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created visit role ${newRole.name}` });

    return NextResponse.json(newRole, { status: 201 });
  } catch (err) {
    if (String(err).includes("Unauthorized") || String(err).includes("Forbidden")) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();
    const id: string | undefined = body.id;
    if (!id) return NextResponse.json({ error: "No role id provided" }, { status: 400 });

    const roles = await getVisitRoles();
    const target = roles.find((r) => r.id === id);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // The primary role underpins Store.repCode — removing it would leave every
    // sales rep with no rhythm to plan against.
    if (target.isPrimary) {
      return NextResponse.json({ error: "The primary sales role cannot be deleted" }, { status: 400 });
    }

    // Reps still on this role would silently fall back to primary and pick up
    // the wrong store list, so block until they are moved.
    const reps = await getReps();
    const inUse = reps.filter((r) => r.visitRoleId === id);
    if (inUse.length > 0) {
      return NextResponse.json(
        {
          error: `${inUse.length} rep${inUse.length === 1 ? " is" : "s are"} still on this role: ${inUse.map((r) => r.name || r.code).join(", ")}. Move them to another role first.`,
        },
        { status: 409 }
      );
    }

    await saveVisitRoles(roles.filter((r) => r.id !== id));

    const session = await getSession();
    logActivity({ action: "Deleted visit role", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Deleted visit role ${target.name}` });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).includes("Unauthorized") || String(err).includes("Forbidden")) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
