import { NextRequest, NextResponse } from "next/server";
import { getRoutes, getRoutesForType, saveRoutes, getReps } from "@/lib/data";
import { RoutePlanDocument } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { canChangeRoutes, scopeRouteDoc, visibleRepCodes } from "@/lib/routeAccess";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const forbidden = () =>
  NextResponse.json({ error: "Only an admin can change routes." }, { status: 403 });

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const typeId = request.nextUrl.searchParams.get("typeId");
    const [routes, reps] = await Promise.all([
      typeId ? getRoutesForType(typeId) : getRoutes(),
      getReps(),
    ]);
    // Scoped on the server: a team manager gets their team's weeks, never the book.
    return NextResponse.json(scopeRouteDoc(routes, visibleRepCodes(session, reps)));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (!canChangeRoutes(session)) return forbidden();

    const body = (await request.json()) as RoutePlanDocument;
    await saveRoutes(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (!canChangeRoutes(session)) return forbidden();

    await saveRoutes(null);

    logActivity({ action: "Deleted routes", actor: session.email, actorName: session.name, summary: "Cleared all routes" });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
