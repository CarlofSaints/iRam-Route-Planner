"use client";

import { useState, useEffect } from "react";
import { VisitRole, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel } from "@/lib/types";

export default function VisitRolesPage() {
  const [roles, setRoles] = useState<VisitRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<VisitRole>>({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFreq, setNewFreq] = useState<FrequencyType>("quarterly");
  const [newDuration, setNewDuration] = useState(60);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/visit-roles")
      .then((r) => r.json())
      .then((data) => {
        setRoles(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const startEdit = (role: VisitRole) => {
    setEditing(role.id);
    setEditData({ name: role.name, frequency: role.frequency, duration: role.duration, checkOutliers: role.checkOutliers });
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/visit-roles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    if (!res.ok) setError((await res.json()).error || "Could not save");
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const addRole = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    const res = await fetch("/api/visit-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), frequency: newFreq, duration: newDuration }),
    });
    if (!res.ok) setError((await res.json()).error || "Could not add role");
    else {
      setNewName("");
      setNewFreq("quarterly");
      setNewDuration(60);
      setShowAdd(false);
    }
    setAdding(false);
    load();
  };

  const deleteRole = async (id: string, name: string) => {
    if (!confirm(`Delete visit role "${name}"?`)) return;
    setError(null);
    const res = await fetch("/api/visit-roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) setError((await res.json()).error || "Could not delete role");
    load();
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Visit Roles</h1>
          <p className="text-sm text-gray-500 max-w-2xl">
            A visit role is the kind of call a person makes. The primary sales rep visits at each
            store&apos;s own channel frequency. Higher-level roles — QC, training — are linked to a store
            as its secondary or third rep, and call on their own rhythm for their own length of time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="shrink-0 px-3 py-2 text-sm font-medium text-white bg-iram-green hover:bg-iram-green-dark rounded-lg transition-colors"
        >
          Add Role
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-amber-50 text-amber-700 border border-amber-200">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Role name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Merchandising"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Frequency</label>
            <select
              value={newFreq}
              onChange={(e) => setNewFreq(e.target.value as FrequencyType)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
            >
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Minutes/visit</label>
            <input
              type="number"
              min={5}
              value={newDuration}
              onChange={(e) => setNewDuration(Number(e.target.value))}
              className="w-28 px-3 py-2 text-sm border border-gray-300 rounded-lg"
            />
          </div>
          <button
            type="button"
            onClick={addRole}
            disabled={adding || !newName.trim()}
            className="px-3 py-2 text-sm font-medium text-white bg-iram-green hover:bg-iram-green-dark rounded-lg disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Frequency</th>
              <th className="px-4 py-3 font-medium">Minutes</th>
              <th className="px-4 py-3 font-medium">Range check</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {roles.map((role) => {
              const isEditing = editing === role.id;
              return (
                <tr key={role.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        value={editData.name ?? ""}
                        onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{role.name}</span>
                        {role.isPrimary && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-iram-green/10 text-iram-green-dark border border-iram-green/20">
                            PRIMARY
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {role.isPrimary ? (
                      <span className="text-gray-400 italic">From the store&apos;s channel</span>
                    ) : isEditing ? (
                      <select
                        value={editData.frequency ?? role.frequency}
                        onChange={(e) => setEditData({ ...editData, frequency: e.target.value as FrequencyType })}
                        className="px-2 py-1 text-sm border border-gray-300 rounded"
                      >
                        {FREQUENCY_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    ) : (
                      getFrequencyLabel(role.frequency)
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {role.isPrimary ? (
                      <span className="text-gray-400 italic">Per store</span>
                    ) : isEditing ? (
                      <input
                        type="number"
                        min={5}
                        value={editData.duration ?? role.duration}
                        onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                        className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                      />
                    ) : (
                      role.duration
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={editData.checkOutliers ?? role.checkOutliers}
                          onChange={(e) => setEditData({ ...editData, checkOutliers: e.target.checked })}
                        />
                        Flag out-of-range stores
                      </label>
                    ) : (
                      <span className={role.checkOutliers ? "text-gray-600" : "text-gray-400"}>
                        {role.checkOutliers ? "On" : "Off"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => saveEdit(role.id)}
                          disabled={saving}
                          className="text-xs font-medium text-iram-green-dark hover:underline mr-3 disabled:opacity-50"
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => { setEditing(null); setEditData({}); }}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(role)}
                          className="text-xs font-medium text-gray-600 hover:underline mr-3"
                        >
                          Edit
                        </button>
                        {!role.isPrimary && (
                          <button
                            onClick={() => deleteRole(role.id, role.name)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Range check is off by default for higher-level roles — someone covering a whole province is
        not misallocated, and flagging their stores would bury the genuine sales-rep exceptions.
        Assign a person to a role on the Reps page.
      </p>
    </div>
  );
}
