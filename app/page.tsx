"use client";

import { useState, useEffect, useMemo } from "react";
import { Channel, Rep, Store, Team, PerigeeVisit } from "@/lib/types";

type SortDir = "asc" | "desc";

/** Perigee reports a free-text call status; anything not "completed" is a partial call. */
function isCompletedVisit(v: PerigeeVisit): boolean {
  return v.status.trim().toLowerCase().startsWith("complete");
}

function useSortable<T>(data: T[], defaultKey: string, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, onToggle: toggle };
}

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onToggle,
  align = "left",
}: {
  label: string;
  field: string;
  sortKey: string;
  sortDir: SortDir;
  onToggle: (k: string) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === field;
  return (
    <th
      className={`px-6 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={() => onToggle(field)}
    >
      <span className="inline-flex items-center gap-1">
        {align === "right" && active && (
          <span className="text-iram-green">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
        )}
        <span>{label}</span>
        {align === "left" && active && (
          <span className="text-iram-green">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
        )}
      </span>
    </th>
  );
}

export default function DashboardPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [visits, setVisits] = useState<PerigeeVisit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Current month date range for visit filtering
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;

    Promise.all([
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
      fetch(`/api/perigee/visits?from=${from}&to=${to}`).then((r) => r.json()).catch(() => []),
    ]).then(([ch, rp, st, tm, vs]) => {
      setChannels(Array.isArray(ch) ? ch : []);
      setReps(Array.isArray(rp) ? rp : []);
      setStores(Array.isArray(st) ? st : []);
      setTeams(Array.isArray(tm) ? tm : []);
      setVisits(Array.isArray(vs) ? vs : []);
      setLoading(false);
    });
  }, []);

  const totalRevenue = useMemo(() => stores.reduce((s, st) => s + (st.monthlySales ?? 0), 0), [stores]);

  // Visit metrics
  const totalVisits = visits.length;
  const completedVisits = useMemo(() => visits.filter((v) => isCompletedVisit(v)).length, [visits]);
  const incompleteVisits = useMemo(() => visits.filter((v) => !isCompletedVisit(v)).length, [visits]);
  // Unique stores visited this month
  const storesVisited = useMemo(() => new Set(visits.map((v) => v.storeCode)).size, [visits]);

  const teamStats = useMemo(() => {
    return teams.map((team) => {
      const teamReps = reps.filter((r) => r.teamId === team.id);
      const teamRepCodes = new Set(teamReps.map((r) => r.code));
      const teamStores = stores.filter((s) => teamRepCodes.has(s.repCode));
      const revenue = teamStores.reduce((s, st) => s + (st.monthlySales ?? 0), 0);
      const channelIds = new Set(teamStores.map((s) => s.channelId));
      const teamVisits = visits.filter((v) => teamRepCodes.has(v.repCode));
      const teamCompleted = teamVisits.filter((v) => isCompletedVisit(v)).length;
      const teamIncomplete = teamVisits.filter((v) => !isCompletedVisit(v)).length;
      return {
        ...team,
        repCount: teamReps.length,
        storeCount: teamStores.length,
        channelCount: channelIds.size,
        revenue,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        visitCount: teamVisits.length,
        completed: teamCompleted,
        incomplete: teamIncomplete,
      };
    });
  }, [teams, reps, stores, visits, totalRevenue]);

  const channelStats = useMemo(() => {
    return channels.map((ch) => {
      const chStores = stores.filter((s) => s.channelId === ch.id);
      const revenue = chStores.reduce((s, st) => s + (st.monthlySales ?? 0), 0);
      const repCodes = new Set(chStores.map((s) => s.repCode));
      return {
        ...ch,
        storeCount: chStores.length,
        revenue,
        repCount: repCodes.size,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      };
    });
  }, [channels, stores, totalRevenue]);

  const repStats = useMemo(() => {
    return reps.map((rep) => {
      const repStores = stores.filter((s) => s.repCode === rep.code);
      const revenue = repStores.reduce((s, st) => s + (st.monthlySales ?? 0), 0);
      const repVisits = visits.filter((v) => v.repCode === rep.code);
      const repCompleted = repVisits.filter((v) => isCompletedVisit(v)).length;
      const repIncomplete = repVisits.filter((v) => !isCompletedVisit(v)).length;
      // Unique stores visited
      const uniqueStoresVisited = new Set(repVisits.map((v) => v.storeCode)).size;
      return {
        ...rep,
        storeCount: repStores.length,
        revenue,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        visitCount: repVisits.length,
        completed: repCompleted,
        incomplete: repIncomplete,
        storesVisited: uniqueStoresVisited,
      };
    });
  }, [reps, stores, visits, totalRevenue]);

  const teamSort = useSortable(teamStats, "revenue");
  const channelSort = useSortable(channelStats, "revenue");
  const repSort = useSortable(repStats, "revenue");

  const fmt = (n: number) =>
    "R " + (n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header stats — Row 1: Core */}
      <div className="grid grid-cols-5 gap-4">
        {[
          {
            label: "Total Stores",
            value: stores.length.toLocaleString(),
            color: "bg-blue-500",
            icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
          },
          {
            label: "Active Reps",
            value: reps.length.toLocaleString(),
            color: "bg-green-500",
            icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
          },
          {
            label: "Teams",
            value: teams.length.toLocaleString(),
            color: "bg-orange-500",
            icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
          },
          {
            label: "Channels",
            value: channels.length.toLocaleString(),
            color: "bg-purple-500",
            icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
          },
          {
            label: "Monthly Revenue",
            value: fmt(totalRevenue),
            color: "bg-iram-green",
            icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className={`w-10 h-10 ${stat.color} rounded-lg flex items-center justify-center mb-3`}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
              </svg>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Header stats — Row 2: Visit Activity (MTD) */}
      {totalVisits > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              label: "Visits (MTD)",
              value: totalVisits.toLocaleString(),
              color: "bg-teal-500",
              icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
            },
            {
              label: "Completed",
              value: completedVisits.toLocaleString(),
              color: "bg-emerald-500",
              icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
            },
            {
              label: "Incomplete",
              value: incompleteVisits.toLocaleString(),
              color: "bg-amber-500",
              icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
            },
            {
              label: "Stores Visited",
              value: `${storesVisited} / ${stores.length}`,
              color: "bg-sky-500",
              icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className={`w-10 h-10 ${stat.color} rounded-lg flex items-center justify-center mb-3`}>
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
                </svg>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Teams Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Team Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <SortHeader label="Team" field="name" {...teamSort} />
                <SortHeader label="Manager" field="managerName" {...teamSort} />
                <SortHeader label="Area" field="area" {...teamSort} />
                <SortHeader label="Reps" field="repCount" align="right" {...teamSort} />
                <SortHeader label="Stores" field="storeCount" align="right" {...teamSort} />
                <SortHeader label="Channels" field="channelCount" align="right" {...teamSort} />
                <SortHeader label="Revenue" field="revenue" align="right" {...teamSort} />
                <SortHeader label="Visits" field="visitCount" align="right" {...teamSort} />
                <SortHeader label="Contribution" field="contribution" align="right" {...teamSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {teamSort.sorted.map((team) => (
                <tr key={team.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{team.name}</td>
                  <td className="px-6 py-3 text-gray-600">{team.managerName}</td>
                  <td className="px-6 py-3 text-gray-500">{team.area}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{team.repCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{team.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{team.channelCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(team.revenue)}</td>
                  <td className="px-6 py-3 text-right">
                    {team.visitCount > 0 ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-gray-900 font-medium">{team.visitCount}</span>
                        <span className="text-[10px] text-green-600">{team.completed}✓</span>
                        <span className="text-[10px] text-amber-600">{team.incomplete}✗</span>
                      </div>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${Math.min(team.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{team.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Channel Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Channel Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <SortHeader label="Channel" field="name" {...channelSort} />
                <SortHeader label="Stores" field="storeCount" align="right" {...channelSort} />
                <SortHeader label="Revenue" field="revenue" align="right" {...channelSort} />
                <SortHeader label="Reps" field="repCount" align="right" {...channelSort} />
                <SortHeader label="Contribution" field="contribution" align="right" {...channelSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {channelSort.sorted.map((ch) => (
                <tr key={ch.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{ch.name}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{ch.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(ch.revenue)}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{ch.repCount}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-iram-green h-1.5 rounded-full" style={{ width: `${Math.min(ch.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{ch.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rep Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Rep Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <SortHeader label="Rep" field="name" {...repSort} />
                <SortHeader label="Code" field="code" {...repSort} />
                <SortHeader label="Stores" field="storeCount" align="right" {...repSort} />
                <SortHeader label="Revenue" field="revenue" align="right" {...repSort} />
                <SortHeader label="Visits" field="visitCount" align="right" {...repSort} />
                <SortHeader label="Stores Hit" field="storesVisited" align="right" {...repSort} />
                <SortHeader label="Contribution" field="contribution" align="right" {...repSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {repSort.sorted.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{rep.name}</td>
                  <td className="px-6 py-3 text-gray-500">{rep.code}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{rep.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(rep.revenue)}</td>
                  <td className="px-6 py-3 text-right">
                    {rep.visitCount > 0 ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-gray-900 font-medium">{rep.visitCount}</span>
                        <span className="text-[10px] text-green-600">{rep.completed}✓</span>
                        <span className="text-[10px] text-amber-600">{rep.incomplete}✗</span>
                      </div>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {rep.visitCount > 0 ? (
                      <span className="text-gray-600">{rep.storesVisited} / {rep.storeCount}</span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min(rep.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{rep.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
