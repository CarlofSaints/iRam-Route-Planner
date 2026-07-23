"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "@/components/SessionProvider";
import {
  Rep,
  Team,
  Store,
  RoutePlanDocument,
  RepRoutePlan,
  RouteDayPlan,
  WeekLabel,
  DayLabel,
  CallCycleStrategy,
} from "@/lib/types";

interface RouteTypeInfo {
  id: string;
  name: string;
  strategy: CallCycleStrategy;
  active: boolean;
  hasRoutes: boolean;
  generatedAt: string | null;
}

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];
const DAYS: DayLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function RoutesPage() {
  const { session } = useSession();
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [gpsEdits, setGpsEdits] = useState<Record<string, { lat: string; lng: string }>>({});
  const [gpsSaving, setGpsSaving] = useState<string | null>(null);
  const [gpsFixed, setGpsFixed] = useState<Set<string>>(new Set());
  const [confirmingRange, setConfirmingRange] = useState<string | null>(null);
  const [rangeConfirmed, setRangeConfirmed] = useState<Set<string>>(new Set());
  const [perigeeMonths, setPerigeeMonths] = useState(3);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedRep, setSelectedRep] = useState("");
  const [includeTimes, setIncludeTimes] = useState(true);
  const [selectedCell, setSelectedCell] = useState<{
    week: WeekLabel;
    day: DayLabel;
  } | null>(null);
  const [error, setError] = useState("");
  const [routeTypes, setRouteTypes] = useState<RouteTypeInfo[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");

  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  const isTeamManager = session?.role === "teamManager";
  const isRep = session?.role === "rep";

  const load = () => {
    Promise.all([
      fetch("/api/routes").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
      fetch("/api/teams").then((r) => r.json()),
      fetch("/api/routes/types").then((r) => r.json()).catch(() => []),
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
    ]).then(([rt, rp, tm, types, st]) => {
      setRoutes(rt);
      setReps(rp);
      setTeams(tm);
      setStores(Array.isArray(st) ? st : []);

      const typesArr: RouteTypeInfo[] = Array.isArray(types) ? types : [];
      setRouteTypes(typesArr);

      // Auto-select the most recently generated type (only if it has routes)
      const withRoutes = typesArr.filter((t) => t.hasRoutes);
      if (withRoutes.length > 0) {
        const sorted = [...withRoutes].sort((a, b) =>
          (b.generatedAt ?? "").localeCompare(a.generatedAt ?? "")
        );
        setSelectedTypeId(sorted[0].id);
      }

      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  // Reload routes when selected type changes
  useEffect(() => {
    if (!selectedTypeId) return;
    fetch(`/api/routes?typeId=${selectedTypeId}`)
      .then((r) => r.json())
      .catch(() => null)
      .then((rt) => {
        setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null);
        setSelectedCell(null);
      });
  }, [selectedTypeId]);

  // Auto-select rep for rep users
  useEffect(() => {
    if (isRep && session?.repCode && reps.length > 0) {
      setSelectedRep(session.repCode);
    }
  }, [isRep, session?.repCode, reps]);

  // Scoped reps: filter by role, then by selected team
  const filteredReps = useMemo(() => {
    let scoped = reps;

    // Role-based scoping
    if (isRep && session?.repCode) {
      scoped = reps.filter((r) => r.code === session.repCode);
    } else if (isTeamManager && session?.teamId) {
      scoped = reps.filter((r) => r.teamId === session.teamId);
    }

    // Team filter (admin only — teamManagers already scoped)
    if (selectedTeam && isAdmin) {
      scoped = scoped.filter((r) => r.teamId === selectedTeam);
    }

    return scoped;
  }, [reps, isRep, isTeamManager, isAdmin, session?.repCode, session?.teamId, selectedTeam]);

  const generateRoutes = async () => {
    setGenerating(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      if (selectedRep) payload.repCodes = [selectedRep];
      if (selectedTypeId) payload.typeId = selectedTypeId;
      const res = await fetch("/api/routes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const doc = await res.json();
      setRoutes(doc);
      if (doc.callCycleTypeId) setSelectedTypeId(doc.callCycleTypeId);
      // Refresh types list
      fetch("/api/routes/types").then((r) => r.json()).catch(() => [])
        .then((types) => setRouteTypes(Array.isArray(types) ? types : []));
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const clearRoutes = async () => {
    if (!confirm("Delete all generated routes?")) return;
    await fetch("/api/routes", { method: "DELETE" });
    setRoutes(null);
  };

  const exportToExcel = () => {
    const params = new URLSearchParams();
    // Determine which teamId to export
    if (isTeamManager && session?.teamId) {
      params.set("teamId", session.teamId);
    } else if (selectedTeam) {
      params.set("teamId", selectedTeam);
    }
    if (includeTimes) params.set("includeTimes", "1");
    window.location.href = `/api/routes/export?${params.toString()}`;
  };

  // Get current rep's plan
  const currentPlan: RepRoutePlan | null = useMemo(() => {
    if (!routes || !selectedRep) return routes?.repPlans?.[0] || null;
    return routes.repPlans.find((p) => p.repCode === selectedRep) || null;
  }, [routes, selectedRep]);

  // Build week/day grid lookup
  const grid = useMemo(() => {
    if (!currentPlan) return new Map<string, RouteDayPlan>();
    const m = new Map<string, RouteDayPlan>();
    for (const dp of currentPlan.days) {
      m.set(`${dp.week}-${dp.day}`, dp);
    }
    return m;
  }, [currentPlan]);

  // Get selected day detail
  const selectedDayPlan: RouteDayPlan | null = useMemo(() => {
    if (!selectedCell) return null;
    return grid.get(`${selectedCell.week}-${selectedCell.day}`) || null;
  }, [selectedCell, grid]);

  const storeById = useMemo(
    () => new Map(stores.map((s) => [s.id, s])),
    [stores]
  );

  const gpsValue = (storeId: string, field: "lat" | "lng"): string => {
    const edit = gpsEdits[storeId];
    if (edit) return edit[field];
    const s = storeById.get(storeId);
    return (field === "lat" ? s?.gpsLat : s?.gpsLng) ?? "";
  };

  const setGpsField = (storeId: string, field: "lat" | "lng", value: string) => {
    setGpsEdits((prev) => ({
      ...prev,
      [storeId]: {
        lat: prev[storeId]?.lat ?? storeById.get(storeId)?.gpsLat ?? "",
        lng: prev[storeId]?.lng ?? storeById.get(storeId)?.gpsLng ?? "",
        [field]: value,
      },
    }));
  };

  const saveGps = async (storeIds: string[]) => {
    const primary = storeIds[0];
    const lat = gpsValue(primary, "lat").trim();
    const lng = gpsValue(primary, "lng").trim();
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (
      isNaN(latN) || isNaN(lngN) ||
      latN < -90 || latN > 90 || lngN < -180 || lngN > 180
    ) {
      setError("Enter a valid latitude (-90 to 90) and longitude (-180 to 180).");
      return;
    }
    setError("");
    setGpsSaving(primary);
    try {
      // Same physical store may have several duplicate records — fix them all.
      for (const id of storeIds) {
        const res = await fetch("/api/stores", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, gpsLat: lat, gpsLng: lng }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      setStores((prev) => prev.map((s) => (storeIds.includes(s.id) ? { ...s, gpsLat: lat, gpsLng: lng } : s)));
      setGpsFixed((prev) => new Set(prev).add(primary));
    } catch (err) {
      setError(`Failed to save GPS: ${String(err)}`);
    } finally {
      setGpsSaving(null);
    }
  };

  const confirmInCycle = async (storeIds: string[]) => {
    const primary = storeIds[0];
    setConfirmingRange(primary);
    try {
      for (const id of storeIds) {
        const res = await fetch("/api/stores", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, rangeConfirmed: true }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      setRangeConfirmed((prev) => new Set(prev).add(primary));
    } catch (err) {
      setError(`Failed to confirm store: ${String(err)}`);
    } finally {
      setConfirmingRange(null);
    }
  };

  // Collapse duplicate records (same store name) in the unassigned list so a
  // store surfaces once; actions apply to all its duplicate records.
  const groupedUnassigned = useMemo(() => {
    if (!currentPlan) return [] as { storeName: string; reason: string; storeIds: string[] }[];
    const map = new Map<string, { storeName: string; reason: string; storeIds: string[] }>();
    for (const s of currentPlan.stats.unassignedStores) {
      const key = s.storeName.trim().toUpperCase();
      const g = map.get(key);
      if (g) g.storeIds.push(s.storeId);
      else map.set(key, { storeName: s.storeName, reason: s.reason, storeIds: [s.storeId] });
    }
    return [...map.values()];
  }, [currentPlan]);

  // Capacity color
  const capacityColor = (plan: RouteDayPlan | undefined, workingHours: number) => {
    if (!plan || plan.stops.length === 0) return "bg-gray-50 text-gray-400";
    const utilization = plan.totalTime / (workingHours * 60);
    if (utilization > 1) return "bg-red-50 border-red-200 text-red-800";
    if (utilization > 0.85) return "bg-amber-50 border-amber-200 text-amber-800";
    return "bg-green-50 border-green-200 text-green-800";
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Routes</h1>
          <p className="text-sm text-gray-500">
            {routes
              ? <>
                  Generated {new Date(routes.generatedAt).toLocaleString("en-ZA")}
                  {routes.config.useGoogleMaps ? " (Google Maps optimized)" : " (Haversine fallback)"}
                  {routes.callCycleTypeName && (
                    <span className="ml-2 inline-block bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded">
                      {routes.callCycleTypeName}
                    </span>
                  )}
                </>
              : "No routes generated yet"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && routes && (
            <button
              onClick={clearRoutes}
              className="text-gray-400 hover:text-red-600 text-sm"
            >
              Clear All
            </button>
          )}
          {isAdmin && (
            <button
              onClick={generateRoutes}
              disabled={generating}
              className="bg-iram-green text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {generating && (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              )}
              {generating ? "Generating..." : "Generate Routes"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filters row */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {/* Call cycle type dropdown — always visible when types exist */}
        {routeTypes.length > 0 && (
          <select
            value={selectedTypeId}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedTypeId(val);
              setSelectedRep("");
              setSelectedCell(null);
              if (!val) {
                // Reload generic routes when "Latest Routes" selected
                fetch("/api/routes").then((r) => r.json()).catch(() => null)
                  .then((rt) => setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null));
              }
            }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          >
            <option value="">Latest Routes</option>
            {routeTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.hasRoutes ? "" : " (no routes)"}
              </option>
            ))}
          </select>
        )}

        {/* Team Leader filter — visible to admins */}
        {isAdmin && (
          <select
            value={selectedTeam}
            onChange={(e) => {
              setSelectedTeam(e.target.value);
              setSelectedRep("");
              setSelectedCell(null);
            }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          >
            <option value="">All Team Leaders</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.managerName || "Unassigned"} — {t.name}
              </option>
            ))}
          </select>
        )}

        {/* Rep dropdown — hidden for rep users (auto-selected) */}
        {!isRep && (
          <select
            value={selectedRep}
            onChange={(e) => {
              setSelectedRep(e.target.value);
              setSelectedCell(null);
            }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          >
            <option value="">Select Rep</option>
            {filteredReps.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name} ({r.code})
              </option>
            ))}
          </select>
        )}

        {/* Include Times checkbox */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeTimes}
            onChange={(e) => setIncludeTimes(e.target.checked)}
            className="rounded border-gray-300 text-iram-green focus:ring-iram-green"
          />
          Include Times
        </label>

        {/* Export to Excel button */}
        {routes && (
          <button
            onClick={exportToExcel}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export to Excel
          </button>
        )}

        {/* Export for Perigee (dated call cycle) */}
        {routes && (
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg pl-2 pr-1 py-1">
            <span className="text-xs text-gray-500">Perigee</span>
            <select
              value={perigeeMonths}
              onChange={(e) => setPerigeeMonths(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-iram-green"
              title="Months of call cycle to generate"
            >
              <option value={1}>1 mo</option>
              <option value={2}>2 mo</option>
              <option value={3}>3 mo</option>
            </select>
            <a
              href={`/api/routes/perigee-export?months=${perigeeMonths}&format=xlsx${selectedTypeId ? `&typeId=${selectedTypeId}` : ""}${selectedRep ? `&repCode=${selectedRep}` : ""}`}
              className="bg-gray-800 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-900 transition-colors"
              title={selectedRep ? "Export this rep's call cycle for Perigee" : "Export all reps' call cycle for Perigee"}
            >
              Export {selectedRep ? "rep" : "all"}
            </a>
          </div>
        )}

        {/* Stats */}
        {currentPlan && (
          <span className="text-sm text-gray-500 ml-auto">
            {currentPlan.stats.totalStores} stores assigned |{" "}
            {currentPlan.days.reduce((s, d) => s + d.stops.length, 0)} visits
            scheduled
            {currentPlan.stats.unassignedStores.length > 0 && (
              <span className="text-amber-600 ml-2">
                | {currentPlan.stats.unassignedStores.length} unassigned
              </span>
            )}
          </span>
        )}
      </div>

      {/* Unassigned stores alert */}
      {currentPlan && currentPlan.stats.unassignedStores.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-amber-800">
              {currentPlan.stats.unassignedStores.length} stores could not be
              scheduled:
            </p>
            <a
              href={`/api/routes/unassigned/export${selectedTypeId ? `?typeId=${selectedTypeId}` : ""}`}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-medium rounded-lg hover:bg-amber-100 transition-colors flex-shrink-0"
              title="Export unassigned stores for all reps"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export all (Excel)
            </a>
          </div>
          {currentPlan.stats.unassignedStores.some((s) => s.reason.toLowerCase().includes("gps")) && (
            <p className="text-[11px] text-amber-600 mb-2">
              Fix any bad coordinates below and click <span className="font-medium">Generate Routes</span> to reschedule them.
            </p>
          )}
          <ul className="text-xs text-amber-700 space-y-1.5">
            {groupedUnassigned.map((g, i) => {
              const isGps = g.reason.toLowerCase().includes("gps");
              const isRange = g.reason.toLowerCase().includes("out of range");
              const primary = g.storeIds[0];
              const fixed = gpsFixed.has(primary);
              const confirmed = rangeConfirmed.has(primary);
              return (
                <li key={primary} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-amber-500 font-mono w-6 flex-shrink-0 text-right">{i + 1}.</span>
                  <span className="font-medium">{currentPlan.repName}</span>
                  <span>—</span>
                  <span>{g.storeName}</span>
                  {g.storeIds.length > 1 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200/60 text-amber-800" title={`${g.storeIds.length} duplicate records`}>
                      ×{g.storeIds.length}
                    </span>
                  )}
                  {isGps && !fixed && (
                    <span className="flex items-center gap-1 ml-1">
                      <input
                        value={gpsValue(primary, "lat")}
                        onChange={(e) => setGpsField(primary, "lat", e.target.value)}
                        placeholder="lat e.g. -26.1"
                        className="w-28 border border-amber-300 rounded px-2 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-iram-green"
                      />
                      <input
                        value={gpsValue(primary, "lng")}
                        onChange={(e) => setGpsField(primary, "lng", e.target.value)}
                        placeholder="lng e.g. 28.0"
                        className="w-28 border border-amber-300 rounded px-2 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-iram-green"
                      />
                      <button
                        onClick={() => saveGps(g.storeIds)}
                        disabled={gpsSaving === primary}
                        className="px-2 py-0.5 bg-iram-green text-white rounded text-xs font-medium hover:bg-iram-green-dark disabled:opacity-50"
                      >
                        {gpsSaving === primary ? "Saving..." : "Save GPS"}
                      </button>
                    </span>
                  )}
                  {isGps && fixed && (
                    <span className="text-green-700 font-medium ml-1">✓ GPS saved — regenerate routes to schedule</span>
                  )}
                  {isRange && (
                    <>
                      <span>— {g.reason}</span>
                      {confirmed ? (
                        <span className="text-green-700 font-medium ml-1">✓ Confirmed — regenerate to schedule</span>
                      ) : (
                        <button
                          onClick={() => confirmInCycle(g.storeIds)}
                          disabled={confirmingRange === primary}
                          className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50 ml-1"
                          title="Confirm this store really is in the rep's cycle"
                        >
                          {confirmingRange === primary ? "Confirming..." : "Confirm in cycle"}
                        </button>
                      )}
                    </>
                  )}
                  {!isGps && !isRange && <span>— {g.reason}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Weekly Schedule Grid */}
      {currentPlan && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left w-28">Day</th>
                  {WEEKS.map((w) => (
                    <th key={w} className="px-4 py-3 text-center">
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {DAYS.map((day) => (
                  <tr key={day} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-700">
                      {day}
                    </td>
                    {WEEKS.map((week) => {
                      const plan = grid.get(`${week}-${day}`);
                      const isSelected =
                        selectedCell?.week === week &&
                        selectedCell?.day === day;
                      return (
                        <td key={week} className="px-2 py-2">
                          <button
                            onClick={() =>
                              setSelectedCell(
                                isSelected ? null : { week, day }
                              )
                            }
                            className={`w-full rounded-lg border px-3 py-2 text-center transition-all ${
                              isSelected
                                ? "ring-2 ring-iram-green border-iram-green"
                                : ""
                            } ${capacityColor(plan, currentPlan.workingHoursPerDay)}`}
                          >
                            {plan && plan.stops.length > 0 ? (
                              <>
                                <div className="font-semibold text-sm">
                                  {plan.stops.length} stores
                                </div>
                                <div className="text-xs mt-0.5">
                                  {(plan.totalTime / 60).toFixed(1)}h |{" "}
                                  {Math.round(plan.totalDistance)}km
                                </div>
                              </>
                            ) : (
                              <div className="text-xs">—</div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Day Detail */}
      {selectedDayPlan && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {selectedCell!.day} — {selectedCell!.week}
            </h3>
            <div className="flex items-center gap-3">
              <a
                href={`/map?rep=${currentPlan!.repCode}&week=${selectedCell!.week}&day=${selectedCell!.day}&route=on`}
                className="text-iram-green hover:text-red-800 text-xs font-medium"
              >
                View on Map
              </a>
              <span className="text-xs text-gray-500">
                {selectedDayPlan.stops.length} stores |{" "}
                {(selectedDayPlan.totalTravelTime / 60).toFixed(1)}h travel |{" "}
                {(selectedDayPlan.totalVisitTime / 60).toFixed(1)}h visits |{" "}
                {Math.round(selectedDayPlan.totalDistance)}km
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {/* Home start */}
            {currentPlan!.homeLatLng && (
              <div className="flex items-center gap-3 text-xs text-gray-400 pl-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                  </svg>
                </div>
                <span>Start from home</span>
              </div>
            )}

            {selectedDayPlan.stops.map((stop) => (
              <div
                key={stop.storeId}
                className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5"
              >
                <div className="w-7 h-7 rounded-full bg-iram-green text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {stop.sequence}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {stop.storeName}
                  </p>
                  <p className="text-xs text-gray-500">
                    arrive {stop.arrivalTime} — depart {stop.departureTime} —{" "}
                    {stop.visitDuration}min visit
                  </p>
                </div>
                <div className="text-right text-xs text-gray-400 flex-shrink-0">
                  {stop.distanceFromPrev > 0 && (
                    <span>{stop.distanceFromPrev}km</span>
                  )}
                  {stop.travelTimeFromPrev > 0 && (
                    <span className="ml-2">
                      {stop.travelTimeFromPrev}min drive
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Home return */}
            {currentPlan!.homeLatLng && (
              <div className="flex items-center gap-3 text-xs text-gray-400 pl-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                  </svg>
                </div>
                <span>Return home</span>
              </div>
            )}
          </div>

          {/* Summary bar */}
          <div
            className={`mt-4 rounded-lg px-4 py-2.5 text-xs font-medium ${
              selectedDayPlan.overCapacity
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {selectedDayPlan.stops.length} stores |{" "}
            {(selectedDayPlan.totalTravelTime / 60).toFixed(1)}h travel |{" "}
            {(selectedDayPlan.totalVisitTime / 60).toFixed(1)}h visits |{" "}
            {(selectedDayPlan.totalTime / 60).toFixed(1)}h total |{" "}
            {Math.round(selectedDayPlan.totalDistance)}km
            {selectedDayPlan.overCapacity && " — OVER CAPACITY"}
          </div>
        </div>
      )}

      {/* No routes state */}
      {!routes && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <svg
            className="w-12 h-12 text-gray-300 mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
          <p className="text-gray-500 text-sm mb-4">
            Click &quot;Generate Routes&quot; to create optimized daily routes
            for all reps.
          </p>
          <p className="text-gray-400 text-xs">
            Routes are calculated based on store frequency, geographic
            clustering, and rep working hours.
          </p>
        </div>
      )}
    </div>
  );
}
