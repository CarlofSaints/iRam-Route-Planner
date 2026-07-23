import { NextRequest, NextResponse } from "next/server";
import { getChannels, saveChannels } from "@/lib/data";
import { Channel, FrequencyType, FREQUENCY_OPTIONS } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import * as XLSX from "xlsx";

const VALID_FREQUENCIES = new Set(FREQUENCY_OPTIONS.map((f) => f.value));

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);

    if (rows.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    const channels = await getChannels();
    const byName = new Map(channels.map((c) => [c.name.toLowerCase().trim(), c]));

    // Helper: get column value by trying multiple header names
    const col = (row: Record<string, string | number>, ...keys: string[]) => {
      const trimmed = Object.entries(row).map(([k, v]) => [k.trim(), v] as const);
      for (const k of keys) {
        const entry = trimmed.find(([tk]) => tk.toLowerCase() === k.toLowerCase());
        if (entry !== undefined && entry[1] !== undefined && entry[1] !== "") {
          return String(entry[1]).trim();
        }
      }
      return "";
    };

    let updated = 0;
    let created = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = col(row, "Channel Name", "Name", "Channel");
      if (!name) continue;

      const freqRaw = col(row, "Frequency", "Default Frequency");
      const durationRaw = col(row, "Duration (min)", "Duration", "Duration (minutes)");

      // Validate frequency
      let frequency: FrequencyType | undefined;
      if (freqRaw) {
        if (VALID_FREQUENCIES.has(freqRaw as FrequencyType)) {
          frequency = freqRaw as FrequencyType;
        } else {
          // Try matching by label
          const byLabel = FREQUENCY_OPTIONS.find(
            (f) => f.label.toLowerCase() === freqRaw.toLowerCase()
          );
          if (byLabel) {
            frequency = byLabel.value;
          } else {
            errors.push(`Row ${i + 2}: invalid frequency "${freqRaw}"`);
            continue;
          }
        }
      }

      const duration = durationRaw ? Number(durationRaw) : undefined;
      if (durationRaw && (isNaN(duration!) || duration! < 1)) {
        errors.push(`Row ${i + 2}: invalid duration "${durationRaw}"`);
        continue;
      }

      const existing = byName.get(name.toLowerCase().trim());
      if (existing) {
        // Update existing channel
        let changed = false;
        if (frequency && frequency !== existing.frequency) {
          existing.frequency = frequency;
          changed = true;
        }
        if (duration !== undefined && duration !== existing.duration) {
          existing.duration = duration;
          changed = true;
        }
        if (changed) updated++;
      } else {
        // Create new channel
        const newCh: Channel = {
          id: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name,
          frequency: frequency || "monthly",
          duration: duration ?? 30,
        };
        channels.push(newCh);
        byName.set(name.toLowerCase().trim(), newCh);
        created++;
      }
    }

    if (updated > 0 || created > 0) {
      await saveChannels(channels);
      logActivity({
        action: "Imported channels",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Imported channels: ${updated} updated, ${created} created`,
      });
    }

    return NextResponse.json({
      ok: true,
      updated,
      created,
      errors,
      totalRows: rows.length,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Channel import error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
