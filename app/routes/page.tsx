"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "@/components/SessionProvider";
import { FilterDropdown } from "@/components/FilterDropdown";
import { dayTotals } from "@/lib/dayTotals";
import { roadRoutingOf } from "@/lib/roadRouting";
import { CoordinateEntry } from "@/components/CoordinateEntry";
import { canChangeRoutes } from "@/lib/routeAccess";
import { getRoleForRep, workedStorePoints } from "@/lib/repStores";
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
  VisitRole,
  getVisitRoleName,
} from "@/lib/types";
import { isTeamRole } from "@/lib/roles";

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
  const [visitRoles, setVisitRoles] = useState<VisitRole[]>([]);
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
  // Which reps a target applies to. A set, because the useful unit is a
  // SUBSET: ten reps moved to eight calls a day while the rest stay put.
  const [selectedReps, setSelectedReps] = useState<Set<string>>(new Set());
  // Whose week the grid is drawing. A grid can only show one, and it is not
  // the same question as who the change applies to.
  const [viewingRep, setViewingRep] = useState("");
  const [includeTimes, setIncludeTimes] = useState(true);
  const [selectedCell, setSelectedCell] = useState<{
    week: WeekLabel;
    day: DayLabel;
  } | null>(null);
  const [error, setError] = useState("");
  const [routeTypes, setRouteTypes] = useState<RouteTypeInfo[]>([]);

  // Calls per day.
  //
  // `saved` is what every rep's week is currently built on; `callsPerDay` is
  // what the box says right now. They are separate because typing a number
  // must be able to preview ONE rep without committing the other 63 to it.
  // Null in either means no target, which is a real setting and not an unset
  // one: it hands day sizing back to the clock.
  const [callsPerDay, setCallsPerDay] = useState<number | null>(null);
  const [savedCallsPerDay, setSavedCallsPerDay] = useState<number | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState("");

  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  const isTeamManager = isTeamRole(session?.role);
  const isRep = session?.role === "rep";
  // 🔴 The SAME rule the APIs use (lib/routeAccess.ts canChangeRoutes), not
  // the roles grid. Generate, save, delete and the Perigee file all refuse
  // anyone but an admin, so a button shown off the grid only led to a 403.
  const canChange = !!session && canChangeRoutes(session);

  const load = () => {
    Promise.all([
      fetch("/api/routes").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
      fetch("/api/teams").then((r) => r.json()),
      fetch("/api/routes/types").then((r) => r.json()).catch(() => []),
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/visit-roles").then((r) => r.json()).catch(() => []),
    ]).then(([rt, rp, tm, types, st, vr]) => {
      setRoutes(rt);
      setReps(rp);
      setTeams(tm);
      setStores(Array.isArray(st) ? st : []);
      setVisitRoles(Array.isArray(vr) ? vr : []);

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
      setViewingRep(session.repCode);
      setSelectedReps(new Set([session.repCode]));
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


  /**
   * Each rep's calls-per-day target, taken off the saved plan rather than the
   * settings blob. After a subset run the two legitimately differ, and the
   * setting would describe a week those reps do not have.
   */
  const repCallsPerDay = useMemo(() => {
    const out: Record<string, number | undefined> = {};
    for (const p of routes?.repPlans ?? []) out[p.repCode] = p.callsPerDay;
    return out;
  }, [routes]);
  /**
   * The reps a calls-per-day change applies to.
   *
   * Nothing ticked means everybody in view, which is what the page did before
   * a subset was possible and stays the least surprising reading of an empty
   * selection. Ticking any rep narrows it to exactly those.
   */
  const targetReps = useMemo(
    () => (selectedReps.size > 0 ? filteredReps.filter((r) => selectedReps.has(r.code)) : filteredReps),
    [selectedReps, filteredReps]
  );
  // 🔴 "Everyone" means every rep in the business, not everyone in view. A
  // team manager, or an admin with a team picked, sees one team; treating that
  // team as everyone would write the business-wide default and regenerate
  // every other team's week as a side effect.
  const isSubset = targetReps.length < reps.length;

  // The grid always has to be drawing SOMEBODY. When the ticked set changes
  // out from under the viewed rep, follow it rather than going blank.
  // Unticking everybody lets go of the last rep too, so the grid goes back to
  // the first rep in scope rather than drawing someone no longer ticked.
  useEffect(() => {
    if (selectedReps.size === 0) {
      if (viewingRep && !isRep) setViewingRep("");
      return;
    }
    if (viewingRep && selectedReps.has(viewingRep)) return;
    setViewingRep([...selectedReps][0] ?? "");
  }, [selectedReps, viewingRep, isRep]);
  // 🔴 Seeded from the server, never defaulted in the markup. A box that starts
  // on 8 while the business is on no target would apply 8 the first time
  // anyone touched anything else on this page.
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const v = typeof d?.callsPerDay === "number" ? d.callsPerDay : null;
        setCallsPerDay(v);
        setSavedCallsPerDay(v);
      })
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, []);

  /**
   * Commit the number to the reps in scope.
   *
   * 🔴 Only a run covering EVERYONE writes the business-wide setting. Moving
   * ten reps to eight calls a day is not a decision about the other 45, and
   * saving it as the default would silently apply it to all of them the next
   * time anybody pressed Generate Routes.
   *
   * When it does save, it saves FIRST. A rebuild that succeeded against a
   * setting that failed to save would leave the plan and the stated target
   * disagreeing, and the next Generate would quietly undo the whole thing.
   */
  const applyCallsPerDay = async () => {
    setApplying(true);
    setError("");
    try {
      if (!isSubset) {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callsPerDay: callsPerDay ?? null }),
        });
        if (!res.ok) throw new Error("Could not save the calls per day setting.");
        setSavedCallsPerDay(callsPerDay);
      }
      await generateRoutes({ repCodes: targetReps.map((r) => r.code), callsPerDay: callsPerDay ?? null });
    } catch (err) {
      setError(String(err));
    } finally {
      setApplying(false);
    }
  };
  // 🔴 No debounced preview. One used to rebuild AND SAVE the ticked reps
  // whenever the box differed from the saved number, so ticking a rep just to
  // look at them (after a subset Apply left the box on the new number)
  // rewrote their week. Only the Apply button writes now.
  const generateRoutes = async (opts: { repCodes?: string[]; callsPerDay?: number | null } = {}) => {
    // 🔴 Generate Routes builds on the SAVED default. A number typed in the
    // box and never applied must not ride along silently: say so and stop.
    if (opts.callsPerDay === undefined && settingsLoaded && callsPerDay !== savedCallsPerDay) {
      setError(
        `The calls per day box says ${callsPerDay ? callsPerDay : "no target"} but the saved default is ${
          savedCallsPerDay ? savedCallsPerDay : "no target"
        }. Press Apply to use the new number, or set the box back, then generate.`
      );
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      // An explicit list wins. Otherwise Generate covers whoever is ticked, and
      // with nobody ticked, whoever is in view (a team manager's team, or the
      // team an admin picked). Only a run covering every rep goes out without
      // a list, which is the one case the server replaces the whole plan.
      const codes =
        opts.repCodes ?? (selectedReps.size > 0 ? [...selectedReps] : filteredReps.map((r) => r.code));
      if (codes.length > 0 && codes.length < reps.length) payload.repCodes = codes;
      if (selectedTypeId) payload.typeId = selectedTypeId;
      // Apply sends the box's number on purpose. Generate Routes sends the
      // saved default, and before the settings have loaded sends nothing, so
      // the server uses the saved one rather than a blank box meaning "none".
      if (opts.callsPerDay !== undefined) payload.callsPerDay = opts.callsPerDay;
      else if (settingsLoaded) payload.callsPerDay = savedCallsPerDay ?? null;
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

  /** How much of the saved plan is a real drive rather than a straight line. */
  const roadRouting = useMemo(() => roadRoutingOf(routes), [routes]);

  // Get current rep's plan
  // With no rep picked, show the first plan of a rep IN SCOPE. Falling back to
  // repPlans[0], the first rep in the document, made the header, grid and
  // unassigned list describe a rep from another team under a team filter
  // (found in Clippa 9e9ed39).
  const currentPlan: RepRoutePlan | null = useMemo(() => {
    if (!routes?.repPlans) return null;
    if (!viewingRep) {
      const inScope = new Set(filteredReps.map((r) => r.code));
      return routes.repPlans.find((p) => inScope.has(p.repCode)) || null;
    }
    return routes.repPlans.find((p) => p.repCode === viewingRep) || null;
  }, [routes, viewingRep, filteredReps]);

  /** The plan's rep's placed stores, so the pin picker opens on their patch. */
  // In the rep's OWN visit role: a QC or team-leader rep works the stores they
  // are on through roleReps (or the old repCode2/3), not store.repCode.
  const nearbyForPlan = useMemo(() => {
    if (!currentPlan) return [];
    const rep = reps.find((r) => r.code === currentPlan.repCode);
    if (!rep) return [];
    const role =
      visitRoles.find((r) => r.id === currentPlan.visitRoleId) ?? getRoleForRep(rep, visitRoles);
    return workedStorePoints(stores, rep, role);
  }, [stores, currentPlan, reps, visitRoles]);

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

  /**
   * What the selected day costs, drive home included.
   *
   * The panel has always drawn a "Return home" row and charged nothing to it,
   * which is what made a day look like it ended at the last shop. Every figure
   * in the panel and the grid now comes from `dayTotals`, so the eight legs
   * listed and the total printed under them are the same arithmetic.
   */
  const selectedTotals = useMemo(
    () =>
      selectedDayPlan && currentPlan
        ? dayTotals(selectedDayPlan, currentPlan.homeLatLng, currentPlan.workingHoursPerDay)
        : null,
    [selectedDayPlan, currentPlan]
  );

  /** The same measurement for a grid cell, which has no selection behind it. */
  const cellTotals = (plan: RouteDayPlan) =>
    dayTotals(plan, currentPlan?.homeLatLng, currentPlan?.workingHoursPerDay);

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

  // Saves the numbers CoordinateEntry checked, not the raw text in the boxes:
  // "- 26.1" passes the check once cleaned but parseFloat reads it as NaN.
  const saveGps = async (storeIds: string[], latN: number, lngN: number) => {
    const primary = storeIds[0];
    const lat = String(latN);
    const lng = String(lngN);
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
      // Same physical store may have several duplicate records: fix them all.
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
    // Measured, like the figure printed inside the cell — a day coloured green
    // off one total and labelled with another is worse than either alone.
    const utilization =
      dayTotals(plan, currentPlan?.homeLatLng, workingHours).totalMinutes /
      (workingHours * 60);
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
                  {/* 🔴 NOT `config.useGoogleMaps` — that only records that a
                      KEY existed, so on Clippa this line read "Google Maps
                      optimized" over a book that was mostly straight lines,
                      with every distance on them understated. Counted from the
                      days themselves, so it is honest about an old plan too. */}
                  {roadRouting ? (
                    roadRouting.complete ? (
                      <span className="ml-1 text-green-700">
                        · real road routes, all {roadRouting.eligibleDays} days
                      </span>
                    ) : (
                      <span className="ml-1 text-amber-700 font-medium">
                        · ⚠ only {roadRouting.roadRoutedDays} of {roadRouting.eligibleDays} days
                        have a real road route. {roadRouting.straightLineDays} are
                        straight-line estimates, so their distances and drive times are
                        understated. Regenerate to fix.
                      </span>
                    )
                  ) : (
                    " (no road routing recorded)"
                  )}
                  {routes.callCycleTypeName && (
                    <span className="ml-2 inline-block bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded">
                      {routes.callCycleTypeName}
                    </span>
                  )}
                  {/* Read off the PLAN, not the setting. The setting can be
                      changed without regenerating, and showing it here would
                      describe a week nobody has. */}
                  {routes.config.callsPerDay ? (
                    <span className="ml-2 inline-block bg-blue-50 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">
                      {routes.config.callsPerDay} calls/day
                    </span>
                  ) : null}
                </>
              : "No routes generated yet"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canChange && routes && (
            <button
              onClick={clearRoutes}
              className="text-gray-400 hover:text-red-600 text-sm"
            >
              Clear All
            </button>
          )}
          {canChange && (
            <button
              onClick={() => generateRoutes()}
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

      {/* Calls per day */}
      {canChange && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Calls per day</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={callsPerDay ?? ""}
                  placeholder="No target"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") return setCallsPerDay(null);
                    const v = Number(raw);
                    setCallsPerDay(Number.isFinite(v) && v >= 1 ? Math.min(Math.round(v), 30) : null);
                  }}
                  className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                />
                {callsPerDay !== null && (
                  <button
                    onClick={() => setCallsPerDay(null)}
                    className="text-xs text-gray-400 hover:text-gray-700"
                    title="Size days by the working day instead of a fixed number of calls"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-w-[16rem] text-xs text-gray-500">
              {/* 🔴 Nothing here rebuilds on its own. Ticking a rep to look at
                  them used to fire a rebuild-and-save whenever the box differed
                  from the saved number; now only the Apply button writes. */}
              {selectedReps.size === 0 ? (
                <span>
                  Tick reps in the <span className="font-medium">Reps</span> list below to try this on
                  a few of them first. With none ticked it applies to{" "}
                  {isSubset ? `the ${filteredReps.length} reps shown` : "everyone"}.
                </span>
              ) : (
                <span>
                  Press Apply to rebuild and save{" "}
                  {selectedReps.size === 1 ? "this rep's week" : `these ${selectedReps.size} reps' weeks`}{" "}
                  at this number. Ticking a rep only shows them; nothing changes until you press Apply.
                </span>
              )}
              {/* What the SAVED default is, so an uncommitted number in the box
                  can never be mistaken for the business setting. */}
              <div className="mt-1 text-gray-400">
                Everyone defaults to{" "}
                {savedCallsPerDay ? `${savedCallsPerDay} calls a day` : "no target (days sized by working hours)"}.
                {isSubset && (
                  <span className="text-gray-500">
                    {" "}Applying to a subset changes those reps only, and leaves this default alone.
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={applyCallsPerDay}
              disabled={
                applying ||
                generating ||
                targetReps.length === 0 ||
                // A whole-book apply is only pointless when the default already
                // matches. A SUBSET apply is never pointless: those reps may be
                // on something else entirely.
                (!isSubset && callsPerDay === savedCallsPerDay)
              }
              className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors flex items-center gap-2"
            >
              {applying && (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              )}
              {applying
                ? `Applying to ${targetReps.length === 1 ? "1 rep" : `${targetReps.length} reps`}...`
                : !isSubset && callsPerDay === savedCallsPerDay
                  ? "Applied to everyone"
                  : `Apply ${callsPerDay ? `${callsPerDay} calls/day` : "no target"} to ${
                      isSubset
                        ? targetReps.length === 1
                          ? "1 rep"
                          : `${targetReps.length} reps`
                        : `all ${targetReps.length} reps`
                    }`}            </button>
          </div>
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
              setViewingRep("");
              setSelectedReps(new Set());
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
              setViewingRep("");
              setSelectedReps(new Set());
              setSelectedCell(null);
            }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          >
            <option value="">All Team Leaders</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.managerName || "Unassigned"}: {t.name}
              </option>
            ))}
          </select>
        )}

        {/* Reps — a tick list, because the useful unit is a SUBSET. Hidden for
            rep users, who are pinned to themselves. */}
        {!isRep && (
          <FilterDropdown
            label="Reps"
            options={filteredReps.map((r) => ({
              value: r.code,
              // The target each rep is actually on, right in the list, so
              // picking who to change does not need a second screen.
              label: `${r.name} (${getVisitRoleName(r.visitRoleId, visitRoles)}) · ${r.code} · ${repCallsPerDay[r.code] ? `${repCallsPerDay[r.code]}/day` : "no target"}`,
            }))}
            selected={selectedReps}
            onChange={(next) => {
              setSelectedReps(next);
              setSelectedCell(null);
            }}
          />
        )}

        {/* Which of them the grid is drawing. Only worth showing once there is
            a choice to make: with one rep ticked there is nothing to pick. */}
        {!isRep && selectedReps.size > 1 && (
          <select
            value={viewingRep}
            onChange={(e) => {
              setViewingRep(e.target.value);
              setSelectedCell(null);
            }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            title="Whose week the grid below is showing"
          >
            {filteredReps
              .filter((r) => selectedReps.has(r.code))
              .map((r) => (
                <option key={r.code} value={r.code}>
                  Showing {r.name} ({getVisitRoleName(r.visitRoleId, visitRoles)})
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
        {/* Admin only, like the API behind it: shown to anyone else it only
            ever opened a raw 403. */}
        {routes && canChange && (
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
              href={`/api/routes/perigee-export?months=${perigeeMonths}&format=xlsx${selectedTypeId ? `&typeId=${selectedTypeId}` : ""}${viewingRep ? `&repCode=${viewingRep}` : ""}`}
              className="bg-gray-800 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-900 transition-colors"
              title={viewingRep ? "Export this rep's call cycle for Perigee" : "Export all reps' call cycle for Perigee"}
            >
              Export {viewingRep ? "rep" : "all"}
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
                  <span className="font-medium">
                    {currentPlan.repName}{" "}
                    <span className="font-normal text-amber-700/70">
                      ({currentPlan.visitRoleName || getVisitRoleName(currentPlan.visitRoleId, visitRoles)})
                    </span>
                  </span>
                  <span>:</span>
                  <span>{g.storeName}</span>
                  {g.storeIds.length > 1 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200/60 text-amber-800" title={`${g.storeIds.length} duplicate records`}>
                      ×{g.storeIds.length}
                    </span>
                  )}
                  {/* Labelled boxes, swap detection and a pin picker instead of
                      two boxes labelled only by a placeholder that vanishes on
                      the first keystroke (Clippa a075285, 16b5576). */}
                  {isGps && !fixed && (
                    <div className="basis-full ml-8 mt-1 mb-1">
                      <CoordinateEntry
                        lat={gpsValue(primary, "lat")}
                        lng={gpsValue(primary, "lng")}
                        onChange={(lat, lng) => {
                          setGpsField(primary, "lat", lat);
                          setGpsField(primary, "lng", lng);
                        }}
                        onSave={(lat, lng) => saveGps(g.storeIds, lat, lng)}
                        saving={gpsSaving === primary}
                        storeName={g.storeName}
                        nearby={nearbyForPlan}
                      />
                    </div>
                  )}
                  {isGps && fixed && (
                    <span className="text-green-700 font-medium ml-1">GPS saved. Regenerate routes to schedule it, and correct it in Perigee too.</span>
                  )}
                  {isRange && (
                    <>
                      <span>({g.reason})</span>
                      {confirmed ? (
                        <span className="text-green-700 font-medium ml-1">✓ Confirmed. Regenerate to schedule it.</span>
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
                  {!isGps && !isRange && <span>({g.reason})</span>}
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
                                  {(cellTotals(plan).totalMinutes / 60).toFixed(1)}h |{" "}
                                  {Math.round(cellTotals(plan).distanceKm)}km
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
              {selectedCell!.day}, {selectedCell!.week}
            </h3>
            <div className="flex items-center gap-3">
              <a
                href={`/map?rep=${currentPlan!.repCode}&week=${selectedCell!.week}&day=${selectedCell!.day}&route=on`}
                className="text-iram-green hover:text-red-800 text-xs font-medium"
              >
                View on Map
              </a>
              <span className="text-xs text-gray-500">
                {selectedTotals!.stops} stores |{" "}
                {(selectedTotals!.travelMinutes / 60).toFixed(1)}h travel |{" "}
                {(selectedTotals!.visitMinutes / 60).toFixed(1)}h visits |{" "}
                {Math.round(selectedTotals!.distanceKm)}km
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
                    arrive {stop.arrivalTime}, depart {stop.departureTime},{" "}
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
                {/* The leg that was drawn and never charged. Naming the drive
                    and the time the rep gets in is the difference between a day
                    that "ends at the last shop" and one that ends at home. */}
                <span>
                  Return home
                  {selectedTotals?.returnKm !== null && selectedTotals && (
                    <span className="text-gray-500">
                      {" "}
                      : {selectedTotals.returnKm} km, {selectedTotals.returnMinutes} min
                      drive, home {selectedTotals.arriveHome}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Summary bar */}
          <div
            className={`mt-4 rounded-lg px-4 py-2.5 text-xs font-medium ${
              selectedTotals!.overBy
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {selectedTotals!.stops} stores |{" "}
            {(selectedTotals!.travelMinutes / 60).toFixed(1)}h travel |{" "}
            {(selectedTotals!.visitMinutes / 60).toFixed(1)}h visits |{" "}
            {(selectedTotals!.totalMinutes / 60).toFixed(1)}h total |{" "}
            {Math.round(selectedTotals!.distanceKm)}km
            {/* By HOW MUCH, not just that it is over. "Over capacity" on half a
                rep's days is noise; 8 minutes and two hours are different
                problems. With a calls-per-day target this is the honest half of
                the bargain — the day carries what was asked for AND says it
                runs long, rather than quietly dropping the last call.

                Measured here rather than read off `overrunMinutes`, so the
                overrun is against the same total the bar prints — and so the
                drive home is inside it. A day that fits until the rep starts
                driving home does not fit. */}
            {selectedTotals!.overBy !== null && (
              <span className="ml-1">
                {`| OVER the working day by ${
                  selectedTotals!.overBy >= 60
                    ? `${Math.floor(selectedTotals!.overBy / 60)}h ${selectedTotals!.overBy % 60}m`
                    : `${selectedTotals!.overBy}m`
                }`}
              </span>
            )}
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
