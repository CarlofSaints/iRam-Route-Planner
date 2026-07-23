"use client";

import { useState, useEffect, useRef } from "react";
import { Channel, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel } from "@/lib/types";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Channel>>({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFreq, setNewFreq] = useState<FrequencyType>("monthly");
  const [newDuration, setNewDuration] = useState(30);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        setChannels(data);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const startEdit = (ch: Channel) => {
    setEditing(ch.id);
    setEditData({ name: ch.name, frequency: ch.frequency, duration: ch.duration });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditData({});
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const addChannel = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), frequency: newFreq, duration: newDuration }),
    });
    setNewName("");
    setNewFreq("monthly");
    setNewDuration(30);
    setShowAdd(false);
    setAdding(false);
    load();
  };

  const deleteChannel = async (id: string, name: string) => {
    if (!confirm(`Delete channel "${name}"? This cannot be undone.`)) return;
    await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    load();
  };

  const filtered = channels.filter((ch) =>
    ch.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((ch) => selected.has(ch.id));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((ch) => next.delete(ch.id));
      } else {
        filtered.forEach((ch) => next.add(ch.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} channel${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelected(new Set());
    setBulkDeleting(false);
    load();
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/channels/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ text: data.error || "Import failed", type: "error" });
        return;
      }
      const parts: string[] = [];
      if (data.updated) parts.push(`${data.updated} updated`);
      if (data.created) parts.push(`${data.created} created`);
      if (data.errors?.length) parts.push(`${data.errors.length} error${data.errors.length > 1 ? "s" : ""}`);
      if (!data.updated && !data.created && !data.errors?.length) parts.push("No changes");
      setImportMsg({
        text: parts.join(", ") + (data.errors?.length ? ": " + data.errors.join("; ") : ""),
        type: data.errors?.length && !data.updated && !data.created ? "error" : "success",
      });
      load();
    } catch {
      setImportMsg({ text: "Import failed", type: "error" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Channels</h1>
          <p className="text-sm text-gray-500">
            {channels.length} channels configured
            {search.trim() && ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/channels/export"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export Excel
          </a>
          <label
            className={`px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 cursor-pointer transition-colors ${importing ? "opacity-50 pointer-events-none" : ""}`}
          >
            {importing ? "Importing..." : "Import Excel"}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
              }}
            />
          </label>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2 bg-iram-green text-white text-sm font-medium rounded-lg hover:bg-iram-green-dark transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Channel
          </button>
        </div>
      </div>

      {/* Import message */}
      {importMsg && (
        <div
          className={`p-3 rounded-lg text-sm mb-6 flex items-center justify-between ${
            importMsg.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          <span>{importMsg.text}</span>
          <button onClick={() => setImportMsg(null)} className="text-xs opacity-60 hover:opacity-100 ml-4">dismiss</button>
        </div>
      )}

      {/* Add Channel Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">New Channel</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Channel Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Pick n Pay"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default Frequency</label>
              <select
                value={newFreq}
                onChange={(e) => setNewFreq(e.target.value as FrequencyType)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              >
                {FREQUENCY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
              <input
                type="number"
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                min={5}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={addChannel}
              disabled={adding || !newName.trim()}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {adding ? "Saving..." : "Save Channel"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-gray-500 text-sm font-medium hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search + bulk actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 sm:ml-auto bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-600">{selected.size} selected</span>
            <button
              onClick={deleteSelected}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-iram-green text-white text-xs font-medium rounded-lg hover:bg-iram-green-dark disabled:opacity-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {bulkDeleting ? "Deleting..." : `Delete selected`}
            </button>
            <button
              onClick={clearSelection}
              className="text-gray-400 hover:text-gray-600 text-xs font-medium"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="w-4 h-4 rounded border-gray-300 text-iram-green focus:ring-iram-green cursor-pointer align-middle"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-6 py-3 w-8">#</th>
                <th className="px-6 py-3">Channel Name</th>
                <th className="px-6 py-3">Default Frequency</th>
                <th className="px-6 py-3 text-right">Duration (min)</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((ch, i) => (
                <tr key={ch.id} className={`hover:bg-gray-50 ${selected.has(ch.id) ? "bg-red-50/40" : ""}`}>
                  <td className="px-6 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(ch.id)}
                      onChange={() => toggleOne(ch.id)}
                      className="w-4 h-4 rounded border-gray-300 text-iram-green focus:ring-iram-green cursor-pointer align-middle"
                      aria-label={`Select ${ch.name}`}
                    />
                  </td>
                  <td className="px-6 py-3 text-gray-400">{i + 1}</td>

                  {editing === ch.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={editData.frequency || "monthly"}
                          onChange={(e) => setEditData({ ...editData, frequency: e.target.value as FrequencyType })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        >
                          {FREQUENCY_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          value={editData.duration ?? 30}
                          onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-20 text-right focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button
                          onClick={() => saveEdit(ch.id)}
                          disabled={saving}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-gray-400 hover:text-gray-600 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3 font-medium text-gray-900">{ch.name}</td>
                      <td className="px-6 py-3 text-gray-600">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {getFrequencyLabel(ch.frequency)}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right text-gray-600">{ch.duration} min</td>
                      <td className="px-6 py-3 text-right space-x-3">
                        <button
                          onClick={() => startEdit(ch)}
                          className="text-iram-green hover:text-red-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteChannel(ch.id, ch.name)}
                          className="text-gray-400 hover:text-red-600 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    {channels.length === 0
                      ? 'No channels configured. Click "Add Channel" to create one.'
                      : `No channels match "${search}".`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
