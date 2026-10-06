"use client";

import { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useSession } from "@/components/SessionProvider";
import { Store, Rep, Channel, Team, RoutePlanDocument, RouteDayPlan, WeekLabel, CallCycleStrategy, VisitRole, getVisitRoleName } from "@/lib/types";
import { decodePolyline } from "@/lib/google-maps";
import { haversineKm } from "@/lib/latlng";
import { parseRepHome } from "@/lib/saCoordinates";
import type { RouteLine } from "./MapView";
import { isTeamRole } from "@/lib/roles";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];

/**
 * Every rep who calls on this store, in any visit role.
 *
 * Mirrors lib/repStores: `roleReps` is the source of truth, and only a store
 * that predates it falls back to the old repCode2/repCode3 pair. Without this
 * a QC or Team Leader rep's own stores vanished from the map the moment they
 * were picked, because only the sales slot (`repCode`) was ever matched.
 */
function storeRepCodes(s: Store): string[] {
  const out = s.repCode ? [s.repCode] : [];
  if (s.roleReps) {
    for (const code of Object.values(s.roleReps)) if (code) out.push(code);
  } else {
    if (s.repCode2) out.push(s.repCode2);
    if (s.repCode3) out.push(s.repCode3);
  }
  return out;
}

interface RouteTypeInfo {
  id: string;
  name: string;
  strategy: CallCycleStrategy;
  active: boolean;
  hasRoutes: boolean;
  generatedAt: string | null;
}

/**
 * Single-select rep picker with a search box.
 *
 * A plain <select> is unusable at 227 reps — the native list has no filtering,
 * so finding one person means scrolling a wall of names. Matches on name and
 * code, because reps are identified by code everywhere else in the app.
 */
