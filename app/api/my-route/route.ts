import { NextResponse } from "next/server";
import { getRoutes, getStores, getVisitRoles } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { resolveOwnRep } from "@/lib/ownRep";
import { parseRepHome } from "@/lib/saCoordinates";
import { getRoleForRep } from "@/lib/repStores";
import { plansForRep, shapePlan, storesForRepAnyRole } from "@/lib/myRoute";

export const dynamic = "force-dynamic";

/**
 * The signed-in rep's OWN route, and nothing else.
 *
 * 🔴 Reps are not let into /routes or /map: the APIs behind those hand back
 * every rep's route book and every store to any valid session. This route is
 * the narrow door instead. The rep is resolved from the session on the server,
 * never from a query or body, so there is no parameter a rep could change to
 * read somebody else's week.
 *
 * Only the fields the page draws leave the server: stop names, positions and
 * times, and the names of the stores the rep holds a visit role at. No sales,
 * no other rep.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const rep = await resolveOwnRep(session);
    if (!rep) return NextResponse.json({ rep: null, plans: [], stores: [] });

    const [doc, stores, visitRoles] = await Promise.all([getRoutes(), getStores(), getVisitRoles()]);
    const ownRole = getRoleForRep(rep, visitRoles);

    const plans = plansForRep(doc, rep.code).map((p) => shapePlan(p, ownRole.name));
    const plannedIds = new Set(plans.flatMap((p) => p.days.flatMap((d) => d.stops.map((s) => s.storeId))));

    // The home the rep has NOW, which can differ from the one the plan was
    // built on. The page says so rather than quietly drawing the old anchor.
    const currentHome = parseRepHome(rep.homeGpsLat, rep.homeGpsLng);

    return NextResponse.json(
      {
        rep: { code: rep.code, name: rep.name, hasHome: !!currentHome, roleName: ownRole.name },
        generatedAt: doc?.generatedAt ?? null,
        plans,
        stores: storesForRepAnyRole(stores, rep.code, ownRole.name, visitRoles, plannedIds),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
