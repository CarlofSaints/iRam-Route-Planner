import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, saveRoutes, saveRoutesForType, getCallCycleTypes, getSettings } from "@/lib/data";
import { RoutePlanDocument, RepRoutePlan, Store, Rep } from "@/lib/types";
import { generateRepRoute } from "@/lib/route-engine";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export const maxDuration = 120;

function getStoresForRep(
  rep: Rep,
  allStores: Store[],
  strategy: string | null
): Store[] {
  // A rep's stores are the stores allocated to them (repCode). This is the
  // source of truth for "which stores does this rep call on". The route engine
  // then clusters them geographically and optimises the daily order.
  const allocated = allStores.filter((s) => s.repCode === rep.code);

  // Channel Dedicated additionally narrows the allocation to the rep's channels.
  if (strategy === "channel_dedicated" && rep.assignedChannels?.length) {
    return allocated.filter((s) => rep.assignedChannels!.includes(s.channelId));
  }

  // Geography / default: the rep calls on every store allocated to them.
  return allocated;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const repCodes: string[] | undefined = body.repCodes;

    const [allReps, allStores, callCycleTypes, settings] = await Promise.all([
      getReps(),
      getStores(),
      getCallCycleTypes(),
      getSettings(),
    ]);
    const outlierRadiusKm = settings.outlierRadiusKm;

    // Determine strategy: prefer explicit typeId from request, fall back to globally active type
    const resolvedType = body.typeId
      ? callCycleTypes.find((t) => t.id === body.typeId)
      : callCycleTypes.find((t) => t.active);
    const activeType = resolvedType;
    const strategy = activeType?.strategy || null;

    // Filter reps if specific codes requested
    const reps = repCodes
      ? allReps.filter((r) => repCodes.includes(r.code))
      : allReps;

    if (reps.length === 0) {
      return NextResponse.json(
        { error: "No reps found" },
        { status: 400 }
      );
    }

    const startTime = body.startTime || "08:00";
    const repPlans: RepRoutePlan[] = [];

    // Budget for Google Directions calls. Generating for a single rep gets the
    // full budget (fast, all days road-optimised); a bulk all-reps run uses
    // Google until the budget is spent, then falls back to Haversine so the
    // request always completes well within the function timeout.
    const googleDeadline = Date.now() + (reps.length === 1 ? 55_000 : 45_000);

    for (const rep of reps) {
      // Get stores for this rep based on active strategy
      const repStores = getStoresForRep(rep, allStores, strategy);
      if (repStores.length === 0) {
        repPlans.push({
          repCode: rep.code,
          repName: rep.name,
          homeLatLng: parseHome(rep),
          workingHoursPerDay: rep.workingHoursPerDay ?? 8.5,
          generatedAt: new Date().toISOString(),
          days: [],
          stats: { totalStores: 0, unassignedStores: [] },
        });
        continue;
      }

      const plan = await generateRepRoute(rep, repStores, startTime, googleDeadline, outlierRadiusKm);
      repPlans.push(plan);
    }

    const doc: RoutePlanDocument = {
      id: crypto.randomUUID(),
      generatedAt: new Date().toISOString(),
      generatedBy: "admin",
      callCycleTypeId: activeType?.id,
      callCycleTypeName: activeType?.name,
      repPlans,
      config: {
        useGoogleMaps: hasGoogleMapsKey(),
        defaultStartTime: startTime,
      },
    };

    // Save per-type (if active type exists) + latest snapshot
    if (activeType) {
      await saveRoutesForType(activeType.id, doc);
    }
    await saveRoutes(doc);

    const session = await getSession();
    logActivity({ action: "Generated routes", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Generated routes for ${repPlans.length} reps${activeType ? ` (${activeType.name})` : ""}` });

    return NextResponse.json(doc);
  } catch (err) {
    console.error("Route generation failed:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

function parseHome(rep: { homeGpsLat: string; homeGpsLng: string }) {
  const lat = parseFloat(rep.homeGpsLat);
  const lng = parseFloat(rep.homeGpsLng);
  return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
}
