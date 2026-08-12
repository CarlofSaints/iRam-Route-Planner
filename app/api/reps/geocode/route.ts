import { NextRequest, NextResponse } from "next/server";
import { getReps, saveReps } from "@/lib/data";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { geocodeAddress, isConfidentGeocode, hasGoogleMapsKey } from "@/lib/google-maps";

// A bulk sweep is one Google call per rep with an 80ms pause between them.
export const maxDuration = 60;

export interface GeocodeOutcome {
  repId: string;
  code: string;
  name: string;
  address: string;
  /** saved — written to the rep. review — geocoded but too vague to trust. failed — Google returned nothing. skipped — nothing to geocode. */
  status: "saved" | "review" | "failed" | "skipped";
  /** Always populated for saved/review so a human can judge the result. */
  reason: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

/**
 * Turn rep home addresses into the coordinates the route engine already looks
 * for. `route-engine.ts` anchors every day on `parseLatLng(homeGpsLat, homeGpsLng)`
 * and only falls back to the store centroid when that fails — so populating
 * these two fields is the whole feature.
 *
 * Confident results are written immediately. Vague ones are returned for review
 * and NOT saved: a suburb-centroid coordinate is indistinguishable from a real
 * one once it is in the record, and it would quietly relocate the rep's entire
 * week.
 *
 * Body: { repId } for one rep, or { all: true } to sweep every rep that has an
 * address but no GPS. { force: true } accepts a reviewed result as-is.
 */
export async function POST(request: NextRequest) {
  try {
    // This route writes rep records, so it needs the same permission as editing
    // one. The middleware only proves a valid session, not what that session
    // may change.
    const session = await requirePermission("manage_reps");

    if (!hasGoogleMapsKey()) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY is not set on this deployment, so addresses cannot be geocoded." },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { repId, all, force } = body as { repId?: string; all?: boolean; force?: boolean };

    const reps = await getReps();

    const targets = all
      ? reps.filter(
          (r) =>
            (r.homeAddress || "").trim() &&
            !((r.homeGpsLat || "").trim() && (r.homeGpsLng || "").trim())
        )
      : reps.filter((r) => r.id === repId);

    if (!all && targets.length === 0) {
      return NextResponse.json({ error: "Rep not found" }, { status: 404 });
    }

    const outcomes: GeocodeOutcome[] = [];
    let savedCount = 0;

    for (const rep of targets) {
      const address = (rep.homeAddress || "").trim();
      const base = { repId: rep.id, code: rep.code, name: rep.name, address };

      if (!address) {
        outcomes.push({ ...base, status: "skipped", reason: "No home address captured" });
        continue;
      }

      const g = await geocodeAddress(address);
      if (!g) {
        outcomes.push({
          ...base,
          status: "failed",
          reason: "Google could not find this address at all",
        });
        continue;
      }

      const confident = isConfidentGeocode(g);
      const detail = [
        `Google read it as "${g.formattedAddress}"`,
        g.partialMatch ? "only part of the address matched" : null,
        g.multipleMatches ? "more than one place matched" : null,
        `precision: ${g.locationType.replace(/_/g, " ").toLowerCase()}`,
      ]
        .filter(Boolean)
        .join(" · ");

      if (confident || force) {
        const idx = reps.findIndex((r) => r.id === rep.id);
        reps[idx].homeGpsLat = String(g.lat);
        reps[idx].homeGpsLng = String(g.lng);
        savedCount++;
        outcomes.push({
          ...base,
          status: "saved",
          reason: force && !confident ? `Accepted manually — ${detail}` : detail,
          lat: g.lat,
          lng: g.lng,
          formattedAddress: g.formattedAddress,
        });
      } else {
        outcomes.push({
          ...base,
          status: "review",
          reason: `Too vague to save automatically — ${detail}`,
          lat: g.lat,
          lng: g.lng,
          formattedAddress: g.formattedAddress,
        });
      }
    }

    if (savedCount > 0) {
      await saveReps(reps);
      logActivity({
        action: "Geocoded rep home addresses",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Set home GPS for ${savedCount} rep${savedCount === 1 ? "" : "s"} from their home address`,
      });
    }

    return NextResponse.json({
      considered: targets.length,
      saved: savedCount,
      needsReview: outcomes.filter((o) => o.status === "review").length,
      failed: outcomes.filter((o) => o.status === "failed").length,
      outcomes,
    });
  } catch (err) {
    // requirePermission throws "Forbidden"; returning it as a 500 would read as
    // "the feature is broken" rather than "you may not do this".
    const message = String(err);
    if (message.includes("Forbidden")) {
      return NextResponse.json(
        { error: "You do not have permission to change rep records." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
