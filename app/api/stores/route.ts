import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, getStoreOverrides, saveStoreOverrides, getReps } from "@/lib/data";
import { isTeamRole, storeInTeam } from "@/lib/roles";
import { withWriteLock } from "@/lib/writeLock";
import { Store, FrequencyType } from "@/lib/types";
import { getSession, sessionHasPermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { refuseEdit } from "@/lib/editGuard";
import { applyStatus, isClosed } from "@/lib/closedStores";

export async function GET() {
  try {
    const stores = await getStores();
    return NextResponse.json(stores);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await refuseEdit("stores");
  if (denied) return denied;

  try {
    // This route closes stores now, which takes them out of every call cycle,
    // so it can no longer rest on "signed in" alone. Every page that writes
    // here (Stores, Routes, Not in a cycle) is used by roles holding this.
    const caller = await getSession();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await sessionHasPermission(caller, "manage_stores"))) {
      return NextResponse.json({ error: "You do not have permission to edit stores." }, { status: 403 });
    }

    const body = await request.json();
    const { id, ...updates } = body as Partial<Store> & { id: string };

    // A team manager or team admin may change only their own team's stores:
    // one a rep in their team calls on, in any role. Without this, closing a
    // store took any team's shop out of every cycle.
    let teamRepCodes: Set<string> | null = null;
    if (isTeamRole(caller.role)) {
      const reps = await getReps();
      teamRepCodes = new Set(
        caller.teamId ? reps.filter((r) => r.teamId === caller.teamId).map((r) => r.code) : []
      );
    }

    // Read, patch the one named store, write: under the lock, so two quick
    // saves (Save GPS on two rows) cannot each write back a list that is
    // missing the other's change (lib/writeLock.ts).
    const outcome = await withWriteLock("stores", async () => {
      const stores = await getStores();
      const idx = stores.findIndex((s) => s.id === id);
      if (idx === -1) return { status: 404, error: "Not found" } as const;

      if (teamRepCodes) {
        if (!storeInTeam(stores[idx], teamRepCodes)) {
          return { status: 403, error: "That store is not called on by anyone in your team, so your role can't change it." } as const;
        }
        const newRep = (updates.repCode ?? "").trim();
        if (newRep && !teamRepCodes.has(newRep)) {
          return { status: 403, error: `Rep ${newRep} is not in your team, so your role can't allocate this store to them.` } as const;
        }
      }

      // Active/Closed, by hand. Goes through the one helper so a reopened store
      // loses its old reason and date instead of carrying them forever.
      let statusChanged = false;
      if (updates.closed !== undefined) {
        statusChanged = applyStatus(stores[idx], updates.closed === true);
      }

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
      return { stores, idx, statusChanged, divergesFromChannel };
    });
    if ("error" in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    const { stores, idx, statusChanged, divergesFromChannel } = outcome;

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

    logActivity({
      action: statusChanged ? (isClosed(stores[idx]) ? "Closed store" : "Reopened store") : "Updated store",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: statusChanged
        ? `${stores[idx].name} (${stores[idx].placeId}) marked ${isClosed(stores[idx]) ? "Closed: out of every call cycle" : "Active: back in the call cycles"}`
        : `Updated store ${stores[idx].name}`,
    });

    return NextResponse.json(stores[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
