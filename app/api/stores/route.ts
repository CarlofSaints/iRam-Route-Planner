import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, getStoreOverrides, saveStoreOverrides } from "@/lib/data";
import { Store, FrequencyType } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET() {
  try {
    const stores = await getStores();
    return NextResponse.json(stores);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body as Partial<Store> & { id: string };

    const stores = await getStores();
    const idx = stores.findIndex((s) => s.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (updates.repCode !== undefined) stores[idx].repCode = updates.repCode;
    if (updates.channelId !== undefined) stores[idx].channelId = updates.channelId;
    if (updates.gpsLat !== undefined) stores[idx].gpsLat = updates.gpsLat;
    if (updates.gpsLng !== undefined) stores[idx].gpsLng = updates.gpsLng;
    if (updates.rangeConfirmed !== undefined) stores[idx].rangeConfirmed = updates.rangeConfirmed;

    // Editing call frequency or duration here diverges the store from its
    // channel, so it has to leave an override record — that record is what
    // stops a later channel change cascading over the decision, and it is the
    // same marker the Call Overrides page uses.
    const divergesFromChannel =
      (updates.frequency !== undefined && updates.frequency !== stores[idx].frequency) ||
      (updates.duration !== undefined && updates.duration !== stores[idx].duration);

    if (updates.frequency !== undefined) stores[idx].frequency = updates.frequency as FrequencyType;
    if (updates.duration !== undefined) stores[idx].duration = updates.duration;
    if (updates.dayOfWeek !== undefined) stores[idx].dayOfWeek = updates.dayOfWeek;
    if (updates.weekNumber !== undefined) stores[idx].weekNumber = updates.weekNumber;
    if (updates.region !== undefined) stores[idx].region = updates.region;
    if (updates.province !== undefined) stores[idx].province = updates.province;

    await saveStores(stores);

    const session = await getSession();

    if (divergesFromChannel) {
      const store = stores[idx];
      const [channels, overrides] = await Promise.all([getChannels(), getStoreOverrides()]);
      const channel = channels.find((c) => c.id === store.channelId);

      // Back at the channel default? Then there is nothing to protect — drop
      // the override so the store follows its channel again.
      const backOnDefault =
        !!channel &&
        store.frequency === channel.frequency &&
        store.duration === channel.duration;

      const now = new Date().toISOString();
      const actor = session?.name || session?.email || "Unknown";
      const existingIdx = overrides.findIndex((o) => o.storeId === store.id);

      if (backOnDefault) {
        if (existingIdx !== -1) {
          overrides.splice(existingIdx, 1);
          await saveStoreOverrides(overrides);
        }
      } else {
        const base = {
          storeName: store.name,
          placeId: store.placeId,
          channelId: store.channelId,
          repCode: store.repCode,
          defaultFrequency: (channel?.frequency ?? store.frequency) as FrequencyType,
          defaultDuration: channel?.duration ?? store.duration,
          frequency: store.frequency,
          duration: store.duration,
          updatedAt: now,
        };
        if (existingIdx !== -1) {
          Object.assign(overrides[existingIdx], base);
        } else {
          overrides.push({
            id: crypto.randomUUID(),
            storeId: store.id,
            ...base,
            approvalStatus: "approved",
            requestedBy: actor,
            requestedAt: now,
            decidedBy: actor,
            decidedAt: now,
            createdBy: actor,
            createdAt: now,
          });
        }
        await saveStoreOverrides(overrides);
      }
    }

    logActivity({ action: "Updated store", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated store ${stores[idx].name}` });

    return NextResponse.json(stores[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
