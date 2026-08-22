import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, getStoreOverrides } from "@/lib/data";
import { overriddenStoreIds } from "@/lib/channelDefaults";
import { Channel, Store } from "@/lib/types";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import * as XLSX from "xlsx";

/**
 * Stores-only import — the return leg of the Stores page's Excel export.
 *
 * Deliberately NOT the same thing as /api/stores/upload. That route owns the
 * whole picture: it creates stores, creates channels, creates reps and writes
 * every rep column on the sheet. Sending it a file that carries no people
 * therefore does real damage — it assigns `existing.repCode = ""` on every row
 * it touches, silently unassigning the estate.
 *
 * This route reads the store-owned fields and nothing else. It never reads a
 * rep code, never touches `roleReps`, never creates a rep, and never creates a
 * store. Its whole reason to exist is that someone can export the grid, fix a
 * column of GPS coordinates in Excel and send the file straight back without
 * needing the personnel columns to be correct — or present at all.
 */

/** The fields this route is allowed to write. Everything else is out of scope. */
const IMPORTABLE = ["PLACE NAME", "CHANNEL", "PROVINCE", "REGION", "GPS LATITUDE", "GPS LONGITUDE"];

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission("upload_stores");

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    // The export writes Stores + Notes. Prefer the named sheet so a file whose
    // sheets were reordered in Excel still imports the right one.
    const sheetName =
      wb.SheetNames.find((n) => n.trim().toLowerCase() === "stores") || wb.SheetNames[0];
    const ws = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!ws) return NextResponse.json({ error: "That workbook has no sheets" }, { status: 400 });
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: `Sheet "${sheetName}" has no rows below the header` },
        { status: 400 }
      );
    }

    const fileHeaders = Object.keys(rows[0]).map((h) => h.trim());
    const hasHeader = (...names: readonly string[]) =>
      fileHeaders.some((h) => names.some((n) => h.toLowerCase() === n.toLowerCase()));

    const col = (row: Record<string, string | number>, ...keys: readonly string[]) => {
      const trimmed = Object.entries(row).map(([k, v]) => [k.trim(), v] as const);
      for (const k of keys) {
        const entry = trimmed.find(([tk]) => tk.toLowerCase() === k.toLowerCase());
        if (entry !== undefined && entry[1] !== undefined && entry[1] !== null) {
          return String(entry[1]).trim();
        }
      }
      return "";
    };

    // Accepted spellings, in one place so the presence test and the read agree.
    const ID_COLS = ["PLACE ID", "STORE ID"] as const;
    const NAME_COLS = ["PLACE NAME", "STORE NAME"] as const;
    const CHANNEL_COLS = ["CHANNEL", "CHANNEL NAME"] as const;
    const PROVINCE_COLS = ["PROVINCE"] as const;
    const REGION_COLS = ["REGION", "AREA"] as const;
    const LAT_COLS = ["GPS LATITUDE", "GPS_LATITUDE", "LATITUDE"] as const;
    const LNG_COLS = ["GPS LONGITUDE", "GPS_LONGITUDE", "LONGITUDE"] as const;

    if (!hasHeader(...ID_COLS)) {
      return NextResponse.json(
        {
          error:
            "No PLACE ID column. That column is how a row is matched to a store, so nothing can be imported without it.",
          fileHeaders,
        },
        { status: 400 }
      );
    }

    /**
     * Column presence, not cell emptiness, decides whether a field is in scope.
     *
     * A column that is not in the file is left alone on every store — that is
     * what makes a cut-down "just the coordinates" sheet safe. A column that IS
     * in the file but blank on a row is an instruction to clear that field,
     * because otherwise there would be no way to remove a wrong coordinate in
     * bulk. Both outcomes are counted and reported.
     */
    const present = {
      name: hasHeader(...NAME_COLS),
      channel: hasHeader(...CHANNEL_COLS),
      province: hasHeader(...PROVINCE_COLS),
      region: hasHeader(...REGION_COLS),
      // Latitude and longitude move as a pair. Writing one without the other
      // leaves a half coordinate that plots nowhere, so both must be present.
      gps: hasHeader(...LAT_COLS) && hasHeader(...LNG_COLS),
    };
    const gpsHalfPresent =
      !present.gps && (hasHeader(...LAT_COLS) || hasHeader(...LNG_COLS));

    if (!present.name && !present.channel && !present.province && !present.region && !present.gps) {
      return NextResponse.json(
        {
          error: `This file has a PLACE ID column but none of the columns this page imports (${IMPORTABLE.join(
            ", "
          )}). Nothing would change.`,
          fileHeaders,
        },
        { status: 400 }
      );
    }

    const [stores, channels, overrides] = await Promise.all([
      getStores(),
      getChannels(),
      getStoreOverrides(),
    ]);
    const pinnedStoreIds = overriddenStoreIds(overrides);

    // Matched on placeId first, then on id. A row that matches neither is
    // reported, never created — creating a store here would produce one with no
    // rep, which is a store nobody ever visits.
    const byPlaceId = new Map<string, Store>();
    for (const s of stores) {
      const k = (s.placeId || "").trim();
      if (k && !byPlaceId.has(k)) byPlaceId.set(k, s);
    }
    const byId = new Map(stores.map((s) => [s.id, s]));

    // Channels are matched, never created. On the upload page an unknown
    // channel name is a new channel; here it is almost always a typo in a file
    // that was exported with the right name a minute earlier, and creating one
    // forks the channel and drags every store on that row onto blank defaults.
    const channelByName = new Map<string, Channel>();
    for (const c of channels) {
      const k = c.name.trim().toLowerCase();
      if (!channelByName.has(k)) channelByName.set(k, c);
    }

    const changed = { name: 0, channel: 0, province: 0, region: 0, gps: 0, gpsCleared: 0 };
    let matched = 0;
    let unchanged = 0;
    const unmatched: string[] = [];
    const unknownChannels = new Set<string>();
    const blankRequired: string[] = [];
    const duplicateIds = new Set<string>();
    const seen = new Set<string>();
    let noIdRows = 0;

    for (const row of rows) {
      const placeId = col(row, ...ID_COLS);
      if (!placeId) {
        noIdRows++;
        continue;
      }

      const store = byPlaceId.get(placeId) || byId.get(placeId);
      if (!store) {
        unmatched.push(placeId);
        continue;
      }
      // Last row wins, as in any spreadsheet merge — but say so, because two
      // rows for one store usually means two files were pasted together.
      if (seen.has(placeId)) duplicateIds.add(placeId);
      seen.add(placeId);
      matched++;

      let touched = false;

      if (present.name) {
        const name = col(row, ...NAME_COLS);
        // A nameless store is unusable in every grid in the app, so a blank
        // here is refused rather than written.
        if (!name) {
          blankRequired.push(`${placeId} — blank PLACE NAME, name left as "${store.name}"`);
        } else if (name !== store.name) {
          store.name = name;
          changed.name++;
          touched = true;
        }
      }

      if (present.channel) {
        const channelName = col(row, ...CHANNEL_COLS);
        if (!channelName) {
          blankRequired.push(`${placeId} — blank CHANNEL, channel left unchanged`);
        } else {
          const channel = channelByName.get(channelName.toLowerCase());
          if (!channel) {
            unknownChannels.add(channelName);
          } else if (channel.id !== store.channelId) {
            store.channelId = channel.id;
            // A store that moves channel takes the new channel's call rhythm
            // with it — unless a manager has pinned it with an override, which
            // is the one thing that must survive a bulk file.
            if (!pinnedStoreIds.has(store.id)) {
              store.frequency = channel.frequency;
              store.duration = channel.duration;
            }
            changed.channel++;
            touched = true;
          }
        }
      }

      if (present.province) {
        const province = col(row, ...PROVINCE_COLS);
        if (province !== (store.province || "")) {
          store.province = province;
          changed.province++;
          touched = true;
        }
      }

      if (present.region) {
        const region = col(row, ...REGION_COLS);
        if (region !== (store.region || "")) {
          store.region = region;
          changed.region++;
          touched = true;
        }
      }

      if (present.gps) {
        const lat = col(row, ...LAT_COLS);
        const lng = col(row, ...LNG_COLS);
        if (lat !== (store.gpsLat || "") || lng !== (store.gpsLng || "")) {
          const wasSet = !!(store.gpsLat || "").trim() && !!(store.gpsLng || "").trim();
          store.gpsLat = lat;
          store.gpsLng = lng;
          changed.gps++;
          // Called out separately: clearing a pin is a legitimate edit, but a
          // whole column of them means someone deleted the wrong cells.
          if (wasSet && (!lat || !lng)) changed.gpsCleared++;
          touched = true;
        }
      }

      if (!touched) unchanged++;
    }

    const totalChanges =
      changed.name + changed.channel + changed.province + changed.region + changed.gps;
    if (totalChanges > 0) await saveStores(stores);

    logActivity({
      action: "Imported stores",
      actor: session.email || "unknown",
      actorName: session.name || "Unknown",
      summary:
        `Stores-only import of ${file.name}: ${matched} of ${rows.length} rows matched, ` +
        `${totalChanges} field changes (${changed.gps} GPS, ${changed.channel} channel, ` +
        `${changed.name} name, ${changed.province} province, ${changed.region} region). ` +
        `No rep or role data read.`,
    });

    return NextResponse.json({
      ok: true,
      sheetName,
      rowsInFile: rows.length,
      matched,
      unchanged,
      totalChanges,
      changed,
      noIdRows,
      // Which fields this file could actually act on, so a missing column reads
      // as "not in your file" rather than as a failed import.
      columnsRead: [
        present.name && "PLACE NAME",
        present.channel && "CHANNEL",
        present.province && "PROVINCE",
        present.region && "REGION",
        present.gps && "GPS LATITUDE / GPS LONGITUDE",
      ].filter(Boolean) as string[],
      columnsAbsent: [
        !present.name && "PLACE NAME",
        !present.channel && "CHANNEL",
        !present.province && "PROVINCE",
        !present.region && "REGION",
        !present.gps && "GPS LATITUDE / GPS LONGITUDE",
      ].filter(Boolean) as string[],
      gpsHalfPresent,
      unmatchedCount: unmatched.length,
      unmatched: unmatched.slice(0, 25),
      unknownChannels: Array.from(unknownChannels),
      blankRequired: blankRequired.slice(0, 25),
      blankRequiredCount: blankRequired.length,
      duplicateIds: Array.from(duplicateIds).slice(0, 25),
      duplicateIdCount: duplicateIds.size,
      fileHeaders,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (msg.includes("Forbidden")) {
      return NextResponse.json(
        { error: "You do not have permission to import stores." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
