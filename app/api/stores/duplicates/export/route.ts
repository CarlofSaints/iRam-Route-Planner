import { NextResponse } from "next/server";
import { getStores, getChannels, getReps } from "@/lib/data";
import { buildDuplicateGroups } from "@/lib/duplicates";
import { resolveLocations, geoKey } from "@/lib/geocode";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export const maxDuration = 120;

const isOutsideSA = (lat: number, lng: number) =>
  lat < -35 || lat > -22 || lng < 16 || lng > 33;

export async function GET() {
  try {
    await requireSession();

    const [stores, channels, reps] = await Promise.all([getStores(), getChannels(), getReps()]);
    const channelName = new Map(channels.map((c) => [c.id, c.name]));
    const repName = new Map(reps.map((r) => [r.code, r.name]));
    const storeById = new Map(stores.map((s) => [s.id, s]));
    const { groups } = buildDuplicateGroups(stores);

    // Geocode the coordinates that need a real place name (outside SA, or no
    // stored province) so the client can see where a wrong coordinate points.
    const toGeocode: { lat: number; lng: number }[] = [];
    for (const g of groups) {
      for (const r of g.records) {
        const st = storeById.get(r.id);
        const lat = parseFloat(r.gpsLat);
        const lng = parseFloat(r.gpsLng);
        if (isNaN(lat) || isNaN(lng)) continue;
        if (isOutsideSA(lat, lng) || !(st?.province || "").trim()) {
          toGeocode.push({ lat, lng });
        }
      }
    }
    const places = await resolveLocations(toGeocode);

    const rows: (string | number)[][] = [
      [
        "Store Name", "Rep Code", "Rep Name", "Place ID", "Channel", "Frequency",
        "Status", "Duplicate Count", "Latitude", "Longitude",
        "Province (stored)", "Geocoded Location", "Outside SA",
      ],
    ];

    for (const g of groups) {
      for (const r of g.records) {
        const st = storeById.get(r.id);
        const lat = parseFloat(r.gpsLat);
        const lng = parseFloat(r.gpsLng);
        const valid = !isNaN(lat) && !isNaN(lng);
        const outside = valid && isOutsideSA(lat, lng);
        const geocoded = valid ? (places.get(geoKey(lat, lng)) || "") : "";
        rows.push([
          g.storeName,
          g.repCode,
          repName.get(g.repCode) || "",
          r.placeId,
          channelName.get(r.channelId) || r.channelId || "",
          st?.frequency || "",
          r.keep ? "KEEP" : "REMOVE",
          g.records.length,
          r.gpsLat,
          r.gpsLng,
          (st?.province || "").trim(),
          geocoded,
          outside ? "Yes" : "",
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 36 }, { wch: 10 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 },
      { wch: 9 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 32 }, { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Duplicate Stores");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Duplicate_Stores_${date}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Duplicate export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
