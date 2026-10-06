import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getChannels, getSettings, getVisitRoles } from "@/lib/data";
import { computeOutliers } from "@/lib/outliers";
import { requireSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const param = request.nextUrl.searchParams.get("radiusKm");
    const [reps, stores, channels, settings, visitRoles] = await Promise.all([
      getReps(),
      getStores(),
      getChannels(),
      getSettings(),
      getVisitRoles(),
    ]);

    const parsed = param != null ? Number(param) : NaN;
    const radiusKm = !isNaN(parsed) && parsed > 0 ? Math.round(parsed) : settings.outlierRadiusKm;

    const result = computeOutliers(reps, stores, radiusKm, visitRoles, channels);
    const channelName = new Map(channels.map((c) => [c.id, c.name]));
    const storeById = new Map(stores.map((s) => [s.id, s]));

    const enriched = result.stores.map((s) => {
      const st = storeById.get(s.storeId);
      return {
        ...s,
        channel: channelName.get(s.channelId) || s.channelId || "",
        province: (st?.province || "").trim(),
        gpsLat: st?.gpsLat ?? "",
        gpsLng: st?.gpsLng ?? "",
        // One definition of "outside South Africa" (lib/saCoordinates), the
        // same one the route engine refuses to route, rather than a second
        // bounding box here that could disagree with it.
        outsideSA: s.foreignCoordinate,
      };
    });

    return NextResponse.json({ ...result, stores: enriched });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Outliers error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
