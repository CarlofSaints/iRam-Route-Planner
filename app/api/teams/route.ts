import { NextRequest, NextResponse } from "next/server";
import { getTeams, saveTeams } from "@/lib/data";
import { Team } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET() {
  try {
    const teams = await getTeams();
    return NextResponse.json(teams);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const teams = await getTeams();
    const newTeam: Team = {
      id: crypto.randomUUID(),
      name: body.name || "",
      managerId: body.managerId || "",
      managerName: body.managerName || "",
      managerEmail: body.managerEmail || "",
      managerCell: body.managerCell || "",
      area: body.area || "",
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
  try {
    const body = await request.json();
    const { id, ...updates } = body as Partial<Team> & { id: string };
    const teams = await getTeams();
    const idx = teams.findIndex((t) => t.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
