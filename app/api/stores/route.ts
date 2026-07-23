import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores } from "@/lib/data";
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
    if (updates.frequency !== undefined) stores[idx].frequency = updates.frequency as FrequencyType;
    if (updates.duration !== undefined) stores[idx].duration = updates.duration;
    if (updates.dayOfWeek !== undefined) stores[idx].dayOfWeek = updates.dayOfWeek;
    if (updates.weekNumber !== undefined) stores[idx].weekNumber = updates.weekNumber;
    if (updates.region !== undefined) stores[idx].region = updates.region;
    if (updates.province !== undefined) stores[idx].province = updates.province;

    await saveStores(stores);

    const session = await getSession();
    logActivity({ action: "Updated store", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated store ${stores[idx].name}` });

    return NextResponse.json(stores[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
