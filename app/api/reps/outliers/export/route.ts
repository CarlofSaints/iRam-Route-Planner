import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getChannels, getSettings } from "@/lib/data";
import { computeOutliers } from "@/lib/outliers";
import { resolveLocations, geoKey } from "@/lib/geocode";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export const maxDuration = 120;

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

    const outsideSA = (latS: string, lngS: string) => {
      const lat = parseFloat(latS), lng = parseFloat(lngS);
      if (isNaN(lat) || isNaN(lng)) return "";
      return lat < -35 || lat > -22 || lng < 16 || lng > 33 ? "Yes" : "";
    };

    // Reverse-geocode each outlier's real location so the client can fix the source.
    const toGeocode: { lat: number; lng: number }[] = [];
    for (const o of result.stores) {
      const st = storeById.get(o.storeId);
      const lat = parseFloat(st?.gpsLat ?? "");
      const lng = parseFloat(st?.gpsLng ?? "");
      if (!isNaN(lat) && !isNaN(lng)) toGeocode.push({ lat, lng });
    }
    const places = await resolveLocations(toGeocode);
    const geocodedFor = (latS: string, lngS: string) => {
      const lat = parseFloat(latS), lng = parseFloat(lngS);
      if (isNaN(lat) || isNaN(lng)) return "";
      return places.get(geoKey(lat, lng)) || "";
    };

    const rows: (string | number)[][] = [
      ["Rep Code", "Rep Name", "Store Name", "Store ID", "Channel", "Province", "Geocoded Location", "Outside SA", "Distance (km)", "Latitude", "Longitude"],
    ];
    for (const o of result.stores) {
      const st = storeById.get(o.storeId);
      rows.push([
        o.repCode,
        o.repName,
        o.storeName,
        o.storeId,
        channelName.get(o.channelId) || o.channelId || "",
        (st?.province || "").trim(),
        geocodedFor(st?.gpsLat ?? "", st?.gpsLng ?? ""),
        outsideSA(st?.gpsLat ?? "", st?.gpsLng ?? ""),
        o.distanceKm,
        st?.gpsLat ?? "",
        st?.gpsLng ?? "",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 24 }, { wch: 36 }, { wch: 22 }, { wch: 20 },
      { wch: 16 }, { wch: 32 }, { wch: 10 }, { wch: 13 }, { wch: 13 }, { wch: 13 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Out-of-range ${radiusKm}km`);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Out_Of_Range_Stores_${date}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Outliers export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
