import { NextRequest, NextResponse } from "next/server";
import { getCallCycleTypes, saveCallCycleTypes } from "@/lib/data";
import { CallCycleType, CallCycleStrategy } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET() {
  try {
    const types = await getCallCycleTypes();
    return NextResponse.json(types);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, strategy, description } = body as {
      name: string;
      strategy: CallCycleStrategy;
      description?: string;
    };

    if (!name || !strategy) {
      return NextResponse.json({ error: "Name and strategy are required" }, { status: 400 });
    }

    const types = await getCallCycleTypes();

    // Prevent duplicate strategies
    if (types.some((t) => t.strategy === strategy)) {
      return NextResponse.json({ error: `A call cycle type with strategy "${strategy}" already exists` }, { status: 409 });
    }

    const newType: CallCycleType = {
      id: `cct-${Date.now()}`,
      name,
      strategy,
      description: description || "",
      active: false,
    };

    types.push(newType);
    await saveCallCycleTypes(types);

    const session = await getSession();
    logActivity({ action: "Created call cycle type", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created call cycle type ${newType.name} (${newType.strategy})` });

    return NextResponse.json(newType, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, active } = body as Partial<CallCycleType> & { id: string };

    const types = await getCallCycleTypes();
    const idx = types.findIndex((t) => t.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (name !== undefined) types[idx].name = name;
    if (description !== undefined) types[idx].description = description;

    // Setting active: deactivate all others first
    if (active === true) {
      for (const t of types) t.active = false;
      types[idx].active = true;
    } else if (active === false) {
      types[idx].active = false;
    }

    await saveCallCycleTypes(types);

    const session = await getSession();
    logActivity({ action: "Updated call cycle type", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated call cycle type ${types[idx].name}${active === true ? " (set active)" : ""}` });

    return NextResponse.json(types);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body as { id: string };

    const types = await getCallCycleTypes();
    const target = types.find((t) => t.id === id);
    const filtered = types.filter((t) => t.id !== id);

    if (filtered.length === types.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await saveCallCycleTypes(filtered);

    const session = await getSession();
    logActivity({ action: "Deleted call cycle type", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Deleted call cycle type ${target?.name || id}` });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
