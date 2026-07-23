"use client";

import { useState, useEffect } from "react";
import { Rep } from "@/lib/types";

export default function RepsPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Rep>>({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newRep, setNewRep] = useState<Partial<Rep>>({ code: "", name: "", email: "", cell: "", homeAddress: "", workingHoursPerDay: 8.5 });
  const [error, setError] = useState("");

  const load = () => {
    fetch("/api/reps")
      .then((r) => r.json())
      .then((data) => {
        setReps(data);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const startEdit = (rep: Rep) => {
    setEditing(rep.id);
    setEditData({ ...rep });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditData({});
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/reps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const addRep = async () => {
    setSaving(true);
    setError("");
    const res = await fetch("/api/reps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRep),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to add rep");
      setSaving(false);
      return;
    }
    setShowAdd(false);
    setNewRep({ code: "", name: "", email: "", cell: "", homeAddress: "", workingHoursPerDay: 8.5 });
    setSaving(false);
    load();
  };

  const deleteRep = async (id: string) => {
    if (!confirm("Delete this rep?")) return;
    await fetch("/api/reps", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
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
          <h1 className="text-xl font-bold text-gray-900">Sales Reps</h1>
          <p className="text-sm text-gray-500">{reps.length} reps</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/reps/export?format=xlsx"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export Excel
          </a>
          <a
            href="/api/reps/export?format=csv"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export CSV
          </a>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark transition-colors"
          >
            + Add Rep
          </button>
        </div>
      </div>

      {/* Add Rep Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">New Rep</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "code", label: "Rep Code", placeholder: "e.g. GAU099" },
              { key: "name", label: "Full Name", placeholder: "Name Surname" },
              { key: "email", label: "Email", placeholder: "email@company.com" },
              { key: "cell", label: "Cell Number", placeholder: "+27..." },
              { key: "homeAddress", label: "Home Address", placeholder: "Street, City" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  value={(newRep as Record<string, string>)[key] || ""}
                  onChange={(e) => setNewRep({ ...newRep, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hours/Day</label>
              <input
                type="number"
                step={0.5}
                min={4}
                max={12}
                value={newRep.workingHoursPerDay ?? 8.5}
                onChange={(e) => setNewRep({ ...newRep, workingHoursPerDay: parseFloat(e.target.value) || 8.5 })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
          </div>
          {error && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={addRep}
              disabled={saving}
              className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Rep"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setError(""); }}
              className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reps Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Cell</th>
                <th className="px-6 py-3">Home Address</th>
                <th className="px-6 py-3 text-center">Hours/Day</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reps.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50">
                  {editing === rep.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.code || ""}
                          onChange={(e) => setEditData({ ...editData, code: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.email || ""}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.cell || ""}
                          onChange={(e) => setEditData({ ...editData, cell: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.homeAddress || ""}
                          onChange={(e) => setEditData({ ...editData, homeAddress: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3 text-center">
                        <input
                          type="number"
                          step={0.5}
                          min={4}
                          max={12}
                          value={editData.workingHoursPerDay ?? 8.5}
                          onChange={(e) => setEditData({ ...editData, workingHoursPerDay: parseFloat(e.target.value) || 8.5 })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-16 text-center focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => saveEdit(rep.id)} disabled={saving} className="text-green-600 hover:text-green-800 text-xs font-medium">
                          Save
                        </button>
                        <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 text-xs font-medium">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-100 text-gray-700">
                          {rep.code}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-medium text-gray-900">{rep.name}</td>
                      <td className="px-6 py-3 text-gray-600">{rep.email || <span className="text-gray-300 italic">Not set</span>}</td>
                      <td className="px-6 py-3 text-gray-600">{rep.cell || <span className="text-gray-300 italic">Not set</span>}</td>
                      <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{rep.homeAddress || <span className="text-gray-300 italic">Not set</span>}</td>
                      <td className="px-6 py-3 text-center text-gray-600">{rep.workingHoursPerDay ?? 8.5}</td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => startEdit(rep)} className="text-iram-green hover:text-red-800 text-xs font-medium">
                          Edit
                        </button>
                        <button onClick={() => deleteRep(rep.id)} className="text-gray-400 hover:text-red-600 text-xs font-medium">
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
