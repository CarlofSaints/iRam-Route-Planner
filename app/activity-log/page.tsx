"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "@/components/SessionProvider";

interface LogEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  actorName: string;
  summary: string;
  details?: string;
}

type SortKey = "timestamp" | "actorName" | "action" | "summary";
type SortDir = "asc" | "desc";

export default function ActivityLogPage() {
  const { session } = useSession();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetch(`/api/logs?month=${month}`)
      .then((r) => r.json())
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [month, session]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        e.actorName.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        (e.details || "").toLowerCase().includes(q)
    );
  }, [entries, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey] || "";
      const bv = b[sortKey] || "";
      const cmp = av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  // Build month options: current month + 11 previous
  const monthOptions: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatMonthLabel(m: string) {
    const [y, mo] = m.split("-");
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return d.toLocaleString("en-ZA", { month: "long", year: "numeric" });
  }

  if (!session || (session.role !== "superAdmin" && session.role !== "admin")) {
    return (
      <div className="p-8">
        <p className="text-gray-500">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Activity Log</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <span className="text-xs text-gray-500">
          {sorted.length} {sorted.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No log entries found.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th
                    onClick={() => toggleSort("timestamp")}
                    className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap"
                  >
                    Time{arrow("timestamp")}
                  </th>
                  <th
                    onClick={() => toggleSort("actorName")}
                    className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap"
                  >
                    User{arrow("actorName")}
                  </th>
                  <th
                    onClick={() => toggleSort("action")}
                    className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap"
                  >
                    Action{arrow("action")}
                  </th>
                  <th
                    onClick={() => toggleSort("summary")}
                    className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                  >
                    Summary{arrow("summary")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((e) => (
                  <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                      {formatTime(e.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-medium text-gray-800">{e.actorName}</span>
                      <span className="text-gray-400 text-xs ml-1">({e.actor})</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
