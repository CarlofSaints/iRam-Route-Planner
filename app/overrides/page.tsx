"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Store,
  Channel,
  StoreOverride,
  FREQUENCY_OPTIONS,
  FrequencyType,
  getFrequencyLabel,
  OverrideApprovalStatus,
} from "@/lib/types";

interface Meta {
  canManage: boolean;
  role: string;
  repCode: string | null;
}

const STATUS_BADGE: Record<OverrideApprovalStatus, { label: string; cls: string }> = {
  pending: { label: "Not yet approved", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved by manager", cls: "bg-emerald-100 text-emerald-700" },
};

export default function OverridesPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [overrides, setOverrides] = useState<StoreOverride[]>([]);
  const [meta, setMeta] = useState<Meta>({ canManage: false, role: "", repCode: null });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; type: "ok" | "error" } | null>(null);

  // editor state
  const [channelId, setChannelId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [editFreq, setEditFreq] = useState<FrequencyType>("monthly");
  const [editDur, setEditDur] = useState<number>(30);
  const [saving, setSaving] = useState(false);

  const showMsg = (text: string, type: "ok" | "error") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  };

  const loadOverrides = async () => {
    const res = await fetch("/api/store-overrides", { cache: "no-store" });
    const data = await res.json();
    setOverrides(Array.isArray(data.overrides) ? data.overrides : []);
    setMeta({ canManage: !!data.canManage, role: data.role || "", repCode: data.repCode ?? null });
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/stores", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
      fetch("/api/channels", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
      fetch("/api/store-overrides", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]).then(([st, ch, ov]) => {
      setStores(Array.isArray(st) ? st : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setOverrides(Array.isArray(ov.overrides) ? ov.overrides : []);
      setMeta({ canManage: !!ov.canManage, role: ov.role || "", repCode: ov.repCode ?? null });
      setLoading(false);
    });
  }, []);

  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const overrideByStore = useMemo(
    () => new Map(overrides.map((o) => [o.storeId, o])),
    [overrides]
  );

  // Reps without manage permission only see/edit their own stores
  const ownScope = !meta.canManage && meta.role === "rep";
  const scopedStores = useMemo(
    () => (ownScope ? stores.filter((s) => s.repCode && s.repCode === meta.repCode) : stores),
    [stores, ownScope, meta.repCode]
  );

  const matchingStores = useMemo(() => {
    if (!channelId) return [];
    const q = search.trim().toLowerCase();
    return scopedStores
      .filter((s) => s.channelId === channelId)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.placeId.toLowerCase().includes(q))
      .slice(0, 50);
  }, [scopedStores, channelId, search]);

  const selectedStore = stores.find((s) => s.id === selectedStoreId) || null;
  const selectedChannel = selectedStore ? channelMap.get(selectedStore.channelId) : null;

  const pickStore = (s: Store) => {
    setSelectedStoreId(s.id);
    setEditFreq(s.frequency);
    setEditDur(s.duration);
  };

  const save = async () => {
    if (!selectedStore) return;
    setSaving(true);
    try {
      const res = await fetch("/api/store-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStore.id,
          frequency: editFreq,
          duration: Number(editDur),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }
      // reflect new value locally
      setStores((prev) =>
        prev.map((s) => (s.id === selectedStore.id ? { ...s, frequency: editFreq, duration: Number(editDur) } : s))
      );
      await loadOverrides();
      showMsg(
        meta.canManage ? "Override saved." : "Override saved — sent to your manager for approval.",
        "ok"
      );
    } catch (err) {
      showMsg(String(err instanceof Error ? err.message : err), "error");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async (o: StoreOverride) => {
    if (!confirm(`Reset ${o.storeName} back to its channel default?`)) return;
    try {
      const res = await fetch(`/api/store-overrides?id=${encodeURIComponent(o.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Reset failed");
      setStores((prev) =>
        prev.map((s) =>
          s.id === o.storeId ? { ...s, frequency: o.defaultFrequency, duration: o.defaultDuration } : s
        )
      );
      if (selectedStoreId === o.storeId) {
        setEditFreq(o.defaultFrequency);
        setEditDur(o.defaultDuration);
      }
      await loadOverrides();
      showMsg("Reset to channel default.", "ok");
    } catch (err) {
      showMsg(String(err instanceof Error ? err.message : err), "error");
    }
  };

  const approve = async (o: StoreOverride) => {
    try {
      const res = await fetch("/api/store-overrides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id }),
      });
      if (!res.ok) throw new Error("Approve failed");
      await loadOverrides();
      showMsg("Override approved.", "ok");
    } catch (err) {
      showMsg(String(err instanceof Error ? err.message : err), "error");
    }
  };

  const pending = useMemo(
    () => overrides.filter((o) => o.approvalStatus === "pending"),
    [overrides]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  const selectedOverride = selectedStore ? overrideByStore.get(selectedStore.id) : undefined;
  const isDirty =
    selectedStore && (editFreq !== selectedStore.frequency || Number(editDur) !== selectedStore.duration);

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Call Frequency Overrides</h1>
        <p className="text-sm text-gray-500">
          Stores default to their channel&apos;s call frequency &amp; duration. Override a single store below — the change
          applies immediately and is sent for manager approval.{" "}
          {meta.canManage ? "As a manager, your changes are auto-approved and you can approve others below." : ""}
        </p>
      </div>

      {msg && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Manager: pending approvals */}
      {meta.canManage && pending.length > 0 && (
        <div className="mb-6 bg-white rounded-xl border border-amber-200 shadow-sm">
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 rounded-t-xl">
            <h2 className="text-sm font-semibold text-amber-800">
              {pending.length} override{pending.length > 1 ? "s" : ""} awaiting your approval
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {pending.map((o) => (
              <div key={o.id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{o.storeName}</p>
                  <p className="text-xs text-gray-500">
                    {getFrequencyLabel(o.frequency)} · {o.duration}min
                    <span className="text-gray-400"> (default {getFrequencyLabel(o.defaultFrequency)} · {o.defaultDuration}min)</span>
                    {o.requestedBy && <> · requested by {o.requestedBy}</>}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => approve(o)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">1. Channel</label>
            <select
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                setSelectedStoreId("");
                setSearch("");
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            >
              <option value="">Select a channel...</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — default {getFrequencyLabel(c.frequency)}, {c.duration}min
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">2. Search store</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!channelId}
              placeholder={channelId ? "Store name or ID..." : "Pick a channel first"}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green disabled:bg-gray-50"
            />
          </div>
        </div>

        {channelId && (
          <div className="mb-4 max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
            {matchingStores.length === 0 ? (
              <p className="text-sm text-gray-400 px-3 py-3">No stores match.</p>
            ) : (
              matchingStores.map((s) => {
                const ov = overrideByStore.get(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => pickStore(s)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 hover:bg-gray-50 ${
                      selectedStoreId === s.id ? "bg-red-50" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-gray-800">{s.name}</span>
                      <span className="text-gray-400"> · {s.placeId}</span>
                    </span>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {getFrequencyLabel(s.frequency)} · {s.duration}min
                      {ov && (
                        <span className={`ml-2 px-1.5 py-0.5 rounded ${STATUS_BADGE[ov.approvalStatus].cls}`}>
                          {STATUS_BADGE[ov.approvalStatus].label}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {selectedStore && (
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">{selectedStore.name}</h3>
              {selectedChannel && (
                <p className="text-xs text-gray-400">
                  Channel default: {getFrequencyLabel(selectedChannel.frequency)} · {selectedChannel.duration}min
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Frequency</label>
                <select
                  value={editFreq}
                  onChange={(e) => setEditFreq(e.target.value as FrequencyType)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                >
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Duration (minutes)</label>
                <input
                  type="number"
                  min={1}
                  value={editDur}
                  onChange={(e) => setEditDur(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                />
              </div>
            </div>
            {!meta.canManage && (
              <p className="text-xs text-gray-400 mb-4">
                Saving applies the change immediately and sends it to your manager for approval.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving || !isDirty}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-iram-green text-white hover:opacity-90 disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save override"}
              </button>
              {selectedOverride && (
                <button
                  onClick={() => resetToDefault(selectedOverride)}
                  className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  Reset to channel default
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Existing overrides */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            Stores overriding the channel default ({overrides.length})
          </h2>
        </div>
        {overrides.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 py-6">No overrides yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Store</th>
                  <th className="text-left px-4 py-2 font-medium">Override</th>
                  <th className="text-left px-4 py-2 font-medium">Channel default</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {overrides.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-800">{o.storeName}</div>
                      <div className="text-xs text-gray-400">{channelMap.get(o.channelId)?.name || o.channelId}</div>
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {getFrequencyLabel(o.frequency)} · {o.duration}min
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {getFrequencyLabel(o.defaultFrequency)} · {o.defaultDuration}min
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGE[o.approvalStatus].cls}`}>
                        {STATUS_BADGE[o.approvalStatus].label}
                      </span>
                      {o.approvalStatus === "approved" && o.decidedBy && (
                        <span className="block text-[10px] text-gray-400 mt-0.5">by {o.decidedBy}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {meta.canManage && o.approvalStatus === "pending" && (
                        <button
                          onClick={() => approve(o)}
                          className="text-xs font-medium text-emerald-600 hover:underline mr-3"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => resetToDefault(o)}
                        className="text-xs font-medium text-iram-green hover:underline"
                      >
                        Reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
