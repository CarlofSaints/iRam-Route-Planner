import { NextRequest, NextResponse } from "next/server";
import { getRegions, saveRegions } from "@/lib/data";
import { requireAdmin, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { Region } from "@/lib/types";

export async function GET() {
  try {
    const regions = await getRegions();
    return NextResponse.json(regions);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();
    const { name } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "Region name is required" }, { status: 400 });
    }
    const regions = await getRegions();
    if (regions.some((r) => r.name.toLowerCase() === name.trim().toLowerCase())) {
      return NextResponse.json({ error: "Region already exists" }, { status: 400 });
    }
    const region: Region = {
      id: `reg_${Date.now()}`,
      name: name.trim(),
    };
    regions.push(region);
    regions.sort((a, b) => a.name.localeCompare(b.name));
    await saveRegions(regions);

    const session = await getSession();
    logActivity({ action: "Created region", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created region ${region.name}` });

    return NextResponse.json(region);
  } catch (err) {
    if (String(err).includes("Unauthorized"))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();
    const { id, name } = body;
    if (!id || !name?.trim()) {
      return NextResponse.json({ error: "ID and name required" }, { status: 400 });
    }
    const regions = await getRegions();
    const idx = regions.findIndex((r) => r.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }
    const dup = regions.find((r) => r.id !== id && r.name.toLowerCase() === name.trim().toLowerCase());
    if (dup) {
      return NextResponse.json({ error: "Region name already exists" }, { status: 400 });
    }
    regions[idx].name = name.trim();
    regions.sort((a, b) => a.name.localeCompare(b.name));
    await saveRegions(regions);

    const session = await getSession();
    logActivity({ action: "Updated region", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated region ${regions[idx].name}` });

    return NextResponse.json(regions[idx]);
  } catch (err) {
    if (String(err).includes("Unauthorized"))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }
    const regions = await getRegions();
    const target = regions.find((r) => r.id === id);
    const filtered = regions.filter((r) => r.id !== id);
    if (filtered.length === regions.length) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }
    await saveRegions(filtered);

    const session = await getSession();
    logActivity({ action: "Deleted region", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Deleted region ${target?.name || id}` });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).includes("Unauthorized"))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
