"use client";

import { useState, useEffect } from "react";

interface DupRecord {
  id: string;
  placeId: string;
  channel: string;
  gpsLat: string;
  gpsLng: string;
  keep: boolean;
}
interface DupGroup {
  key: string;
  storeName: string;
  repCode: string;
  keepId: string;
  records: DupRecord[];
}
interface DupResponse {
  totalStores: number;
  groupCount: number;
  removableCount: number;
  groups: DupGroup[];
}

export default function DuplicatesPage() {
  const [data, setData] = useState<DupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/stores/duplicates")
      .then((r) => r.json())
      .then((d) => setData(d && "groups" in d ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const apply = async () => {
    if (!data?.removableCount) return;
    if (!confirm(`Remove ${data.removableCount} duplicate store records? The best record in each group is kept. This cannot be undone.`)) return;
    setApplying(true);
    setMsg(null);
    try {
      const res = await fetch("/api/stores/duplicates", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setMsg({ text: `Removed ${d.removed} duplicate records. ${d.remaining} stores remain. Regenerate routes to refresh capacity.`, type: "success" });
      load();
    } catch (err) {
      setMsg({ text: `Failed: ${String(err)}`, type: "error" });
    } finally {
      setApplying(false);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Duplicate Stores</h1>
          <p className="text-sm text-gray-500">
            Store records that share the same name and rep — likely the same physical store uploaded more than once.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {data && data.groupCount > 0 && (
            <a
              href="/api/stores/duplicates/export"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 flex items-center gap-2"
              title="Export the full duplicate list with the real geocoded location of each coordinate — to send to the client to fix at source"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export for client
            </a>
          )}
          {data && data.removableCount > 0 && (
            <button
              onClick={apply}
              disabled={applying}
              className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
            >
              {applying ? "Removing..." : `Remove ${data.removableCount} here`}
            </button>
          )}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 text-xs text-blue-800">
        Deleting duplicates here only cleans <span className="font-medium">this</span> copy — a fresh client upload would reintroduce them. Use <span className="font-medium">Export for client</span> to send the full list (with each coordinate&apos;s real geocoded location) back to the client so they can fix the source data.
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm mb-6 ${msg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Total stores", value: data?.totalStores ?? 0 },
          { label: "Duplicate groups", value: data?.groupCount ?? 0 },
          { label: "Removable records", value: data?.removableCount ?? 0, tone: (data?.removableCount ?? 0) > 0 ? "text-orange-600" : "text-gray-900" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold ${c.tone || "text-gray-900"}`}>{c.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {data && data.groupCount === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400 text-sm">
          No duplicate stores found. 🎉
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 px-4 pt-4">
            Preview — the record marked <span className="text-green-700 font-medium">KEEP</span> (best GPS / channel) stays; the rest are removed on apply.
          </p>
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-3 py-2">Store</th>
                  <th className="px-3 py-2">Rep</th>
                  <th className="px-3 py-2">Place ID</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">GPS</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.groups.flatMap((g) =>
                  g.records.map((r, idx) => (
                    <tr key={r.id} className={r.keep ? "bg-green-50/40" : ""}>
                      <td className="px-3 py-2 font-medium text-gray-900">{idx === 0 ? g.storeName : ""}</td>
                      <td className="px-3 py-2 text-gray-500">{idx === 0 ? g.repCode : ""}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.placeId}</td>
                      <td className="px-3 py-2 text-gray-600">{r.channel}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.gpsLat}, {r.gpsLng}</td>
                      <td className="px-3 py-2 text-center">
                        {r.keep ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">KEEP</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600">remove</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
