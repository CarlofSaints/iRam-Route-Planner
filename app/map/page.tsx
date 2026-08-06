"use client";

import { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useSession } from "@/components/SessionProvider";
import { Store, Rep, Channel, Team, RoutePlanDocument, RouteDayPlan, WeekLabel, CallCycleStrategy } from "@/lib/types";
import { decodePolyline } from "@/lib/google-maps";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];

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
}: {
  reps: Rep[];
  value: string;
  onChange: (code: string) => void;
  colors: Record<string, string>;
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
        (r.email || "").toLowerCase().includes(q)
    );
  }, [reps, search]);

  const selected = reps.find((r) => r.code === value);

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
        <span className="truncate">{selected ? selected.name : "All Reps"}</span>
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
        <div className="absolute z-[1000] mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg">
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
                  <span className="ml-auto text-[10px] text-gray-400 font-mono flex-shrink-0">{r.code}</span>
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
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeTypes, setRouteTypes] = useState<RouteTypeInfo[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");

  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  const isTeamManager = session?.role === "teamManager";
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
    ]).then(([st, rp, ch, tm, rt, types]) => {
      setStores(Array.isArray(st) ? st : []);
      setReps(Array.isArray(rp) ? rp : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setTeams(Array.isArray(tm) ? tm : []);
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
  const visibleRepCodes = useMemo(() => {
    return new Set(scopedReps.map((r) => r.code));
  }, [scopedReps]);

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      // Role-based scoping for non-admin users
      if (!isAdmin && !visibleRepCodes.has(s.repCode)) return false;
      if (filterRep && s.repCode !== filterRep) return false;
      if (filterDay && s.dayOfWeek !== filterDay) return false;
      return true;
    });
  }, [stores, filterRep, filterDay, isAdmin, visibleRepCodes]);

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
  const routeLines = useMemo((): [number, number][][] => {
    if (matchingDayPlans.length === 0) return [];
    const home = (() => {
      const rep = repMap.get(filterRep);
      if (!rep) return null;
      const lat = parseFloat(rep.homeGpsLat);
      const lng = parseFloat(rep.homeGpsLng);
      return !isNaN(lat) && !isNaN(lng) ? [lat, lng] as [number, number] : null;
    })();
    return matchingDayPlans.map((dp) => {
      // Road-following line from the stored Google polyline, when present.
      if (dp.polyline) {
        const decoded = decodePolyline(dp.polyline);
        if (decoded.length > 1) return decoded;
      }
      // Fallback: straight segments home → stops → home.
      const pts: [number, number][] = [];
      if (home) pts.push(home);
      for (const stop of dp.stops) pts.push([stop.lat, stop.lng]);
      if (home) pts.push(home);
      return pts;
    });
  }, [matchingDayPlans, filterRep, repMap]);

  // Get rep home for route display
  const repHome = useMemo(() => {
    if (!showRoute || !filterRep) return null;
    const rep = repMap.get(filterRep);
    if (!rep) return null;
    const lat = parseFloat(rep.homeGpsLat);
    const lng = parseFloat(rep.homeGpsLng);
    return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
  }, [showRoute, filterRep, repMap]);

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
          {allRouteStops.length > 0 && ` | Route: ${allRouteStops.length} stops across ${matchingDayPlans.length} day${matchingDayPlans.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Route mode hint */}
      {showRoute && !filterRep && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          Select a rep to display their route.
        </div>
      )}

      {/* Map */}
      <div className="flex-1">
        <MapView
          stores={filtered}
          repMap={repMap}
          channelMap={channelMap}
          repColors={repColors}
          routeStops={allRouteStops.length > 0 ? allRouteStops : undefined}
          routeLines={routeLines.length > 0 ? routeLines : undefined}
          repHome={repHome}
          showRoute={allRouteStops.length > 0}
          singleDay={matchingDayPlans.length === 1}
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
