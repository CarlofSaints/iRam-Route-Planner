import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, saveChannels, getReps, saveReps, getStoreOverrides } from "@/lib/data";
import { overriddenStoreIds } from "@/lib/channelDefaults";
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
    /**
     * Channels are matched on a normalised name, not the literal string.
     *
     * An exact match meant "MAKRO", "Makro" and "makro" were three different
     * channels, and an unrecognised name is silently CREATED — so one
     * inconsistent capitalisation in a spreadsheet quietly forked a channel,
     * and every store on that row inherited the new channel's blank defaults
     * instead of the real one's.
     */
    const channelKey = (name: string) => name.trim().toLowerCase();
    const channelMap = new Map<string, Channel>();
    for (const c of existingChannels) {
      // First one wins if two channels already differ only by case. This
      // lookup must never be what decides one of them no longer exists.
      if (!channelMap.has(channelKey(c.name))) channelMap.set(channelKey(c.name), c);
    }
    // Saved separately from the lookup, so a case-duplicate that the map had to
    // drop is still written back rather than deleted.
    const channelsToSave: Channel[] = [...existingChannels];
    const repMap = new Map(existingReps.map((r) => [r.code, r]));
    const pinnedStoreIds = overriddenStoreIds(await getStoreOverrides());

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

    // Does this sheet carry the optional secondary/third rep columns at all?
    // Used to distinguish "blank cell, clear the rep" from "column absent,
    // leave whatever is already on the store alone".
    const hasHeader = (...names: string[]) =>
      fileHeaders.some((h) => names.some((n) => h.toLowerCase() === n.toLowerCase()));
    const hasRep2Column = hasHeader("SECONDARY REPRESENTATIVE ID", "REP CODE 2", "REPRESENTATIVE ID 2", "Secondary Rep Code");
    const hasRep3Column = hasHeader("THIRD REPRESENTATIVE ID", "REP CODE 3", "REPRESENTATIVE ID 3", "Third Rep Code");

    for (const row of rows) {
      let placeId: string, storeName: string, repCode: string, repName: string;
      let channelName: string, lat: string, lng: string, region: string;
      // Secondary/third reps are optional; blank for the vast majority of stores.
      let repCode2: string, repName2: string, repCode3: string, repName3: string;

      if (hasSiteExportFormat) {
        // Perigee site export format
        placeId = col(row, "ID");
        storeName = col(row, "Name");
        repCode = col(row, "Representative ID");
        repName = col(row, "Representative name");
        repCode2 = col(row, "Representative ID 2");
        repName2 = col(row, "Representative name 2");
        repCode3 = col(row, "Representative ID 3");
        repName3 = col(row, "Representative name 3");
        lat = col(row, "Gps latitude");
        lng = col(row, "Gps longitude");
        region = col(row, "State", "Territory");
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
        repCode2 = col(row, "SECONDARY REPRESENTATIVE ID", "REP CODE 2", "REPRESENTATIVE ID 2", "Secondary Rep Code");
        repName2 = col(row, "SECONDARY REPRESENTATIVE NAME", "REP NAME 2", "REPRESENTATIVE NAME 2", "Secondary Rep Name");
        repCode3 = col(row, "THIRD REPRESENTATIVE ID", "REP CODE 3", "REPRESENTATIVE ID 3", "Third Rep Code");
        repName3 = col(row, "THIRD REPRESENTATIVE NAME", "REP NAME 3", "REPRESENTATIVE NAME 3", "Third Rep Name");
        channelName = col(row, "CHANNEL", "Channel", "CHANNEL NAME", "Channel Name");
        lat = col(row, "GPS LATITUDE", "Gps latitude", "Gps Latitude", "GPS_LATITUDE", "Latitude");
        lng = col(row, "GPS LONGITUDE", "Gps longitude", "Gps Longitude", "GPS_LONGITUDE", "Longitude");
        // Province is only a stand-in for region on files that have no region
        // column at all — plenty of source files call the same thing either
        // name. On a sheet carrying BOTH (the Stores export does), they are two
        // different fields, and falling through would quietly write a store's
        // province into its region wherever the region happened to be blank.
        region = hasHeader("REGION", "Region", "AREA", "Area")
          ? col(row, "REGION", "Region", "AREA", "Area")
          : col(row, "PROVINCE", "Province");
      }

      if (!placeId || !storeName) { skippedRows++; continue; }

      // Auto-create channel
      if (channelName && !channelMap.has(channelKey(channelName))) {
        const ch: Channel = {
          id: channelName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name: channelName,
          frequency: "monthly",
          duration: 30,
        };
        channelMap.set(channelKey(channelName), ch);
        channelsToSave.push(ch);
      }

      // Auto-create reps — primary plus any secondary/third on the row
      for (const [code, name] of [
        [repCode, repName],
        [repCode2, repName2],
        [repCode3, repName3],
      ] as const) {
        if (code && !repMap.has(code)) {
          const r: Rep = {
            id: crypto.randomUUID(),
            code,
            name,
            email: "",
            cell: "",
            homeAddress: "",
            homeGpsLat: "",
            homeGpsLng: "",
            teamId: "",
          };
          repMap.set(code, r);
        }
      }

      const channel = channelName ? channelMap.get(channelKey(channelName)) : undefined;
      const channelId = channel?.id || "";

      if (storeMap.has(placeId)) {
        // Update existing store
        const existing = storeMap.get(placeId)!;
        existing.name = storeName;
        // A store that moves to a different channel takes that channel's
        // defaults with it, unless a manager has pinned it with an override.
        const movedChannel = existing.channelId !== channelId;
        existing.channelId = channelId;
        if (movedChannel && channel && !pinnedStoreIds.has(existing.id)) {
          existing.frequency = channel.frequency;
          existing.duration = channel.duration;
        }
        existing.repCode = repCode;
        // Only overwrite the extra reps when the file actually carries those
        // columns — an upload from a single-rep sheet must not silently clear
        // secondaries set elsewhere.
        if (hasRep2Column) existing.repCode2 = repCode2 || undefined;
        if (hasRep3Column) existing.repCode3 = repCode3 || undefined;
        existing.gpsLat = lat;
        existing.gpsLng = lng;
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
          ...(repCode2 ? { repCode2 } : {}),
          ...(repCode3 ? { repCode3 } : {}),
          gpsLat: lat,
          gpsLng: lng,
          // iRam does not track store sales, so nothing reads or displays this
          // any more. Kept at 0 to satisfy the stored shape rather than dropped
          // from the type, so re-enabling it is a UI change and not a migration.
          monthlySales: 0,
          // Inherit the channel's defaults. These used to be hardcoded to
          // monthly/30, so every uploaded store ignored its channel's settings
          // from the moment it was created.
          frequency: channel?.frequency ?? "monthly",
          duration: channel?.duration ?? 30,
          dayOfWeek: "",
          weekNumber: "",
          ...(region ? { region } : {}),
        });
        newCount++;
      }
    }

    await saveChannels(channelsToSave);
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
