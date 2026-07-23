import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getChannels, getSettings } from "@/lib/data";
import { computeOutliers } from "@/lib/outliers";
import { requireSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const param = request.nextUrl.searchParams.get("radiusKm");
    const [reps, stores, channels, settings] = await Promise.all([
      getReps(),
      getStores(),
      getChannels(),
      getSettings(),
    ]);

    const parsed = param != null ? Number(param) : NaN;
    const radiusKm = !isNaN(parsed) && parsed > 0 ? Math.round(parsed) : settings.outlierRadiusKm;

    const result = computeOutliers(reps, stores, radiusKm);
    const channelName = new Map(channels.map((c) => [c.id, c.name]));
    const storeById = new Map(stores.map((s) => [s.id, s]));

    // South Africa bounding box — coords outside it are clearly wrong.
    const outsideSA = (lat: number, lng: number) =>
      lat < -35 || lat > -22 || lng < 16 || lng > 33;

    const enriched = result.stores.map((s) => {
      const st = storeById.get(s.storeId);
      const lat = parseFloat(st?.gpsLat ?? "");
      const lng = parseFloat(st?.gpsLng ?? "");
      const valid = !isNaN(lat) && !isNaN(lng);
      return {
        ...s,
        channel: channelName.get(s.channelId) || s.channelId || "",
        province: (st?.province || "").trim(),
        gpsLat: st?.gpsLat ?? "",
        gpsLng: st?.gpsLng ?? "",
        outsideSA: valid ? outsideSA(lat, lng) : false,
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
