"use client";

import { useState, useEffect } from "react";
import { CallCycleType, CallCycleStrategy } from "@/lib/types";

const STRATEGY_LABELS: Record<CallCycleStrategy, string> = {
  channel_dedicated: "Channel Dedicated",
  geography: "Geography",
};

const STRATEGY_COLORS: Record<CallCycleStrategy, { bg: string; text: string; border: string; dot: string }> = {
  channel_dedicated: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
  geography: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
};

const STRATEGY_ICONS: Record<CallCycleStrategy, string> = {
  channel_dedicated: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  geography: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
};

const STRATEGY_CONFIG_LINKS: Record<CallCycleStrategy, { href: string; label: string }[]> = {
  channel_dedicated: [{ href: "/admin/rep-channels", label: "Configure Channel Map" }],
  geography: [],
};

export default function CallCycleTypesPage() {
  const [types, setTypes] = useState<CallCycleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState({ name: "", strategy: "" as CallCycleStrategy, description: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error" | "info">("info");
  const [activating, setActivating] = useState<string | null>(null);

  const showMsg = (text: string, type: "success" | "error" | "info" = "info") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 5000);
  };

  const load = async () => {
    try {
      const res = await fetch("/api/call-cycle-types");
      const data: CallCycleType[] = await res.json();
      setTypes(data);
    } catch {
      showMsg("Failed to load call cycle types", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addType = async () => {
    if (!newType.name || !newType.strategy) {
      showMsg("Name and strategy are required", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/call-cycle-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newType),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error || "Failed to create", "error");
      } else {
        showMsg(`"${data.name}" created`, "success");
        setShowAdd(false);
        setNewType({ name: "", strategy: "" as CallCycleStrategy, description: "" });
        load();
      }
    } catch {
      showMsg("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (id: string) => {
    setActivating(id);
    try {
      const res = await fetch("/api/call-cycle-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: true }),
      });
      if (res.ok) {
        const data: CallCycleType[] = await res.json();
        setTypes(data);
        const activated = data.find((t) => t.id === id);
        showMsg(`"${activated?.name}" is now the active call cycle type`, "success");
      } else {
        showMsg("Failed to activate", "error");
      }
    } catch {
      showMsg("Network error", "error");
    } finally {
      setActivating(null);
    }
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/call-cycle-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editData }),
      });
      if (res.ok) {
        const data: CallCycleType[] = await res.json();
        setTypes(data);
        setEditing(null);
        showMsg("Updated", "success");
      } else {
        showMsg("Failed to update", "error");
      }
    } catch {
      showMsg("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteType = async (t: CallCycleType) => {
    if (t.active) {
      showMsg("Cannot delete the active call cycle type — switch to another first", "error");
      return;
    }
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      const res = await fetch("/api/call-cycle-types", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      if (res.ok) {
        showMsg(`"${t.name}" deleted`, "success");
        load();
      } else {
        showMsg("Failed to delete", "error");
      }
    } catch {
      showMsg("Network error", "error");
    }
  };

  const activeType = types.find((t) => t.active);
  const usedStrategies = types.map((t) => t.strategy);
  const availableStrategies = (Object.keys(STRATEGY_LABELS) as CallCycleStrategy[]).filter(
    (s) => !usedStrategies.includes(s)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Call Cycle Types</h1>
          <p className="text-sm text-gray-500">
            {activeType
              ? <>Active: <span className="font-medium text-gray-700">{activeType.name}</span></>
              : "No active type selected — choose one to configure route generation"}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          disabled={availableStrategies.length === 0}
          className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Add Type
        </button>
      </div>

      {/* Active strategy config banner */}
      {activeType && STRATEGY_CONFIG_LINKS[activeType.strategy]?.length > 0 && (
        <div className={`p-4 rounded-lg border ${STRATEGY_COLORS[activeType.strategy].border} ${STRATEGY_COLORS[activeType.strategy].bg} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <svg className={`w-5 h-5 ${STRATEGY_COLORS[activeType.strategy].text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className={`text-sm font-medium ${STRATEGY_COLORS[activeType.strategy].text}`}>
              {activeType.name} is active — configure its settings:
            </span>
          </div>
          <div className="flex gap-2">
            {STRATEGY_CONFIG_LINKS[activeType.strategy].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${STRATEGY_COLORS[activeType.strategy].text} hover:opacity-80 bg-white/60`}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {msg && (
        <div className={`p-3 rounded-lg text-sm ${
          msgType === "success" ? "bg-green-50 text-green-700" :
          msgType === "error" ? "bg-red-50 text-red-700" :
          "bg-blue-50 text-blue-700"
        }`}>
          {msg}
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">New Call Cycle Type</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                value={newType.name}
                onChange={(e) => setNewType({ ...newType, name: e.target.value })}
                placeholder="e.g. Channel Dedicated"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Strategy</label>
              <select
                value={newType.strategy}
                onChange={(e) => setNewType({ ...newType, strategy: e.target.value as CallCycleStrategy })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              >
                <option value="">Select strategy...</option>
                {availableStrategies.map((s) => (
                  <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <textarea
                value={newType.description}
                onChange={(e) => setNewType({ ...newType, description: e.target.value })}
                rows={2}
                placeholder="Describe how this call cycle type affects rep routing..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green resize-none"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={addType} disabled={saving} className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50">
              {saving ? "Creating..." : "Create Type"}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {types.map((t) => {
          const colors = STRATEGY_COLORS[t.strategy] || STRATEGY_COLORS.channel_dedicated;
          const icon = STRATEGY_ICONS[t.strategy] || STRATEGY_ICONS.channel_dedicated;
          const isEditing = editing === t.id;

          return (
            <div
              key={t.id}
              className={`relative bg-white rounded-xl shadow-sm border-2 transition-all ${
                t.active ? `${colors.border} ring-2 ring-offset-1 ring-${colors.dot.replace("bg-", "")}` : "border-gray-100"
              }`}
            >
              {/* Active badge */}
              {t.active && (
                <div className={`absolute -top-2.5 left-4 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${colors.bg} ${colors.text}`}>
                  Active
                </div>
              )}

              <div className="p-6">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0`}>
                    <svg className={`w-6 h-6 ${colors.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                    </svg>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          value={editData.name}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                        <textarea
                          value={editData.description}
                          onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                          rows={2}
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(t.id)}
                            disabled={saving}
                            className="text-green-600 hover:text-green-800 text-xs font-medium px-3 py-1 rounded hover:bg-green-50"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="text-gray-400 hover:text-gray-600 text-xs font-medium px-3 py-1 rounded hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900">{t.name}</h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.bg} ${colors.text}`}>
                            {STRATEGY_LABELS[t.strategy]}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 leading-relaxed">{t.description}</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Config links */}
                {!isEditing && STRATEGY_CONFIG_LINKS[t.strategy]?.length > 0 && (
                  <div className={`mt-3 flex flex-wrap gap-2 ${t.active ? "" : "opacity-60"}`}>
                    {STRATEGY_CONFIG_LINKS[t.strategy].map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${colors.bg} ${colors.text} hover:opacity-80`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}

                {/* Actions */}
                {!isEditing && (
                  <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <button
                      onClick={() => setActive(t.id)}
                      disabled={t.active || activating === t.id}
                      className={`text-sm font-medium px-4 py-1.5 rounded-lg transition-colors ${
                        t.active
                          ? "bg-gray-100 text-gray-400 cursor-default"
                          : "bg-iram-green/10 text-iram-green hover:bg-iram-green/20"
                      }`}
                    >
                      {activating === t.id ? (
                        <span className="flex items-center gap-2">
                          <span className="inline-block w-3 h-3 border border-iram-green border-t-transparent rounded-full animate-spin" />
                          Activating...
                        </span>
                      ) : t.active ? (
                        "Currently Active"
                      ) : (
                        "Set as Active"
                      )}
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditing(t.id); setEditData({ name: t.name, description: t.description }); }}
                        className="text-iram-green hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteType(t)}
                        className="text-gray-400 hover:text-red-600 text-xs font-medium px-2 py-1 rounded hover:bg-gray-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {types.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-500 text-sm">No call cycle types configured. Add one to get started.</p>
        </div>
      )}

      {/* Info section */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-700 text-sm mb-3">How Call Cycle Types Work</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STRATEGY_COLORS.channel_dedicated.dot}`} />
            <div><span className="font-medium text-gray-700">Channel Dedicated</span> — Reps are assigned to specific channels and only visit stores within those channels in their region.</div>
          </div>
          <div className="flex items-start gap-2">
            <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STRATEGY_COLORS.geography.dot}`} />
            <div><span className="font-medium text-gray-700">Geography</span> — Reps call on every store allocated to them; the app clusters those stores geographically into the most efficient daily route, limited by daily capacity.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
