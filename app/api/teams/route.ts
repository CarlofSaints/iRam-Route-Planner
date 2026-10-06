import { NextRequest, NextResponse } from "next/server";
import { getTeams, saveTeams } from "@/lib/data";
import { Team } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { refuseEdit } from "@/lib/editGuard";

export async function GET() {
  try {
    const teams = await getTeams();
    return NextResponse.json(teams);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Whitespace off every text field before it is stored.
 *
 * `managerEmail` is the one that matters: it is a KEY, not a label. Sign-in
 * matches a manager to their team on it, and the Monday home-address reminder
 * decides who is chased (and who is copied) by it. Ported from Clippa, where a
 * pasted trailing space would have silently detached a manager.
 */
function tidy(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const denied = await refuseEdit("teams");
  if (denied) return denied;

  try {
    const body = await request.json();
    const teams = await getTeams();
    const newTeam: Team = {
      id: crypto.randomUUID(),
      name: tidy(body.name),
      managerId: tidy(body.managerId),
      managerName: tidy(body.managerName),
      managerEmail: tidy(body.managerEmail),
      managerCell: tidy(body.managerCell),
      area: tidy(body.area),
    };
    teams.push(newTeam);
    await saveTeams(teams);

    const session = await getSession();
    logActivity({ action: "Created team", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created team ${newTeam.name}` });

    return NextResponse.json(newTeam, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await refuseEdit("teams");
  if (denied) return denied;

  try {
    const body = await request.json();
    const { id, ...updates } = body as Partial<Team> & { id: string };
    const teams = await getTeams();
    const idx = teams.findIndex((t) => t.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Trim what was sent, not the whole record: a field the caller did not
    // mention must stay exactly as it was, which is what Object.assign gives.
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === "string") (updates as Record<string, unknown>)[key] = value.trim();
    }
    Object.assign(teams[idx], updates);
    await saveTeams(teams);

    const session = await getSession();
    logActivity({ action: "Updated team", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated team ${teams[idx].name}` });

    return NextResponse.json(teams[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await refuseEdit("teams");
  if (denied) return denied;

  try {
    const { id } = await request.json();
    const teams = await getTeams();
    const target = teams.find((t) => t.id === id);
    const filtered = teams.filter((t) => t.id !== id);
    await saveTeams(filtered);

    const session = await getSession();
    logActivity({ action: "Deleted team", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Deleted team ${target?.name || id}` });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