function RepSearchSelect({
  reps,
  value,
  onChange,
  colors,
  visitRoles,
  callsPerDay,
  startsAtHome,
}: {
  reps: Rep[];
  value: string;
  onChange: (code: string) => void;
  colors: Record<string, string>;
  visitRoles: VisitRole[];
  /**
   * Rep code to the calls-per-day target their week was built on.
   *
   * Read from the saved PLAN, never from the settings blob. Reps are rebuilt
   * in subsets, so the business-wide setting and what a given rep's week
   * actually runs on routinely differ, and showing the setting here would
   * describe a week that rep does not have.
   */
  callsPerDay: Record<string, number | undefined>;
  /**
   * Rep code to where the SAVED route actually starts their day.
   *
   * "centroid" is the middle of their own stores, a guess: the first and last
   * drive of every day is wrong by however far they really live from there.
   * "stale" is the trap — they have a home address, but it was captured after
   * the last generation, so the route on screen still ignores it.
   */
  startsAtHome: Record<string, "home" | "centroid" | "stale">;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reopening should offer the full list again, not the last search.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reps;
    return reps.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        // Searchable by role too, so "qc" lists everyone doing QC calls.
        getVisitRoleName(r.visitRoleId, visitRoles).toLowerCase().includes(q)
    );
  }, [reps, search, visitRoles]);

  const selected = reps.find((r) => r.code === value);

  // Absent is a fact worth stating: it means the week was sized by working
  // hours, not that nobody has looked at it. A blank cell reads as broken.
  const targetLabel = (code: string) => {
    const t = callsPerDay[code];
    return t ? `${t}/day` : "no target";
  };

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-iram-green min-w-44"
        style={{ color: selected ? colors[selected.code] || "#111827" : "#111827" }}
      >
        <span className="truncate">
          {selected ? selected.name : "All Reps"}
          {selected && (
            <span className="font-normal text-gray-500">
              {" "}({getVisitRoleName(selected.visitRoleId, visitRoles)})
            </span>
          )}
        </span>
        <svg
          className={`w-3.5 h-3.5 ml-auto text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-[1000] mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                // Type a few letters, hit Enter — the common case is that the
                // search has already narrowed it to the one person you want.
                if (e.key === "Enter" && filtered.length > 0) pick(filtered[0].code);
              }}
              placeholder="Search rep name or code..."
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-iram-green"
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            <button
              onClick={() => pick("")}
              className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-gray-50 ${
                value === "" ? "bg-gray-50 font-semibold" : "text-gray-700"
              }`}
            >
              All Reps
            </button>
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-2">
                No rep matches &ldquo;{search}&rdquo;
              </p>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.code}
                  onClick={() => pick(r.code)}
                  className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-sm hover:bg-gray-50 ${
                    value === r.code ? "bg-gray-50" : ""
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colors[r.code] || "#6B7280" }}
                  />
                  <span className="truncate font-medium" style={{ color: colors[r.code] || "#111827" }}>
                    {r.name}
                  </span>
                  <span className="text-[11px] text-gray-500 flex-shrink-0">
                    ({getVisitRoleName(r.visitRoleId, visitRoles)})
                  </span>
                  <span className="ml-auto text-[10px] text-gray-400 font-mono flex-shrink-0">{r.code}</span>
                  {/* Where this rep's day starts: their own address, or a guess. */}
                  <span
                    className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      startsAtHome[r.code] === "home"
                        ? "bg-green-50 text-green-700"
                        : startsAtHome[r.code] === "stale"
                          ? "bg-orange-100 text-orange-800"
                          : "bg-amber-50 text-amber-700"
                    }`}
                    title={
                      startsAtHome[r.code] === "home"
                        ? `${r.name} starts and ends the day at their home address`
                        : startsAtHome[r.code] === "stale"
                          ? `${r.name} has a home address, but it was captured after these routes were generated, so the saved route still starts from the centre of their stores. Regenerate routes.`
                          : `${r.name} has no usable home GPS, so their day starts from the centre of their stores. Add their home address on the Reps page.`
                    }
                  >
                    {startsAtHome[r.code] === "home"
                      ? "home"
                      : startsAtHome[r.code] === "stale"
                        ? "centroid ⚠"
                        : "centroid"}
                  </span>
                  {/* What this rep's week is actually built on. */}
                  <span
                    className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      callsPerDay[r.code]
                        ? "bg-blue-50 text-blue-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                    title={
                      callsPerDay[r.code]
                        ? `${r.name}'s week is built on ${callsPerDay[r.code]} calls a day`
                        : `${r.name}'s week is sized by their working hours, with no calls-per-day target`
                    }
                  >
                    {targetLabel(r.code)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MapPageInner() {
  const searchParams = useSearchParams();
  const { session } = useSession();

  const [stores, setStores] = useState<Store[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [visitRoles, setVisitRoles] = useState<VisitRole[]>([]);
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeTypes, setRouteTypes] = useState<RouteTypeInfo[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");

  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  const isTeamManager = isTeamRole(session?.role);
  const isRep = session?.role === "rep";

  // Filters — initialize from URL params (for "View on Map" links from Routes page)
  const [filterRep, setFilterRep] = useState(searchParams.get("rep") || "");
  const [filterDay, setFilterDay] = useState(searchParams.get("day") || "");
  const [filterWeek, setFilterWeek] = useState(searchParams.get("week") || "");
  const [showRoute, setShowRoute] = useState(searchParams.get("route") === "on");

  useEffect(() => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
      fetch("/api/routes").then((r) => r.json()).catch(() => null),
      fetch("/api/routes/types").then((r) => r.json()).catch(() => []),
      fetch("/api/visit-roles").then((r) => r.json()).catch(() => []),
    ]).then(([st, rp, ch, tm, rt, types, vr]) => {
      setStores(Array.isArray(st) ? st : []);
      setReps(Array.isArray(rp) ? rp : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setTeams(Array.isArray(tm) ? tm : []);
      setVisitRoles(Array.isArray(vr) ? vr : []);
      setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null);

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
  }, []);

  // Reload routes when selected type changes
  useEffect(() => {
    if (!selectedTypeId) return;
    fetch(`/api/routes?typeId=${selectedTypeId}`)
      .then((r) => r.json())
      .catch(() => null)
      .then((rt) => {
        setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null);
      });
  }, [selectedTypeId]);

  // Auto-set filterRep for rep users, and show their route by default
  useEffect(() => {
    if (isRep && session?.repCode && reps.length > 0) {
      setFilterRep(session.repCode);
      setShowRoute(true);
    }
  }, [isRep, session?.repCode, reps]);

  const repMap = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  // Scoped reps based on role
  const scopedReps = useMemo(() => {
    if (isRep && session?.repCode) {
      return reps.filter((r) => r.code === session.repCode);
    }
    if (isTeamManager && session?.teamId) {
      return reps.filter((r) => r.teamId === session.teamId);
    }
    return reps; // admin sees all
  }, [reps, isRep, isTeamManager, session?.repCode, session?.teamId]);

  // Visible rep codes for store filtering
  /**
   * Each rep's calls-per-day target, taken off the saved plan.
   *
   * Rebuilt whenever the plan changes, including after a subset run, so the
   * dropdown keeps up with ten reps having been moved to a new number while
   * the rest stayed put.
   */
  const repCallsPerDay = useMemo(() => {
    const out: Record<string, number | undefined> = {};
    for (const p of routes?.repPlans ?? []) out[p.repCode] = p.callsPerDay;
    return out;
  }, [routes]);
  /**
   * Which reps start their day at a real home address.
   *
   * Uses the route engine's own rule (parseRepHome), never a bare parseFloat, so this
   * badge can never claim a home the engine refuses to route from — (0,0) and
   * an out-of-range fix are exactly the values that differ.
   */
  const repStartsAtHome = useMemo(() => {
    const anchors = new Map((routes?.repPlans ?? []).map((p) => [p.repCode, p.homeLatLng]));
    const out: Record<string, "home" | "centroid" | "stale"> = {};
    for (const r of scopedReps) {
      const home = parseRepHome(r.homeGpsLat, r.homeGpsLng);
      if (!home) {
        out[r.code] = "centroid";
        continue;
      }
      const anchor = anchors.get(r.code);
      // Half a kilometre of slack: the anchor is stored rounded, and a route
      // that starts across the street is the same route.
      out[r.code] =
        anchor && haversineKm(home.lat, home.lng, anchor.lat, anchor.lng) > 0.5 ? "stale" : "home";
    }
    return out;
  }, [scopedReps, routes]);

  const visibleRepCodes = useMemo(() => {
    return new Set(scopedReps.map((r) => r.code));
  }, [scopedReps]);

  /**
   * The stores the generated plan visits on the chosen day and week, or null
   * when neither is chosen and every store stands.
   *
   * 🔴 Day used to filter on `store.dayOfWeek`, a field inherited from the
   * Clippa fork that nothing in iRam fills in, so picking a day emptied the map
   * and read as "this rep has no routes". The day a store is visited is
   * decided by route generation, so the plan is the only thing that can answer
   * it.
   */
  const scheduledStoreIds = useMemo(() => {
    if (!filterDay && !filterWeek) return null;
    const ids = new Set<string>();
    for (const plan of routes?.repPlans ?? []) {
      if (filterRep && plan.repCode !== filterRep) continue;
      if (!isAdmin && !visibleRepCodes.has(plan.repCode)) continue;
      for (const dp of plan.days) {
        if (filterDay && dp.day !== filterDay) continue;
        if (filterWeek && dp.week !== filterWeek) continue;
        for (const stop of dp.stops) ids.add(stop.storeId);
      }
    }
    return ids;
  }, [routes, filterDay, filterWeek, filterRep, isAdmin, visibleRepCodes]);

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      // Role-based scoping for non-admin users. Any of the store's reps counts
      // (sales, QC, team leader...), since each visit role has its own slot.
      const codes = storeRepCodes(s);
      if (!isAdmin && !codes.some((c) => visibleRepCodes.has(c))) return false;
      if (filterRep && !codes.includes(filterRep)) return false;
      if (scheduledStoreIds && !scheduledStoreIds.has(s.id)) return false;
      return true;
    });
  }, [stores, filterRep, scheduledStoreIds, isAdmin, visibleRepCodes]);

  // Get matching route day plans for selected rep (optionally filtered by week/day)
  const matchingDayPlans: RouteDayPlan[] = useMemo(() => {
    if (!showRoute || !routes || !filterRep) return [];
    const repPlan = routes.repPlans.find((p) => p.repCode === filterRep);
    if (!repPlan) return [];
    return repPlan.days.filter((d) => {
      if (filterWeek && d.week !== filterWeek) return false;
      if (filterDay && d.day !== filterDay) return false;
      return d.stops.length > 0;
    });
  }, [showRoute, routes, filterRep, filterWeek, filterDay]);

  // Flatten all matching stops, tagging each with the day plan it came from.
  // Sequence numbers restart at 1 in every day, so without this a Monday view
  // across four weeks renders four different markers all labelled "1" with no
  // way to tell them apart.
  const allRouteStops = useMemo(() => {
    return matchingDayPlans.flatMap((d, dayIndex) =>
      d.stops.map((s) => ({ ...s, dayIndex, week: d.week, day: d.day }))
    );
  }, [matchingDayPlans]);

  // Build per-day polyline positions. Prefer Google's road-following geometry
  // (stored on each day plan); fall back to straight lines home → stops → home.
  const routeLines = useMemo((): RouteLine[] => {
    if (matchingDayPlans.length === 0) return [];
    const home = (() => {
      const rep = repMap.get(filterRep);
      if (!rep) return null;
      const fix = parseRepHome(rep.homeGpsLat, rep.homeGpsLng);
      return fix ? ([fix.lat, fix.lng] as [number, number]) : null;
    })();
    return matchingDayPlans.map((dp) => {
      // Road-following line from the stored Google polyline, when present.
      if (dp.polyline) {
        const decoded = decodePolyline(dp.polyline);
        if (decoded.length > 1) return { positions: decoded, road: true };
      }
      // Fallback: straight segments home → stops → home. Drawn dashed, because
      // it is the order of the calls, not the drive. A day the Google budget
      // ran out on has no saved road geometry at all.
      const pts: [number, number][] = [];
      if (home) pts.push(home);
      for (const stop of dp.stops) pts.push([stop.lat, stop.lng]);
      if (home) pts.push(home);
      return { positions: pts, road: false };
    });
  }, [matchingDayPlans, filterRep, repMap]);

  // Stop 0 — where the day starts and ends.
  //
  // If the rep has no home GPS the engine anchors their route on the centroid
  // of their stores instead, and that anchor is saved on the plan. Showing it
  // is more useful than showing nothing, but it is flagged as derived so it is
  // never mistaken for an actual home address.
  const repHome = useMemo(() => {
    if (!showRoute || !filterRep) return null;
    const rep = repMap.get(filterRep);
    if (!rep) return null;

    // The engine's own check, so the pin and the route always agree about
    // whether this rep has a home: a bare parseFloat accepts (0,0) and a
    // lat/lng outside South Africa, both of which the engine rejects.
    const home = parseRepHome(rep.homeGpsLat, rep.homeGpsLng);
    const planned = routes?.repPlans.find((p) => p.repCode === filterRep)?.homeLatLng;

    if (home) {
      // 🔴 A plan is a SNAPSHOT: it stores the anchor it was built on. A home
      // address captured after the last generation leaves the saved route still
      // running from the store centroid, so pinning the house would draw a
      // start the route does not have. Pin where the route actually starts and
      // say how far that is from home. See [[derived-data-keeps-the-old-bug]].
      const apartKm = planned ? haversineKm(home.lat, home.lng, planned.lat, planned.lng) : 0;
      if (planned && apartKm > 0.5) {
        return { ...planned, derived: true, repName: rep.name, homeNotInRouteKm: apartKm };
      }
      return { ...home, derived: false, address: rep.homeAddress, repName: rep.name };
    }

    if (planned) return { lat: planned.lat, lng: planned.lng, derived: true, repName: rep.name };

    return null;
  }, [showRoute, filterRep, repMap, routes]);

  // Assign color per scoped rep
  const repColors: Record<string, string> = {};
  const colors = ["#DC2626", "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#65A30D"];
  scopedReps.forEach((r, i) => {
    repColors[r.code] = colors[i % colors.length];
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Filters bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <h1 className="text-lg font-bold text-gray-900 mr-4">Route Map</h1>

        {/* Call cycle type dropdown — always visible when types exist */}
        {routeTypes.length > 0 && (
          <select
            value={selectedTypeId}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedTypeId(val);
              if (!val) {
                fetch("/api/routes").then((r) => r.json()).catch(() => null)
                  .then((rt) => setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null));
              }
            }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          >
            <option value="">Latest Routes</option>
            {routeTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.hasRoutes ? "" : " (no routes)"}
              </option>
            ))}
          </select>
        )}

        {/* Rep dropdown — hidden for rep users (auto-selected) */}
        {!isRep && (
          <RepSearchSelect
            reps={scopedReps}
            value={filterRep}
            colors={repColors}
            visitRoles={visitRoles}
            callsPerDay={repCallsPerDay}
            startsAtHome={repStartsAtHome}
            onChange={(code) => {
              setFilterRep(code);
              if (code) setShowRoute(true);
            }}
          />
        )}

        <select
          value={filterDay}
          onChange={(e) => setFilterDay(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
        >
          <option value="">All Days</option>
          {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={filterWeek}
          onChange={(e) => setFilterWeek(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
        >
          <option value="">All Weeks</option>
          {WEEKS.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>

        {/* Route toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRoute}
            onChange={(e) => setShowRoute(e.target.checked)}
            className="rounded border-gray-300 text-iram-green focus:ring-iram-green"
          />
          Show Route
        </label>

        <span className="text-sm text-gray-500 ml-auto">
          {filtered.length} stores shown
          {scheduledStoreIds && ` scheduled on ${[filterWeek, filterDay].filter(Boolean).join(" ")}`}
          {allRouteStops.length > 0 && ` | Route: ${allRouteStops.length} stops across ${matchingDayPlans.length} day${matchingDayPlans.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Route mode hint */}
      {showRoute && !filterRep && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          Select a rep to display their route.
        </div>
      )}

      {/* A day or week can only be answered by a generated plan. Saying so beats
          an empty map, which reads as the rep having no stores. */}
      {scheduledStoreIds && filtered.length === 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          {!routes
            ? "No routes have been generated yet, so nothing is scheduled for a day or a week. Generate routes on the Routes page."
            : `Nothing is scheduled for ${[filterWeek, filterDay].filter(Boolean).join(" ")}${filterRep ? " for this rep" : ""} in the current plan. It may predate the stores you are looking for, so regenerate routes on the Routes page.`}
        </div>
      )}

      {/* Map */}
      <div className="flex-1">
        <MapView
          stores={filtered}
          repMap={repMap}
          channelMap={channelMap}
          repColors={repColors}
          visitRoles={visitRoles}
          routeStops={allRouteStops.length > 0 ? allRouteStops : undefined}
          routeDays={matchingDayPlans.length > 0 ? matchingDayPlans : undefined}
          routeLines={routeLines.length > 0 ? routeLines : undefined}
          repHome={repHome}
          showRoute={allRouteStops.length > 0}
          singleDay={matchingDayPlans.length === 1}
          fitKey={`${selectedTypeId}|${filterRep}|${filterWeek}|${filterDay}`}
        />
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
        </div>
      }
    >
      <MapPageInner />
    </Suspense>
  );
}
