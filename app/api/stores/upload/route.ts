import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, saveChannels, getReps, saveReps } from "@/lib/data";
import { Store, Channel, Rep } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);

    // Load existing data
    const existingChannels = await getChannels();
    const existingReps = await getReps();
    const existingStores = await getStores();
    const channelMap = new Map(existingChannels.map((c) => [c.name, c]));
    const repMap = new Map(existingReps.map((r) => [r.code, r]));

    // Index existing stores by placeId for merge
    const storeMap = new Map(existingStores.map((s) => [s.placeId, s]));
    let newCount = 0;
    let updatedCount = 0;

    // Helper: try multiple header names, return first match (case-insensitive, trimmed)
    const col = (row: Record<string, string | number>, ...keys: string[]) => {
      const trimmedEntries = Object.entries(row).map(([k, v]) => [k.trim(), v] as const);
      for (const k of keys) {
        const kLower = k.toLowerCase();
        const entry = trimmedEntries.find(([tk]) => tk.toLowerCase() === kLower);
        if (entry !== undefined && entry[1] !== undefined && entry[1] !== "") {
          return String(entry[1]).trim();
        }
      }
      return "";
    };

    // Detect file headers for diagnostics
    const fileHeaders = rows.length > 0 ? Object.keys(rows[0]).map((h) => h.trim()) : [];
    let skippedRows = 0;

    // Detect format: a site export with "ID" + "Name" + "Representative ID" columns
    // (Tags is optional — some exports omit it). NOTE: these headers came from the
    // Repsly Places export; confirm them against a real Perigee site export.
    const hasSiteExportFormat = fileHeaders.some((h) => h === "ID") &&
      fileHeaders.some((h) => h === "Name") &&
      fileHeaders.some((h) => h === "Representative ID");

    for (const row of rows) {
      let placeId: string, storeName: string, repCode: string, repName: string;
      let channelName: string, lat: string, lng: string, region: string;
      let rawSales: string;

      if (hasSiteExportFormat) {
        // Perigee site export format
        placeId = col(row, "ID");
        storeName = col(row, "Name");
        repCode = col(row, "Representative ID");
        repName = col(row, "Representative name");
        lat = col(row, "Gps latitude");
        lng = col(row, "Gps longitude");
        region = col(row, "State", "Territory");
        rawSales = "";
        // Channel from Tags: "INDEPENDENT','GAUTENG" → first tag = channel
        const tags = col(row, "Tags");
        const tagParts = tags.split(/[',]+/).map((t) => t.trim()).filter(Boolean);
        channelName = tagParts[0] || "";
      } else {
        // Original format
        placeId = col(row, "PLACE ID", "STORE ID", "Store ID", "Place ID");
        storeName = col(row, "PLACE NAME", "STORE NAME", "Store Name", "Place Name");
        repCode = col(row, "REPRESENTATIVE ID", "REP CODE", "Rep Code", "Representative ID");
        repName = col(row, "REPRESENTATIVE NAME", "REP NAME", "Rep Name", "Representative Name");
        channelName = col(row, "CHANNEL", "Channel", "CHANNEL NAME", "Channel Name");
        lat = col(row, "GPS LATITUDE", "Gps latitude", "Gps Latitude", "GPS_LATITUDE", "Latitude");
        lng = col(row, "GPS LONGITUDE", "Gps longitude", "Gps Longitude", "GPS_LONGITUDE", "Longitude");
        rawSales = col(row, "MONTHLY AVERAGE", "VALUE", "Value", "Monthly Average", "Sales");
        region = col(row, "REGION", "Region", "PROVINCE", "Province", "AREA", "Area");
      }

      const sales = Number((rawSales || "").replace(/[^0-9.\-]/g, "") || 0);

      if (!placeId || !storeName) { skippedRows++; continue; }

      // Auto-create channel
      if (channelName && !channelMap.has(channelName)) {
        const ch: Channel = {
          id: channelName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name: channelName,
          frequency: "monthly",
          duration: 30,
        };
        channelMap.set(channelName, ch);
      }

      // Auto-create rep
      if (repCode && !repMap.has(repCode)) {
        const r: Rep = {
          id: crypto.randomUUID(),
          code: repCode,
          name: repName,
          email: "",
          cell: "",
          homeAddress: "",
          homeGpsLat: "",
          homeGpsLng: "",
          teamId: "",
        };
        repMap.set(repCode, r);
      }

      const channelId = channelMap.get(channelName)?.id || "";

      if (storeMap.has(placeId)) {
        // Update existing store
        const existing = storeMap.get(placeId)!;
        existing.name = storeName;
        existing.channelId = channelId;
        existing.repCode = repCode;
        existing.gpsLat = lat;
        existing.gpsLng = lng;
        existing.monthlySales = sales;
        if (region) existing.region = region;
        updatedCount++;
      } else {
        // Add new store
        storeMap.set(placeId, {
          id: placeId,
          placeId,
          name: storeName,
          channelId,
          repCode,
          gpsLat: lat,
          gpsLng: lng,
          monthlySales: sales,
          frequency: "monthly",
          duration: 30,
          dayOfWeek: "",
          weekNumber: "",
          ...(region ? { region } : {}),
        });
        newCount++;
      }
    }

    await saveChannels(Array.from(channelMap.values()));
    await saveReps(Array.from(repMap.values()));
    await saveStores(Array.from(storeMap.values()));

    const session = await getSession();
    logActivity({ action: "Uploaded stores", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Uploaded ${file.name}: ${newCount} added, ${updatedCount} updated (${storeMap.size} total)` });

    return NextResponse.json({
      ok: true,
      added: newCount,
      updated: updatedCount,
      total: storeMap.size,
      channels: channelMap.size,
      reps: repMap.size,
      rowsInFile: rows.length,
      skippedRows,
      fileHeaders,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
