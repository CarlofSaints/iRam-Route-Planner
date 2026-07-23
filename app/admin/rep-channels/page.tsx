"use client";

import { useState, useEffect, useCallback } from "react";

interface Channel {
  id: string;
  name: string;
}

interface Rep {
  id: string;
  code: string;
  name: string;
  assignedChannels?: string[];
}

export default function RepChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error">("success");

  // Local editable state: repId → Set of channelIds
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [dirty, setDirty] = useState(false);

  const showMsg = (text: string, type: "success" | "error" = "success") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 5000);
  };

  const load = useCallback(async () => {
    try {
      const [chRes, repRes] = await Promise.all([
        fetch("/api/channels"),
        fetch("/api/reps"),
      ]);
      const chData: Channel[] = await chRes.json();
      const repData: Rep[] = await repRes.json();
      setChannels(chData);
      setReps(repData);

      // Build matrix from current rep data
      const m: Record<string, Set<string>> = {};
      for (const r of repData) {
        m[r.id] = new Set(r.assignedChannels || []);
      }
      setMatrix(m);
      setDirty(false);
    } catch {
      showMsg("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (repId: string, channelId: string) => {
    setMatrix((prev) => {
      const next = { ...prev };
      const s = new Set(next[repId] || []);
      if (s.has(channelId)) {
        s.delete(channelId);
      } else {
        s.add(channelId);
      }
      next[repId] = s;
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Save each rep's assignedChannels
      const updates = reps.map((r) =>
        fetch("/api/reps", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: r.id,
            assignedChannels: Array.from(matrix[r.id] || []),
          }),
        })
      );
      await Promise.all(updates);
      setDirty(false);
      showMsg("Channel assignments saved");
    } catch {
      showMsg("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  if (channels.length === 0 || reps.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Channel Map</h1>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-500 text-sm">
            {channels.length === 0 && reps.length === 0
              ? "No channels or reps found. Create channels and reps first."
              : channels.length === 0
                ? "No channels found. Create channels first."
                : "No reps found. Create reps first."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Channel Map</h1>
          <p className="text-sm text-gray-500">
            Assign channels to reps for the Channel Dedicated strategy
          </p>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <button
              onClick={load}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50"
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 bg-iram-green text-white rounded-lg text-xs font-medium hover:bg-iram-green-dark disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      {msg && (
        <div
          className={`p-3 rounded-lg text-sm ${
            msgType === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {msg}
        </div>
      )}

      {/* Matrix */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 text-left sticky left-0 bg-gray-50 z-30">
                  Rep
                </th>
                {channels.map((ch) => (
                  <th key={ch.id} className="px-4 py-3 text-center min-w-[100px] bg-gray-50">
                    {ch.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reps.map((rep) => {
                const assigned = matrix[rep.id] || new Set();
                return (
                  <tr key={rep.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 sticky left-0 bg-white z-10">
                      <div className="font-medium text-gray-900">{rep.name}</div>
                      <div className="text-xs text-gray-400">{rep.code}</div>
                    </td>
                    {channels.map((ch) => {
                      const has = assigned.has(ch.id);
                      return (
                        <td key={ch.id} className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggle(rep.id, ch.id)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors cursor-pointer hover:bg-gray-100"
                          >
                            {has ? (
                              <svg
                                className="w-5 h-5 text-green-500"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            ) : (
                              <svg
                                className="w-5 h-5 text-gray-300"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-500">
          {reps.length} reps, {channels.length} channels.{" "}
          {dirty && <span className="text-amber-600 font-medium">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}
