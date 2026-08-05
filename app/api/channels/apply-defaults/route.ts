import { NextRequest, NextResponse } from "next/server";
import {
  getChannels,
  getStores,
  saveStores,
  getStoreOverrides,
  saveStoreOverrides,
} from "@/lib/data";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { applyChannelDefaults, overriddenStoreIds } from "@/lib/channelDefaults";
import { Store, Channel, StoreOverride } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// What the store upload used to stamp on every new store regardless of its
// channel. A store still sitting on exactly these values was never chosen by
// anyone — it is the bug's fingerprint, not a decision worth preserving.
const LEGACY_UPLOAD_DEFAULT = { frequency: "monthly", duration: 30 } as const;

/**
 * A store that differs from BOTH its channel's defaults and the legacy upload
 * stamp was edited by hand on the Stores page. Those edits predate override
 * records, so there is nothing marking them as deliberate — and a blanket
 * cascade would silently discard them.
 */
function looksHandEdited(store: Store, channel: Channel | undefined): boolean {
  if (!channel) return false;
  const matchesChannel =
    store.frequency === channel.frequency && store.duration === channel.duration;
  const matchesLegacy =
    store.frequency === LEGACY_UPLOAD_DEFAULT.frequency &&
    store.duration === LEGACY_UPLOAD_DEFAULT.duration;
  return !matchesChannel && !matchesLegacy;
}

async function analyse(protectManualEdits: boolean) {
  const [channels, stores, overrides] = await Promise.all([
    getChannels(),
    getStores(),
    getStoreOverrides(),
  ]);

  const byId = new Map(channels.map((c) => [c.id, c]));
  const pinned = overriddenStoreIds(overrides);

  const handEdited = stores.filter(
    (s) => !pinned.has(s.id) && looksHandEdited(s, byId.get(s.channelId))
  );
  if (protectManualEdits) for (const s of handEdited) pinned.add(s.id);

  return { channels, stores, overrides, pinned, handEdited };
}

// GET — preview. Changes nothing.
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const protectManualEdits =
      request.nextUrl.searchParams.get("protectManualEdits") !== "false";
    const { channels, stores, pinned, handEdited } = await analyse(protectManualEdits);

    const result = applyChannelDefaults(stores, channels, pinned, { apply: false });

    // Group the preview by channel so it reads like the Channels page
    const byChannel = new Map<string, { name: string; count: number; to: string }>();
    for (const c of result.changes) {
      const ch = channels.find((x) => x.id === c.channelId)!;
      const entry = byChannel.get(c.channelId) || {
        name: ch.name,
        count: 0,
        to: `${c.to.frequency}, ${c.to.duration}min`,
      };
      entry.count++;
      byChannel.set(c.channelId, entry);
    }

    return NextResponse.json({
      totalStores: stores.length,
      wouldChange: result.changes.length,
      keptOverridden: result.skippedOverridden,
      manualEditsProtected: protectManualEdits ? handEdited.length : 0,
      storesWithoutChannel: result.storesWithoutChannel,
      byChannel: [...byChannel.values()].sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — apply.
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role !== "superAdmin" && session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const protectManualEdits = body.protectManualEdits !== false;

    const { channels, stores, overrides, pinned, handEdited } =
      await analyse(protectManualEdits);

    const result = applyChannelDefaults(stores, channels, pinned, { apply: true });
    if (result.changes.length > 0) await saveStores(stores);

    // Give the hand-edited stores a real override record, so from now on they
    // are protected by the same mechanism as everything else rather than by a
    // heuristic that only exists in this route.
    let overridesCreated = 0;
    if (protectManualEdits && handEdited.length > 0) {
      const byId = new Map(channels.map((c) => [c.id, c]));
      const now = new Date().toISOString();
      const actor = session.name || session.email;
      const existing = new Set(overrides.map((o) => o.storeId));

      for (const store of handEdited) {
        if (existing.has(store.id)) continue;
        const channel = byId.get(store.channelId);
        const record: StoreOverride = {
          id: crypto.randomUUID(),
          storeId: store.id,
          storeName: store.name,
          placeId: store.placeId,
          channelId: store.channelId,
          repCode: store.repCode,
          defaultFrequency: channel?.frequency ?? store.frequency,
          defaultDuration: channel?.duration ?? store.duration,
          frequency: store.frequency,
          duration: store.duration,
          approvalStatus: "approved",
          requestedBy: actor,
          requestedAt: now,
          decidedBy: actor,
          decidedAt: now,
          createdBy: actor,
          createdAt: now,
          updatedAt: now,
        };
        overrides.push(record);
        overridesCreated++;
      }
      if (overridesCreated > 0) await saveStoreOverrides(overrides);
    }

    logActivity({
      action: "Applied channel defaults",
      actor: session.email,
      actorName: session.name || session.email,
      summary: `Applied channel defaults to ${result.changes.length} store(s)`,
      details: `${result.skippedOverridden} kept an existing override; ${overridesCreated} manual edit(s) preserved as new overrides`,
    });

    return NextResponse.json({
      ok: true,
      storesUpdated: result.changes.length,
      keptOverridden: result.skippedOverridden,
      overridesCreated,
      storesWithoutChannel: result.storesWithoutChannel,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
