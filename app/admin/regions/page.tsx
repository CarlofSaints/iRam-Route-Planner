"use client";

import { useState, useEffect } from "react";

interface Region {
  id: string;
  name: string;
}

export default function RegionsPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error">("success");

  const showMsg = (text: string, type: "success" | "error" = "success") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 4000);
  };

  const load = async () => {
    try {
      const res = await fetch("/api/regions");
      const data = await res.json();
      setRegions(Array.isArray(data) ? data : []);
    } catch {
      showMsg("Failed to load regions", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addRegion = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (res.ok) {
        showMsg(`Region "${newName.trim()}" added`);
        setNewName("");
        load();
      } else {
        showMsg(data.error || "Failed to add region", "error");
      }
    } catch {
      showMsg("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/regions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: editName }),
      });
      const data = await res.json();
      if (res.ok) {
        showMsg("Region updated");
        setEditing(null);
        load();
      } else {
        showMsg(data.error || "Failed to update", "error");
      }
    } catch {
      showMsg("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteRegion = async (region: Region) => {
    if (!confirm(`Delete region "${region.name}"? Stores assigned to this region will keep their current value until reassigned.`))
      return;
    try {
      const res = await fetch("/api/regions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: region.id }),
      });
      if (res.ok) {
        showMsg(`Region "${region.name}" deleted`);
        load();
      } else {
        showMsg("Failed to delete region", "error");
      }
    } catch {
      showMsg("Network error", "error");
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
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Regions</h1>
        <p className="text-sm text-gray-500">
          Manage regions that can be assigned to stores. {regions.length} region{regions.length !== 1 ? "s" : ""} configured.
        </p>
      </div>

      {msg && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            msgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg}
        </div>
      )}

      {/* Add region */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex items-center gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRegion()}
            placeholder="New region name..."
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          />
          <button
            onClick={addRegion}
            disabled={saving || !newName.trim()}
            className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add Region"}
          </button>
        </div>
      </div>

      {/* Regions list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {regions.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">
            No regions configured. Add your first region above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 text-left">Region Name</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {regions.map((region) => (
                <tr key={region.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    {editing === region.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit(region.id)}
                        className="border border-gray-200 rounded px-2 py-1 text-sm w-full max-w-xs focus:outline-none focus:ring-1 focus:ring-iram-green"
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium text-gray-900">{region.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {editing === region.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => saveEdit(region.id)}
                          disabled={saving}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="text-gray-400 hover:text-gray-600 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditing(region.id);
                            setEditName(region.name);
                          }}
                          className="text-iram-green hover:text-red-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRegion(region)}
                          className="text-gray-400 hover:text-red-600 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
