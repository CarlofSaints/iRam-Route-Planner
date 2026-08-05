import { NextRequest, NextResponse } from "next/server";
import { getChannels, saveChannels, getStores, saveStores, getStoreOverrides } from "@/lib/data";
import { Channel, FrequencyType } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { applyChannelDefaults, overriddenStoreIds } from "@/lib/channelDefaults";

export async function GET() {
  try {
    const channels = await getChannels();
    return NextResponse.json(channels);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, frequency, duration } = body as Partial<Channel> & { id: string };

    const channels = await getChannels();
    const idx = channels.findIndex((c) => c.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const defaultsChanged =
      (frequency !== undefined && frequency !== channels[idx].frequency) ||
      (duration !== undefined && duration !== channels[idx].duration);

    if (name) channels[idx].name = name;
    if (frequency) channels[idx].frequency = frequency as FrequencyType;
    if (duration !== undefined) channels[idx].duration = duration;

    await saveChannels(channels);

    // Push the new defaults down onto this channel's stores. Without this the
    // channel record is the only thing that changes and nothing downstream
    // ever sees it — see lib/channelDefaults.ts.
    let storesUpdated = 0;
    let storesPinned = 0;
    if (defaultsChanged) {
      const [stores, overrides] = await Promise.all([getStores(), getStoreOverrides()]);
      const result = applyChannelDefaults(stores, channels, overriddenStoreIds(overrides), {
        apply: true,
        onlyChannelIds: new Set([channels[idx].id]),
      });
      storesUpdated = result.changes.length;
      storesPinned = result.skippedOverridden;
      if (storesUpdated > 0) await saveStores(stores);
    }

    const session = await getSession();
    logActivity({
      action: "Updated channel",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Updated channel ${channels[idx].name}`,
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
  try {
    const body = await request.json();
    const channels = await getChannels();
    const newChannel: Channel = {
      id: body.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      name: body.name,
      frequency: body.frequency || "monthly",
      duration: body.duration || 30,
    };
    channels.push(newChannel);
    await saveChannels(channels);

    const session = await getSession();
    logActivity({ action: "Created channel", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created channel ${newChannel.name}` });

    return NextResponse.json(newChannel, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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
    const channels = await getChannels();
    const targets = channels.filter((c) => idSet.has(c.id));
    const filtered = channels.filter((c) => !idSet.has(c.id));
    await saveChannels(filtered);

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
