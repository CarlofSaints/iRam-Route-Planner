import { NextResponse } from "next/server";
import { getStores, saveStores, getChannels } from "@/lib/data";
import { buildDuplicateGroups } from "@/lib/duplicates";
import { getSession, requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET() {
  try {
    await requireSession();
    const [stores, channels] = await Promise.all([getStores(), getChannels()]);
    const channelName = new Map(channels.map((c) => [c.id, c.name]));
    const { groups, removeIds } = buildDuplicateGroups(stores);

    const withChannel = groups.map((g) => ({
      ...g,
      records: g.records.map((r) => ({ ...r, channel: channelName.get(r.channelId) || r.channelId || "" })),
    }));

    return NextResponse.json({
      totalStores: stores.length,
      groupCount: groups.length,
      removableCount: removeIds.size,
      groups: withChannel,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Duplicates error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    await requireSession();
    const stores = await getStores();
    const { removeIds } = buildDuplicateGroups(stores);

    if (removeIds.size === 0) {
      return NextResponse.json({ removed: 0, remaining: stores.length });
    }

    const survivors = stores.filter((s) => !removeIds.has(s.id));
    await saveStores(survivors);

    const session = await getSession();
    logActivity({
      action: "Deduplicated stores",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Removed ${removeIds.size} duplicate store records (${survivors.length} remain)`,
    });

    return NextResponse.json({ removed: removeIds.size, remaining: survivors.length });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Dedup apply error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
