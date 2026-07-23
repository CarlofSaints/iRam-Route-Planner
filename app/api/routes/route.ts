import { NextRequest, NextResponse } from "next/server";
import { getRoutes, getRoutesForType, saveRoutes } from "@/lib/data";
import { RoutePlanDocument } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET(request: NextRequest) {
  try {
    const typeId = request.nextUrl.searchParams.get("typeId");
    const routes = typeId
      ? await getRoutesForType(typeId)
      : await getRoutes();
    return NextResponse.json(routes);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as RoutePlanDocument;
    await saveRoutes(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await saveRoutes(null);

    const session = await getSession();
    logActivity({ action: "Deleted routes", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: "Cleared all routes" });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
