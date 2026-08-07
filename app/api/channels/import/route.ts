import { NextRequest, NextResponse } from "next/server";
import { getChannels, saveChannels, getStores, saveStores, getStoreOverrides, getVisitRoles } from "@/lib/data";
import { applyChannelDefaults, overriddenStoreIds } from "@/lib/channelDefaults";
import {
  Channel,
  FrequencyType,
  FREQUENCY_OPTIONS,
  parseFrequency,
  roleColumns,
} from "@/lib/types";
import { resolveRoleDefault, roleCallsOnChannel, roleDefaultFor } from "@/lib/repStores";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import * as XLSX from "xlsx";

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

    const [channels, visitRoles] = await Promise.all([getChannels(), getVisitRoles()]);
    const byName = new Map(channels.map((c) => [c.name.toLowerCase().trim(), c]));
    // The primary role writes to the channel's own frequency/duration, not to
    // roleDefaults, so it is deliberately not in this list.
    const extraRoles = visitRoles.filter((r) => !r.isPrimary);

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

    const errors: string[] = [];

    /** "Yes"/"No" and the obvious synonyms. Blank means "leave it alone". */
    const parseYesNo = (raw: string): boolean | undefined | null => {
      const v = raw.trim().toLowerCase();
      if (!v) return undefined;
      if (["yes", "y", "true", "1", "on", "calls"].includes(v)) return true;
      if (["no", "n", "false", "0", "off", "never"].includes(v)) return false;
      return null; // unrecognised — reported rather than guessed at
    };

    /**
     * Read one channel's per-role columns and write them onto it.
     *
     * The values are compared against WHAT THE CHANNEL RESOLVES TO TODAY, not
     * against the raw record. The export fills every role cell in — a role that
     * inherits its rhythm still has one, and a blank column reads as broken —
     * so comparing against the record would turn every inheriting channel into
     * an explicit override the first time this file came back, and a later edit
     * on the Visit Roles page would then reach none of them.
     *
     * Returns true if anything actually changed. Role defaults are NOT
     * materialised onto stores, so this deliberately does not mark the channel
     * for the store cascade.
     */
    const applyRoleColumns = (
      target: Channel,
      row: Record<string, string | number>,
      rowNo: number
    ): boolean => {
      let changed = false;

      for (const role of extraRoles) {
        const c = roleColumns(role);
        const callsRaw = col(row, c.calls);
        const freqCell = col(row, c.frequency);
        const durCell = col(row, c.duration);
        if (!callsRaw && !freqCell && !durCell) continue; // columns absent or blank

        const effective = resolveRoleDefault(target, role);

        let nextFreq = effective.frequency;
        if (freqCell) {
          const parsed = parseFrequency(freqCell);
          if (!parsed) {
            errors.push(`Row ${rowNo}: unrecognised "${c.frequency}" value "${freqCell}"`);
            continue;
          }
          nextFreq = parsed;
        }

        let nextDur = effective.duration;
        if (durCell) {
          const n = Number(durCell);
          if (isNaN(n) || n < 1) {
            errors.push(`Row ${rowNo}: invalid "${c.duration}" value "${durCell}"`);
            continue;
          }
          nextDur = n;
        }

        let nextCalls = roleCallsOnChannel(target, role);
        const yn = parseYesNo(callsRaw);
        if (yn === null) {
          errors.push(`Row ${rowNo}: "${c.calls}" must be Yes or No, not "${callsRaw}"`);
          continue;
        }
        if (yn !== undefined) nextCalls = yn;

        // Shared with the Channels grid so the two cannot disagree about when
        // a value is an override and when it is inherited.
        const entry = roleDefaultFor(role, nextFreq, nextDur, nextCalls);

        const before = target.roleDefaults?.[role.id];
        if (JSON.stringify(before ?? null) === JSON.stringify(entry ?? null)) continue;

        const next = { ...(target.roleDefaults ?? {}) };
        if (entry) next[role.id] = entry;
        else delete next[role.id];
        target.roleDefaults = next;
        changed = true;
      }

      return changed;
    };

    let updated = 0;
    let created = 0;
    // Channels whose PRIMARY defaults this import touched — only these cascade
    // onto stores. Per-role defaults are read live by lib/repStores.ts instead.
    const touchedChannelIds = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = col(row, "Channel Name", "Name", "Channel");
      if (!name) continue;

      const freqRaw = col(row, "Frequency", "Default Frequency");
      const durationRaw = col(row, "Duration (min)", "Duration", "Duration (minutes)");

      // Validate frequency. parseFrequency is deliberately forgiving about
      // case, spacing and wording — these files are typed by hand, and a whole
      // import used to fail on "Weekly" vs "weekly".
      let frequency: FrequencyType | undefined;
      if (freqRaw) {
        const parsed = parseFrequency(freqRaw);
        if (!parsed) {
          errors.push(
            `Row ${i + 2}: unrecognised frequency "${freqRaw}" — use one of: ${FREQUENCY_OPTIONS.map((f) => f.label).join(", ")}`
          );
          continue;
        }
        frequency = parsed;
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
        // Only the primary values cascade onto stores, so the role columns are
        // read separately and counted as an update without triggering it.
        const roleChanged = applyRoleColumns(existing, row, i + 2);
        if (changed) touchedChannelIds.add(existing.id);
        if (changed || roleChanged) updated++;
      } else {
        // Create new channel
        const newCh: Channel = {
          id: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name,
          frequency: frequency || "monthly",
          duration: duration ?? 30,
        };
        applyRoleColumns(newCh, row, i + 2);
        channels.push(newCh);
        byName.set(name.toLowerCase().trim(), newCh);
        touchedChannelIds.add(newCh.id);
        created++;
      }
    }

    let storesUpdated = 0;
    let storesPinned = 0;
    if (updated > 0 || created > 0) {
      await saveChannels(channels);

      // An import that changes defaults has to reach the stores too, exactly
      // as a single channel edit does.
      if (touchedChannelIds.size > 0) {
        const [stores, overrides] = await Promise.all([getStores(), getStoreOverrides()]);
        const result = applyChannelDefaults(stores, channels, overriddenStoreIds(overrides), {
          apply: true,
          onlyChannelIds: touchedChannelIds,
        });
        storesUpdated = result.changes.length;
        storesPinned = result.skippedOverridden;
        if (storesUpdated > 0) await saveStores(stores);
      }

      logActivity({
        action: "Imported channels",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Imported channels: ${updated} updated, ${created} created`,
        details: `Applied defaults to ${storesUpdated} store(s); ${storesPinned} kept their override`,
      });
    }

    return NextResponse.json({
      ok: true,
      updated,
      created,
      storesUpdated,
      storesPinned,
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
