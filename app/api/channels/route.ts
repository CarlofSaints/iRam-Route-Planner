import { NextRequest, NextResponse } from "next/server";
import { getChannels, saveChannels, getStores, saveStores, getStoreOverrides } from "@/lib/data";
import { Channel, FrequencyType } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { applyChannelDefaults, overriddenStoreIds } from "@/lib/channelDefaults";
import { refuseEdit } from "@/lib/editGuard";
import { withWriteLock } from "@/lib/writeLock";
import { channelsStillHoldingStores } from "@/lib/routable";

export async function GET() {
  try {
    const channels = await getChannels();
    return NextResponse.json(channels);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await refuseEdit("channels");
  if (denied) return denied;

  try {
    const body = await request.json();
    const { id, name, frequency, duration, roleDefaults, notARepChannel } = body as Partial<Channel> & { id: string };

    // Read, patch the one named channel, write: under the lock, so two quick
    // saves from the Channels page cannot each write back a list that is
    // missing the other's change (lib/writeLock.ts).
    const outcome = await withWriteLock("channels", async () => {
      const channels = await getChannels();
      const idx = channels.findIndex((c) => c.id === id);
      if (idx === -1) return null;

      const defaultsChanged =
        (frequency !== undefined && frequency !== channels[idx].frequency) ||
        (duration !== undefined && duration !== channels[idx].duration);

      if (name) channels[idx].name = name;
      if (frequency) channels[idx].frequency = frequency as FrequencyType;
      if (duration !== undefined) channels[idx].duration = duration;

      // Per-role defaults for QC/Training. These are NOT materialised onto stores
      // the way the primary role's are — lib/repStores.ts substitutes them when it
      // builds a non-primary rep's store list, so a change takes effect on the
      // next route generation with no cascade needed.
      if (roleDefaults !== undefined) channels[idx].roleDefaults = roleDefaults;

      // Whether anybody calls on this channel at all (lib/routable.ts).
      //
      // Deliberately NOT part of defaultsChanged: that cascades frequency and
      // duration onto every store in the channel, and taking a channel out of the
      // cycle is no reason to rewrite the rhythm of stores an override may put
      // straight back in. Absent means "reps call here", so the flag is REMOVED
      // rather than stored as false.
      const routingChanged =
        notARepChannel !== undefined && !!notARepChannel !== (channels[idx].notARepChannel === true);
      if (notARepChannel !== undefined) {
        if (notARepChannel) channels[idx].notARepChannel = true;
        else delete channels[idx].notARepChannel;
      }

      await saveChannels(channels);
      return { channels, idx, defaultsChanged, routingChanged };
    });
    if (!outcome) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { channels, idx, defaultsChanged, routingChanged } = outcome;

    // Push the new defaults down onto this channel's stores. Without this the
    // channel record is the only thing that changes and nothing downstream
    // ever sees it — see lib/channelDefaults.ts.
    let storesUpdated = 0;
    let storesPinned = 0;
    if (defaultsChanged) {
      await withWriteLock("stores", async () => {
        const [stores, overrides] = await Promise.all([getStores(), getStoreOverrides()]);
        const result = applyChannelDefaults(stores, channels, overriddenStoreIds(overrides), {
          apply: true,
          onlyChannelIds: new Set([channels[idx].id]),
        });
        storesUpdated = result.changes.length;
        storesPinned = result.skippedOverridden;
        if (storesUpdated > 0) await saveStores(stores);
      });
    }

    const session = await getSession();
    logActivity({
      action: "Updated channel",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: routingChanged
        ? `${channels[idx].name}: ${
            channels[idx].notARepChannel
              ? "Called on? switched off. Its stores leave every call cycle at the next route generation"
              : "Called on? switched back on. Its stores return to the call cycles at the next route generation"
          }`
        : `Updated channel ${channels[idx].name}`,
      details: defaultsChanged
        ? `Applied defaults to ${storesUpdated} store(s); ${storesPinned} kept their override`
        : undefined,
    });

    return NextResponse.json({ ...channels[idx], storesUpdated, storesPinned });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await refuseEdit("channels");
  if (denied) return denied;

  try {
    const body = await request.json();
    const newChannel: Channel = {
      id: body.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      name: body.name,
      frequency: body.frequency || "monthly",
      duration: body.duration || 30,
      source: "manual",
      sourceAt: new Date().toISOString(),
    };
    await withWriteLock("channels", async () => {
      const channels = await getChannels();
      channels.push(newChannel);
      await saveChannels(channels);
    });

    const session = await getSession();
    logActivity({ action: "Created channel", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created channel ${newChannel.name}` });

    return NextResponse.json(newChannel, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await refuseEdit("channels");
  if (denied) return denied;

  try {
    const body = await request.json();
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids
      : body.id != null
      ? [body.id]
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No channel id(s) provided" }, { status: 400 });
    }

    const idSet = new Set(ids);

    const result = await withWriteLock("channels", async () => {
      const [channels, stores] = await Promise.all([getChannels(), getStores()]);
      // 🔴 Refused while any store is still filed under the channel. Its stores
      // would point at nothing, and a store whose channel is missing is treated
      // as called on (lib/routable.ts), so a switched-off channel's stores would
      // quietly rejoin every cycle. Move them to another channel first.
      const holding = channelsStillHoldingStores(idSet, stores);
      if (holding.length > 0) {
        const nameOf = new Map(channels.map((c) => [c.id, c.name]));
        const parts = holding.map(
          (h) => `${nameOf.get(h.id) ?? h.id} still has ${h.stores.toLocaleString("en-ZA")} store${h.stores === 1 ? "" : "s"}`
        );
        return {
          refused: `Not deleted. ${parts.join("; ")}. Move those stores to another channel (Store Upload or the Stores page) and try again.`,
        };
      }
      const targets = channels.filter((c) => idSet.has(c.id));
      await saveChannels(channels.filter((c) => !idSet.has(c.id)));
      return { targets };
    });
    if ("refused" in result) {
      return NextResponse.json({ error: result.refused }, { status: 409 });
    }
    const { targets } = result;

    const session = await getSession();
    const summary =
      targets.length === 1
        ? `Deleted channel ${targets[0].name}`
        : `Deleted ${targets.length} channels: ${targets.map((c) => c.name).join(", ")}`;
    logActivity({ action: "Deleted channel", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary });

    return NextResponse.json({ ok: true, deleted: targets.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
