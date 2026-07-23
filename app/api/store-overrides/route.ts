import { NextRequest, NextResponse } from "next/server";
import {
  getStoreOverrides,
  saveStoreOverrides,
  getStores,
  saveStores,
  getChannels,
  getRolePermissions,
} from "@/lib/data";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { StoreOverride, FrequencyType, SessionPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function hasManagePerm(session: SessionPayload): Promise<boolean> {
  const perms = await getRolePermissions();
  const rp = perms.find((p) => p.role === session.role);
  return !!rp?.permissions.includes("manage_store_overrides");
}

const noStore = { "Cache-Control": "no-store" };

// GET — list overrides (reps see only their own stores' overrides)
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });

    let overrides = await getStoreOverrides();
    const canManage = await hasManagePerm(session);
    if (!canManage && session.role === "rep") {
      overrides = overrides.filter((o) => o.repCode && o.repCode === session.repCode);
    }
    return NextResponse.json(
      { overrides, canManage, role: session.role, repCode: session.repCode ?? null },
      { headers: noStore }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: noStore });
  }
}

// POST — create/update an override for a store (applies immediately to the store)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });

    const body = await request.json();
    const { storeId, frequency, duration } = body as {
      storeId: string;
      frequency: FrequencyType;
      duration: number;
    };

    if (!storeId || !frequency || duration == null || isNaN(Number(duration))) {
      return NextResponse.json({ error: "storeId, frequency and duration are required" }, { status: 400, headers: noStore });
    }

    const stores = await getStores();
    const store = stores.find((s) => s.id === storeId);
    if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404, headers: noStore });

    // Authorisation: managers can edit any store; reps only their own
    const canManage = await hasManagePerm(session);
    const ownsStore = session.role === "rep" && !!session.repCode && store.repCode === session.repCode;
    if (!canManage && !ownsStore) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore });
    }

    const channels = await getChannels();
    const channel = channels.find((c) => c.id === store.channelId);
    const defaultFrequency = (channel?.frequency ?? store.frequency) as FrequencyType;
    const defaultDuration = channel?.duration ?? store.duration;

    const dur = Number(duration);
    const now = new Date().toISOString();

    // Apply immediately to the live store record (never halted by approval)
    store.frequency = frequency;
    store.duration = dur;
    await saveStores(stores);

    // Manager edits are auto-approved (they are the approver); rep edits need approval.
    const autoApproved = canManage;

    // Upsert the override record (keyed by storeId)
    const overrides = await getStoreOverrides();
    const existing = overrides.find((o) => o.storeId === storeId);
    const actor = session.name || session.email;

    let record: StoreOverride;
    if (existing) {
      existing.storeName = store.name;
      existing.placeId = store.placeId;
      existing.channelId = store.channelId;
      existing.repCode = store.repCode;
      existing.defaultFrequency = defaultFrequency;
      existing.defaultDuration = defaultDuration;
      existing.frequency = frequency;
      existing.duration = dur;
      existing.updatedAt = now;
      existing.requestedBy = actor;
      existing.requestedAt = now;
      if (autoApproved) {
        existing.approvalStatus = "approved";
        existing.decidedBy = actor;
        existing.decidedAt = now;
      } else {
        existing.approvalStatus = "pending";
        existing.decidedBy = undefined;
        existing.decidedAt = undefined;
      }
      record = existing;
    } else {
      record = {
        id: crypto.randomUUID(),
        storeId,
        storeName: store.name,
        placeId: store.placeId,
        channelId: store.channelId,
        repCode: store.repCode,
        defaultFrequency,
        defaultDuration,
        frequency,
        duration: dur,
        approvalStatus: autoApproved ? "approved" : "pending",
        requestedBy: actor,
        requestedAt: now,
        decidedBy: autoApproved ? actor : undefined,
        decidedAt: autoApproved ? now : undefined,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      };
      overrides.push(record);
    }
    await saveStoreOverrides(overrides);

    logActivity({
      action: "Store call override",
      actor: session.email,
      actorName: actor,
      summary: `${autoApproved ? "Set" : "Submitted"} override on ${store.name}`,
      details: `${frequency}, ${dur}min (channel default: ${defaultFrequency}, ${defaultDuration}min)`,
    });

    return NextResponse.json(record, { headers: noStore });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: noStore });
  }
}

// PATCH — approve a pending override (managers only). Does not change store values.
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
    if (!(await hasManagePerm(session))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore });
    }

    const { id } = (await request.json()) as { id: string };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400, headers: noStore });

    const overrides = await getStoreOverrides();
    const record = overrides.find((o) => o.id === id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });

    record.approvalStatus = "approved";
    record.decidedBy = session.name || session.email;
    record.decidedAt = new Date().toISOString();
    await saveStoreOverrides(overrides);

    logActivity({
      action: "Override approved",
      actor: session.email,
      actorName: session.name || session.email,
      summary: `Approved override on ${record.storeName}`,
    });

    return NextResponse.json(record, { headers: noStore });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: noStore });
  }
}

// DELETE — remove an override and reset the store to its channel default
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400, headers: noStore });

    const overrides = await getStoreOverrides();
    const record = overrides.find((o) => o.id === id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });

    const canManage = await hasManagePerm(session);
    const ownsStore = session.role === "rep" && !!session.repCode && record.repCode === session.repCode;
    if (!canManage && !ownsStore) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore });
    }

    // Reset the store back to the channel default
    const stores = await getStores();
    const store = stores.find((s) => s.id === record.storeId);
    if (store) {
      const channels = await getChannels();
      const channel = channels.find((c) => c.id === store.channelId);
      store.frequency = (channel?.frequency ?? record.defaultFrequency) as FrequencyType;
      store.duration = channel?.duration ?? record.defaultDuration;
      await saveStores(stores);
    }

    await saveStoreOverrides(overrides.filter((o) => o.id !== id));

    logActivity({
      action: "Override removed",
      actor: session.email,
      actorName: session.name || session.email,
      summary: `Reset ${record.storeName} to channel default`,
    });

    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: noStore });
  }
}
