import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, saveRoutes, saveRoutesForType, getRoutes, getRoutesForType, getCallCycleTypes, getSettings, getVisitRoles, getChannels } from "@/lib/data";
import { RoutePlanDocument, RepRoutePlan } from "@/lib/types";
import { generateRepRoute } from "@/lib/route-engine";
import { getStoresForRep, getRoleForRep } from "@/lib/repStores";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { getSession } from "@/lib/auth";
import { canChangeRoutes } from "@/lib/routeAccess";
import { logActivity } from "@/lib/activityLog";
import { countRoadRouting } from "@/lib/roadRouting";

/** Only the two counted facts are stored; the rest of the summary is derived. */
const storedRoadRouting = (plans: RepRoutePlan[]) => {
  const { eligibleDays, roadRoutedDays } = countRoadRouting(plans);
  return { eligibleDays, roadRoutedDays };
};

// 300s, the Vercel Pro default ceiling (the plan maximum is 800). A generation
// is almost entirely waiting on Google, and Fluid compute pauses active-CPU
// billing during I/O, so the headroom is close to free. The old 120 was the
// hard stop that truncated every bulk run.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    // The route had no authorisation of its own — a hidden button was the only
    // thing stopping a viewer from regenerating everyone's routes.
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Admins only, in code rather than the Roles grid: the grid only backfills
    // MISSING roles, so a permission ticked there once can never be taken back
    // by changing the defaults. Generating rewrites every rep's week and spends
    // the Google Directions budget.
    if (!canChangeRoutes(session)) {
      return NextResponse.json({ error: "Only an admin can generate routes." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const repCodes: string[] | undefined = body.repCodes;

    const [allReps, allStores, callCycleTypes, settings, visitRoles, allChannels] = await Promise.all([
      getReps(),
      getStores(),
      getCallCycleTypes(),
      getSettings(),
      getVisitRoles(),
      getChannels(),
    ]);
    const outlierRadiusKm = settings.outlierRadiusKm;

    // How many calls a day this run should aim for.
    //
    // The body wins over the saved setting so the Routes page can preview a
    // number BEFORE anyone commits to it: the manager sets 8, one rep is
    // rebuilt at 8, and the setting is only written when they apply it to
    // everybody. Sending `null` explicitly asks for no target at all, which is
    // different from sending nothing and inheriting the saved one.
    const callsPerDay =
      body.callsPerDay === null
        ? undefined
        : body.callsPerDay !== undefined
          ? clampCallsPerDay(body.callsPerDay)
          : settings.callsPerDay;

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

    /**
     * Budget for Google Directions calls: now a SAFETY VALVE, not a cap.
     *
     * With the calls running six at a time a full book of several hundred
     * days takes well under a minute, so this should never be reached. It
     * stays because when the budget runs out the engine draws straight lines,
     * and on Clippa that left most reps with understated distances for weeks.
     * The plan now records how many days got a road route (roadRouting), and
     * the Routes page says so, but a valve that never trips is still the point.
     *
     * 240s inside a 300s function leaves a minute to assemble and save the
     * document even in the worst case.
     */
    const googleDeadline = Date.now() + 240_000;

    for (const rep of reps) {
      // Stores for this rep: their visit role decides whether that means the
      // stores they are primary on, or the ones they QC/train at.
      const role = getRoleForRep(rep, visitRoles);
      const repStores = getStoresForRep(rep, allStores, role, strategy, allChannels);
      if (repStores.length === 0) {
        repPlans.push({
          repCode: rep.code,
          repName: rep.name,
          visitRoleId: role.id,
          visitRoleName: role.name,
          homeLatLng: parseHome(rep),
          workingHoursPerDay: rep.workingHoursPerDay ?? 8.5,
          // A rep with no stores still carries the target, so the Map dropdown
          // does not show a blank beside them and read as "not set".
          callsPerDay: callsPerDay && callsPerDay > 0 ? callsPerDay : undefined,
          generatedAt: new Date().toISOString(),
          days: [],
          stats: { totalStores: 0, unassignedStores: [] },
        });
        continue;
      }

      const plan = await generateRepRoute(
        rep,
        repStores,
        startTime,
        googleDeadline,
        outlierRadiusKm,
        callsPerDay
      );
      repPlans.push({ ...plan, visitRoleId: role.id, visitRoleName: role.name });
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
        // Stamped on the plan, so a page can say what THIS week was built with
        // rather than reading a setting that may have moved since.
        callsPerDay,
      },
      roadRouting: storedRoadRouting(repPlans),
    };

    // A run for SOME reps must not replace the plan for all of them.
    //
    // Previewing one rep at a new calls-per-day writes a document holding that
    // one rep. Saving it as-is would delete every other rep's week, and the
    // only sign would be an almost-empty Routes page. So a partial run merges
    // its reps into the plan already saved, and only a full run replaces it.
    if (repCodes && repCodes.length > 0) {
      const existing = activeType ? await getRoutesForType(activeType.id) : await getRoutes();
      if (existing) {
        const touched = new Set(repPlans.map((p) => p.repCode));
        doc.repPlans = [
          ...existing.repPlans.filter((p) => !touched.has(p.repCode)),
          ...repPlans,
        ];
        // The document still describes the plan as a whole, and most of it was
        // built with the OLD target. Claiming the new one would misdescribe
        // every week this run did not touch.
        doc.config.callsPerDay = existing.config?.callsPerDay;
        doc.generatedAt = existing.generatedAt;
        // Recounted over the MERGED set. Counting only this run's reps would
        // report "20 of 20 road-routed" on a document whose other weeks are
        // straight lines: the reassuring version of the exact problem this
        // field exists to expose.
        doc.roadRouting = storedRoadRouting(doc.repPlans);
      }
    }

    // Save per-type (if active type exists) + latest snapshot
    if (activeType) {
      await saveRoutesForType(activeType.id, doc);
    }
    await saveRoutes(doc);

    logActivity({
      action: "Generated routes",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary:
        `Generated routes for ${repPlans.length} rep${repPlans.length === 1 ? "" : "s"}` +
        (activeType ? ` (${activeType.name})` : "") +
        (callsPerDay ? ` at ${callsPerDay} calls per day` : ""),
    });

    return NextResponse.json(doc);
  } catch (err) {
    console.error("Route generation failed:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

/**
 * A calls-per-day value we are willing to act on.
 *
 * Anything unusable becomes undefined, which means "no target" and returns day
 * sizing to the clock. It does NOT fall back to a number: a typo silently
 * becoming 8 would redraw every rep's week and look like the app decided on its
 * own.
 */
function clampCallsPerDay(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(Math.round(n), 30);
}

function parseHome(rep: { homeGpsLat: string; homeGpsLng: string }) {
  const lat = parseFloat(rep.homeGpsLat);
  const lng = parseFloat(rep.homeGpsLng);
  return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
}
