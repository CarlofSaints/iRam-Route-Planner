"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Store, Channel, Rep, Team, VisitRole, CallCycleType, RoutePlanDocument, StoreOverride, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel, getVisitRoleName, storeRoleColumns, SA_PROVINCES } from "@/lib/types";
import { storeRepForRole } from "@/lib/repStores";
import { isClosed, closedReasonLabel } from "@/lib/closedStores";
import { findNotInCycle, isCorrectlyOut, REASONS, type NotInCycleReason } from "@/lib/notInCycle";
import { useSession } from "@/components/SessionProvider";
import StoreImportModal from "@/components/StoreImportModal";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";
import { useColumnWidths } from "@/components/useColumnWidths";
import type { SortValue } from "@/lib/tableSort";

/**
 * The grid's columns, in order. One array drives the colgroup, the header and
 * the sort, so a width and its heading cannot drift apart (Clippa 14401b1).
 * `why` only appears while the not-in-a-cycle filter is on.
 */
const COLUMN_DEFAULTS: Record<string, number> = {
  placeId: 110,
  name: 220,
  channel: 150,
  province: 120,
  region: 120,
  lat: 105,
  lng: 105,
  rep: 190,
  status: 90,
  frequency: 140,
  duration: 80,
  day: 100,
  week: 70,
  why: 230,
  actions: 170,
};
const COLUMN_LABEL: Record<string, string> = {
  placeId: "Place ID",
  name: "Store Name",
  channel: "Channel",
  province: "Province",
  region: "Region",
  lat: "Latitude",
  lng: "Longitude",
  rep: "Rep",
  status: "Status",
  frequency: "Frequency",
  duration: "Duration",
  day: "Day",
  week: "Week",
  why: "Why not in a cycle",
  actions: "Actions",
};
const WIDTH_STORAGE_KEY = "stores.columnWidths.v1";

const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-ZA");
};

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const WEEKS = ["", "Wk1", "Wk2", "Wk3", "Wk4", "Wk5"];

/**
 * South Africa's bounding box. Used only to WARN — a coordinate outside it is
 * still saved and still shown, it just gets flagged so a store sitting in the
 * ocean is visible in the grid instead of only on the map.
 */
const SA_BOUNDS = { latMin: -35.0, latMax: -22.0, lngMin: 16.0, lngMax: 33.0 };

type CoordCheck = { lat: number; lng: number; ok: boolean; problem: string };

/**
 * Coordinates are stored as free text (they arrive that way from the upload),
 * so this is the one place that decides whether a pair is usable.
 */
function checkCoords(rawLat: string | undefined, rawLng: string | undefined): CoordCheck {
  const latStr = (rawLat ?? "").trim();
  const lngStr = (rawLng ?? "").trim();
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  if (!latStr || !lngStr)
    return { lat, lng, ok: false, problem: "No coordinates on this store" };
  if (Number.isNaN(lat) || Number.isNaN(lng))
    return { lat, lng, ok: false, problem: "Not a number: check for stray text or a comma decimal point" };
  if (lat === 0 && lng === 0)
    return { lat, lng, ok: false, problem: "0, 0: this plots in the Atlantic Ocean off West Africa" };
  // SA latitude is negative and longitude positive; the reverse means the two
  // columns were transposed somewhere, which lands the pin in the Atlantic.
  if (lat >= SA_BOUNDS.lngMin && lat <= SA_BOUNDS.lngMax && lng >= SA_BOUNDS.latMin && lng <= SA_BOUNDS.latMax)
    return { lat, lng, ok: false, problem: "Latitude and longitude look swapped" };
  if (lat > 0)
    return { lat, lng, ok: false, problem: "Latitude is positive. South Africa is negative, so the minus sign is missing" };
  if (lat < SA_BOUNDS.latMin || lat > SA_BOUNDS.latMax || lng < SA_BOUNDS.lngMin || lng > SA_BOUNDS.lngMax)
    return { lat, lng, ok: false, problem: "Outside South Africa" };

  return { lat, lng, ok: true, problem: "" };
}

/** Google Maps pin at an exact coordinate — not a name search, so what you see is what is stored. */
const googleMapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/* ─── Multi-select checkbox dropdown with search ─── */
function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
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

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(next);
  };

  const activeCount = selected.size;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green ${
          activeCount > 0
            ? "border-iram-green bg-red-50 text-iram-green font-medium"
            : "border-gray-200 text-gray-700 hover:bg-gray-50"
        }`}
      >
        {label}
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-iram-green text-white text-[10px] font-bold">
            {activeCount}
          </span>
        )}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-iram-green"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-2">No matches</p>
            ) : (
              filtered.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.value)}
                    onChange={() => toggle(o.value)}
                    className="accent-iram-green w-3.5 h-3.5"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>
          {activeCount > 0 && (
            <div className="p-2 border-t border-gray-100">
              <button
                onClick={() => onChange(new Set())}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StoresPage() {
  const { can } = useSession();
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [visitRoles, setVisitRoles] = useState<VisitRole[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterChannels, setFilterChannels] = useState<Set<string>>(new Set());
  const [filterReps, setFilterReps] = useState<Set<string>>(new Set());
  const [filterTeamManagers, setFilterTeamManagers] = useState<Set<string>>(new Set());
  const [filterProvinces, setFilterProvinces] = useState<Set<string>>(new Set());
  const [filterRegions, setFilterRegions] = useState<Set<string>>(new Set());
  const [filterFrequencies, setFilterFrequencies] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<Set<string>>(new Set());
  const [onlyBadCoords, setOnlyBadCoords] = useState(false);
  // Stores no sales rep visits in the four weeks, for a reason somebody can
  // act on. Reached from Rep Capacity's "unassigned" link as ?rep=X&unrouted=1.
  const [onlyUnrouted, setOnlyUnrouted] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Store>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [regionList, setRegionList] = useState<{ id: string; name: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // What the not-in-a-cycle filter needs. Loaded after the grid, so the page
  // does not wait on the route document to show the stores.
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [overrides, setOverrides] = useState<StoreOverride[]>([]);
  const [cycleTypes, setCycleTypes] = useState<CallCycleType[]>([]);
  const [cycleLoaded, setCycleLoaded] = useState(false);
  const cols = useColumnWidths(WIDTH_STORAGE_KEY, COLUMN_DEFAULTS);

  // ?rep=CODE&unrouted=1 lands on exactly the stores a link counted. Read from
  // window.location rather than useSearchParams, which would force a Suspense
  // boundary around the whole page for a value read once.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const rep = params.get("rep");
      if (rep) setFilterReps(new Set([rep]));
      if (params.get("unrouted") === "1") setOnlyUnrouted(true);
    } catch {
      // No URL to read; the unfiltered grid is fine.
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/routes").then((r) => r.json()).catch(() => null),
      fetch("/api/store-overrides").then((r) => r.json()).catch(() => ({ overrides: [] })),
      fetch("/api/call-cycle-types").then((r) => r.json()).catch(() => []),
    ]).then(([rt, ov, ct]) => {
      setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null);
      setOverrides(Array.isArray(ov?.overrides) ? ov.overrides : []);
      setCycleTypes(Array.isArray(ct) ? ct : []);
      setCycleLoaded(true);
    });
  }, []);

  const load = () => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
      fetch("/api/regions").then((r) => r.json()).catch(() => []),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
      fetch("/api/visit-roles").then((r) => r.json()).catch(() => []),
    ]).then(([st, ch, rp, reg, tm, vr]) => {
      setStores(Array.isArray(st) ? st : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setReps(Array.isArray(rp) ? rp : []);
      setRegionList(Array.isArray(reg) ? reg : []);
      setTeams(Array.isArray(tm) ? tm : []);
      setVisitRoles(Array.isArray(vr) ? vr : []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const repMap = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);

  // Filter options
  const channelOptions = useMemo(
    () => channels.map((c) => ({ value: c.id, label: c.name })),
    [channels]
  );
  const repOptions = useMemo(
    () =>
      reps.map((r) => ({
        value: r.code,
        label: `${r.name} (${getVisitRoleName(r.visitRoleId, visitRoles)}) · ${r.code}`,
      })),
    [reps, visitRoles]
  );
  const provinceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) {
      if (s.province?.trim()) set.add(s.province.trim());
    }
    return [
      { value: "__none__", label: "No Province" },
      ...Array.from(set).sort().map((p) => ({ value: p, label: p })),
    ];
  }, [stores]);
  const regionFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) {
      if (s.region?.trim()) set.add(s.region.trim());
    }
    return [
      { value: "__none__", label: "No Region" },
      ...Array.from(set).sort().map((r) => ({ value: r, label: r })),
    ];
  }, [stores]);
  const frequencyOptions = useMemo(
    () => FREQUENCY_OPTIONS.map((f) => ({ value: f.value, label: f.label })),
    []
  );
  const teamManagerOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "__unassigned__", label: "No Team" },
    ];
    for (const t of teams) {
      opts.push({ value: t.id, label: `${t.managerName} (${t.name})` });
    }
    return opts;
  }, [teams]);

  // Map repCode → teamId for filtering
  const repTeamMap = useMemo(() => new Map(reps.map((r) => [r.code, r.teamId])), [reps]);

  /**
   * Why each store is out of the sales cycle, for the actionable reasons only.
   * Closed stores and channels nobody calls on are correctly out, so they are
   * not "unrouted" and never inflate the count a link promised.
   */
  const unroutedReason = useMemo(() => {
    const out = new Map<string, NotInCycleReason>();
    if (!cycleLoaded) return out;
    const strategy = cycleTypes.find((t) => t.id === routes?.callCycleTypeId)?.strategy ?? null;
    const result = findNotInCycle({ stores, channels, overrides, routes, reps, visitRoles, strategy });
    for (const m of result.missing) if (!isCorrectlyOut(m.reason)) out.set(m.store.id, m.reason);
    return out;
  }, [cycleLoaded, stores, channels, overrides, routes, reps, visitRoles, cycleTypes]);

  const statusOptions = useMemo(() => {
    const closed = stores.filter((s) => isClosed(s)).length;
    return [
      { value: "active", label: `Active (${(stores.length - closed).toLocaleString("en-ZA")})` },
      { value: "closed", label: `Closed (${closed.toLocaleString("en-ZA")})` },
    ];
  }, [stores]);

  /** Every filter except the not-in-a-cycle one, so its button can count what the others leave. */
  const baseFiltered = useMemo(() => {
    return stores.filter((s) => {
      if (filterStatus.size > 0 && !filterStatus.has(isClosed(s) ? "closed" : "active")) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.placeId.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterChannels.size > 0 && !filterChannels.has(s.channelId)) return false;
      if (filterReps.size > 0 && !filterReps.has(s.repCode)) return false;
      if (filterTeamManagers.size > 0) {
        const teamId = repTeamMap.get(s.repCode) || "";
        if (!teamId && !filterTeamManagers.has("__unassigned__")) return false;
        if (teamId && !filterTeamManagers.has(teamId)) return false;
      }
      if (filterProvinces.size > 0) {
        const prov = s.province?.trim() || "";
        if (!prov && !filterProvinces.has("__none__")) return false;
        if (prov && !filterProvinces.has(prov)) return false;
      }
      if (filterRegions.size > 0) {
        const reg = s.region?.trim() || "";
        if (!reg && !filterRegions.has("__none__")) return false;
        if (reg && !filterRegions.has(reg)) return false;
      }
      if (filterFrequencies.size > 0 && !filterFrequencies.has(s.frequency)) return false;
      if (onlyBadCoords && checkCoords(s.gpsLat, s.gpsLng).ok) return false;
      return true;
    });
  }, [stores, search, filterChannels, filterReps, filterTeamManagers, filterProvinces, filterRegions, filterFrequencies, filterStatus, onlyBadCoords, repTeamMap]);

  const filtered = useMemo(
    () => (onlyUnrouted ? baseFiltered.filter((s) => unroutedReason.has(s.id)) : baseFiltered),
    [baseFiltered, onlyUnrouted, unroutedReason]
  );

  // Counted against what the OTHER filters leave: "Not in a cycle (412)"
  // beside a grid narrowed to one rep is how somebody concludes the button is
  // broken.
  const unroutedCount = useMemo(
    () => baseFiltered.filter((s) => unroutedReason.has(s.id)).length,
    [baseFiltered, unroutedReason]
  );

  const sort = useTableSort("", "asc", ["duration"]);
  const accessors: Record<string, (s: Store) => SortValue> = {
    placeId: (s) => s.placeId,
    name: (s) => s.name,
    channel: (s) => channelMap.get(s.channelId)?.name || s.channelId || null,
    province: (s) => s.province?.trim() || null,
    region: (s) => s.region?.trim() || null,
    // Coordinates sort as numbers; a blank or broken one sinks either way.
    lat: (s) => (checkCoords(s.gpsLat, s.gpsLng).ok ? parseFloat(s.gpsLat) : null),
    lng: (s) => (checkCoords(s.gpsLat, s.gpsLng).ok ? parseFloat(s.gpsLng) : null),
    rep: (s) => repMap.get(s.repCode)?.name || s.repCode || null,
    status: (s) => (isClosed(s) ? "Closed" : "Active"),
    frequency: (s) => FREQUENCY_OPTIONS.findIndex((f) => f.value === s.frequency),
    duration: (s) => s.duration ?? null,
    day: (s) => (s.dayOfWeek ? DAYS.indexOf(s.dayOfWeek) : null),
    week: (s) => s.weekNumber || null,
    why: (s) => {
      const r = unroutedReason.get(s.id);
      return r ? REASONS[r].rank : null;
    },
  };
  const sorted = useSortedRows(filtered, accessors, sort);

  const badCoordCount = useMemo(
    () => stores.filter((s) => !checkCoords(s.gpsLat, s.gpsLng).ok).length,
    [stores]
  );

  const hasFilters = !!search || filterChannels.size > 0 || filterReps.size > 0 || filterTeamManagers.size > 0 || filterProvinces.size > 0 || filterRegions.size > 0 || filterFrequencies.size > 0 || filterStatus.size > 0 || onlyBadCoords || onlyUnrouted;

  const clearAllFilters = () => {
    setSearch("");
    setFilterChannels(new Set());
    setFilterReps(new Set());
    setFilterTeamManagers(new Set());
    setFilterProvinces(new Set());
    setFilterRegions(new Set());
    setFilterFrequencies(new Set());
    setFilterStatus(new Set());
    setOnlyBadCoords(false);
    setOnlyUnrouted(false);
  };

  /** Plain-English list of what is currently narrowing the grid. */
  const activeFilters = useMemo(() => {
    const out: string[] = [];
    if (search.trim()) out.push(`Search: "${search.trim()}"`);
    const named = (ids: Set<string>, lookup: (id: string) => string) =>
      Array.from(ids).map(lookup).join(", ");
    if (filterChannels.size)
      out.push(`Channels: ${named(filterChannels, (id) => channelMap.get(id)?.name || id)}`);
    if (filterReps.size)
      out.push(`Reps: ${named(filterReps, (c) => repMap.get(c)?.name || c)}`);
    if (filterTeamManagers.size)
      out.push(
        `Team Manager: ${named(filterTeamManagers, (id) =>
          id === "__unassigned__" ? "No Team" : teams.find((t) => t.id === id)?.managerName || id
        )}`
      );
    if (filterProvinces.size)
      out.push(`Provinces: ${named(filterProvinces, (p) => (p === "__none__" ? "No Province" : p))}`);
    if (filterRegions.size)
      out.push(`Regions: ${named(filterRegions, (r) => (r === "__none__" ? "No Region" : r))}`);
    if (filterFrequencies.size)
      out.push(`Frequency: ${named(filterFrequencies, (f) => getFrequencyLabel(f as FrequencyType))}`);
    if (filterStatus.size)
      out.push(`Status: ${named(filterStatus, (v) => (v === "closed" ? "Closed" : "Active"))}`);
    if (onlyBadCoords) out.push("GPS problems only");
    if (onlyUnrouted) out.push("Not in a sales cycle only (closed stores and channels nobody calls on left out)");
    return out;
  }, [search, filterChannels, filterReps, filterTeamManagers, filterProvinces, filterRegions, filterFrequencies, filterStatus, onlyBadCoords, onlyUnrouted, channelMap, repMap, teams]);

  /**
   * Export what is on screen.
   *
   * Built in the browser rather than by an API route so the file is exactly the
   * filtered, ranked grid the user is looking at. A server route would have to
   * re-implement all eight filters and the three rankings, and the moment the
   * two drifted the file would stop matching the page it came from.
   *
   * xlsx is imported on click so it stays out of this page's initial bundle.
   */
  const exportExcel = async () => {
    setExporting(true);
    try {
      const { utils, write } = await import("xlsx");
      const extraRoles = visitRoles.filter((r) => !r.isPrimary);

      const header = [
        "PLACE ID",
        "PLACE NAME",
        "CHANNEL",
        "PROVINCE",
        "REGION",
        "GPS LATITUDE",
        "GPS LONGITUDE",
        "GPS PROBLEM",
        // Active / Closed. Read back by Import Excel, so a store can be closed
        // ("Closed") or reopened ("Reopen") in bulk. "Active" never reopens a
        // store that has been closed since, and a blank cell changes nothing.
        "STATUS",
        "REPRESENTATIVE ID",
        "REPRESENTATIVE NAME",
        "VISIT ROLE",
        "TEAM",
        // One pair per non-primary role, matching the upload template exactly,
        // so an export can be edited and sent straight back in.
        ...extraRoles.flatMap((r) => {
          const c = storeRoleColumns(r);
          return [c.id, c.name];
        }),
        "FREQUENCY",
        "DURATION (MIN)",
        "DAY",
        "WEEK",
      ];

      const rows: (string | number)[][] = [header];

      // The rows on screen, in the order on screen.
      for (const s of sorted) {
        const rep = repMap.get(s.repCode);
        const coords = checkCoords(s.gpsLat, s.gpsLng);
        const team = rep?.teamId ? teams.find((t) => t.id === rep.teamId) : undefined;
        rows.push([
          s.placeId || "",
          s.name || "",
          channelMap.get(s.channelId)?.name || s.channelId || "",
          s.province?.trim() || "",
          s.region?.trim() || "",
          s.gpsLat?.trim() || "",
          s.gpsLng?.trim() || "",
          // The reason a coordinate is unusable, in the same words the grid
          // shows on hover. Blank means the pin is fine — this column is the
          // whole point of exporting the GPS problems filter.
          coords.ok ? "" : coords.problem,
          isClosed(s) ? "Closed" : "Active",
          s.repCode || "",
          rep?.name || "",
          rep ? getVisitRoleName(rep.visitRoleId, visitRoles) : "",
          team?.name || "",
          ...extraRoles.flatMap((r) => {
            const code = storeRepForRole(s, r);
            return [code, code ? repMap.get(code)?.name || "" : ""];
          }),
          getFrequencyLabel(s.frequency),
          s.duration ?? 0,
          s.dayOfWeek || "",
          s.weekNumber || "",
        ]);
      }

      const ws = utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 14 }, { wch: 34 }, { wch: 20 }, { wch: 16 }, { wch: 18 },
        { wch: 14 }, { wch: 14 }, { wch: 46 }, { wch: 9 }, { wch: 14 }, { wch: 24 },
        { wch: 16 }, { wch: 20 },
        ...extraRoles.flatMap((r) => [
          { wch: Math.max(14, r.name.length + 5) },
          { wch: Math.max(20, r.name.length + 8) },
        ]),
        { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 8 },
      ];
      // Freeze the header so 1 200 rows stay readable.
      ws["!freeze"] = { xSplit: "0", ySplit: "1" };
      ws["!autofilter"] = { ref: utils.encode_range({ s: { c: 0, r: 0 }, e: { c: header.length - 1, r: rows.length - 1 } }) };

      // A filtered file that does not say it is filtered is how someone
      // concludes there are only 99 stores in the business.
      const notes: (string | number)[][] = [
        ["Stores export"],
        ["Generated", new Date().toLocaleString("en-ZA")],
        ["Rows in this file", filtered.length],
        ["Stores in the system", stores.length],
        [],
        ["Filters applied"],
        ...(activeFilters.length
          ? activeFilters.map((f) => ["", f])
          : [["", "None. This is every store."]]),
        [],
        ["Sending this file back"],
        ["", "Import Excel on the Stores page reads PLACE ID, PLACE NAME, CHANNEL, PROVINCE, REGION, GPS LATITUDE, GPS LONGITUDE and STATUS: store details only. It never reads a rep, visit role or team column, so the personnel columns can be wrong, or deleted entirely, without any effect. Correcting GPS LATITUDE and GPS LONGITUDE and importing here is the bulk way to fix the stores listed under GPS PROBLEM."],
        ["", "It updates existing stores only, matched on PLACE ID, and it will not create a channel. A channel name that matches nothing is reported and that store keeps the channel it has. Rows whose PLACE ID is not already in the system are listed back, not created."],
        ["", "A column you DELETE from this file is left untouched on every store. A column you keep but leave BLANK clears that field, which is how a wrong coordinate is removed in bulk."],
        ["", "STATUS is the exception: type Closed to close a store, and a BLANK status cell changes nothing. A closed store is left out of every call cycle until it is reopened."],
        ["", "To reopen a closed store, type Reopen in its STATUS cell. Active does NOT reopen a store, so an older copy of this file sent back after a store was closed leaves it closed. The import lists every store it closed or reopened, and any closed store the file called Active."],
        ["", "It does NOT read FREQUENCY, DURATION, DAY or WEEK. Those come from the Channels page or from editing a store, and a change made in this file will not come back in."],
        ["", "Store Upload (under Admin) is the other door: use it to ADD stores or to load rep and visit-role assignments. It writes the personnel columns, so only send it a file where those are correct."],
        ["", extraRoles.length
          ? `There is one ID/NAME column pair per visit role (${extraRoles.map((r) => r.name).join(", ")}). Those are for Store Upload. On Store Upload, blanking one removes that rep from that role at that store, because the column is present.`
          : "Only the primary visit role exists, so there are no extra rep columns. Create roles under Visit Roles and they appear here."],
      ];
      const notesWs = utils.aoa_to_sheet(notes);
      notesWs["!cols"] = [{ wch: 22 }, { wch: 110 }];

      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Stores");
      utils.book_append_sheet(wb, notesWs, "Notes");

      // The unrouted view exports WHY and WHERE the fix happens, because store
      // data comes from Perigee and each Store Upload copies it over this app.
      if (onlyUnrouted) {
        const whyRows: (string | number)[][] = [
          ["PLACE ID", "PLACE NAME", "REPRESENTATIVE ID", "REPRESENTATIVE NAME", "WHY NOT IN A CYCLE", "WHAT TO DO", "WHERE TO FIX IT"],
        ];
        for (const s of sorted) {
          const why = unroutedReason.get(s.id);
          if (!why) continue;
          whyRows.push([
            s.placeId || "", s.name || "", s.repCode || "", repMap.get(s.repCode)?.name || "",
            REASONS[why].label, REASONS[why].action ?? "", REASONS[why].fixIn,
          ]);
        }
        const whyWs = utils.aoa_to_sheet(whyRows);
        whyWs["!cols"] = [14, 34, 14, 24, 34, 50, 80].map((wch) => ({ wch }));
        utils.book_append_sheet(wb, whyWs, "Not in a cycle");
      }

      const buf = write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Stores${activeFilters.length ? "_filtered" : ""}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const startEdit = (store: Store) => {
    setEditing(store.id);
    setSaveError("");
    setEditData({
      closed: isClosed(store),
      repCode: store.repCode,
      channelId: store.channelId,
      frequency: store.frequency,
      duration: store.duration,
      dayOfWeek: store.dayOfWeek,
      weekNumber: store.weekNumber,
      province: store.province || "",
      region: store.region || "",
      gpsLat: store.gpsLat || "",
      gpsLng: store.gpsLng || "",
    });
  };

  const saveEdit = async (id: string) => {
    const store = stores.find((s) => s.id === id);
    // Status goes only when it CHANGED. Sending it on every save would make a
    // routine coordinate fix look like a decision about whether the shop trades.
    const { closed, ...rest } = editData;
    const body: Partial<Store> & { id: string } = { id, ...rest };
    if (store && closed !== undefined && closed !== isClosed(store)) {
      if (closed && !confirm(`Mark ${store.name} as Closed? It will be left out of every call cycle from the next route generation.`)) return;
      body.closed = closed;
    }
    setSaving(true);
    setSaveError("");
    const res = await fetch("/api/stores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      // Keep the row open with what was typed: a refused save that closes the
      // editor reads as a save that worked.
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error || `Could not save (HTTP ${res.status}).`);
      return;
    }
    setEditing(null);
    setEditData({});
    load();
  };

  /** The columns on screen, left to right. */
  const visibleColumns = [
    "placeId", "name", "channel", "province", "region", "lat", "lng", "rep", "status",
    "frequency", "duration", "day", "week", ...(onlyUnrouted ? ["why"] : []), "actions",
  ];

  /**
   * The drag grip on a header's right edge. A plain function returning a span,
   * NOT a nested component: a component declared in here gets a new identity
   * every render, and React would rebuild the grip mid-drag. onClick stops the
   * click reaching the header, which would otherwise re-sort the grid.
   */
  const renderGrip = (key: string) => (
    <span
      onPointerDown={(e) => cols.startResize(key, e)}
      onDoubleClick={(e) => { e.stopPropagation(); cols.resetColumn(key); }}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize. Double-click to reset."
      className="absolute top-0 bottom-0 right-0 w-2 cursor-col-resize z-30 hover:bg-iram-green/30"
    >
      <span className="absolute right-0 top-1 bottom-1 w-px bg-gray-300" />
    </span>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stores</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} of {stores.length} stores
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can("export_data") && (
            <button
              onClick={exportExcel}
              disabled={exporting || filtered.length === 0}
              title={
                activeFilters.length
                  ? "Downloads the filtered list you are looking at. The filters are listed on the Notes sheet"
                  : "Downloads every store"
              }
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {exporting
                ? "Building..."
                : `Export Excel (${filtered.length.toLocaleString("en-ZA")}${activeFilters.length ? " filtered" : ""})`}
            </button>
          )}
          {/* The return leg of the export. Deliberately not a link to Store
              Upload: that page loads people too, and a file with no rep columns
              going through it unassigns every store it touches. */}
          {can("upload_stores") && (
            <button
              onClick={() => setImportOpen(true)}
              title="Send the exported file back after fixing GPS coordinates or store details. Reps and teams are not touched."
              className="px-4 py-2 bg-iram-green hover:bg-iram-green-dark text-white text-sm font-medium rounded-lg transition-colors"
            >
              Import Excel
            </button>
          )}
        </div>
      </div>

      {importOpen && (
        <StoreImportModal onClose={() => setImportOpen(false)} onImported={load} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search store name or ID..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-iram-green"
        />
        <FilterDropdown
          label="Channels"
          options={channelOptions}
          selected={filterChannels}
          onChange={setFilterChannels}
        />
        <FilterDropdown
          label="Reps"
          options={repOptions}
          selected={filterReps}
          onChange={setFilterReps}
        />
        <FilterDropdown
          label="Team Manager"
          options={teamManagerOptions}
          selected={filterTeamManagers}
          onChange={setFilterTeamManagers}
        />
        <FilterDropdown
          label="Provinces"
          options={provinceOptions}
          selected={filterProvinces}
          onChange={setFilterProvinces}
        />
        <FilterDropdown
          label="Regions"
          options={regionFilterOptions}
          selected={filterRegions}
          onChange={setFilterRegions}
        />
        <FilterDropdown
          label="Frequency"
          options={frequencyOptions}
          selected={filterFrequencies}
          onChange={setFilterFrequencies}
        />
        <FilterDropdown
          label="Status"
          options={statusOptions}
          selected={filterStatus}
          onChange={setFilterStatus}
        />
        <button
          onClick={() => setOnlyBadCoords((p) => !p)}
          title="Blank, unparseable, swapped, or outside South Africa"
          className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm ${
            onlyBadCoords
              ? "border-amber-500 bg-amber-50 text-amber-800 font-medium"
              : "border-gray-200 text-gray-700 hover:bg-gray-50"
          }`}
        >
          GPS problems
          <span
            className={`inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[10px] font-bold ${
              badCoordCount > 0 ? "bg-amber-500 text-white" : "bg-gray-200 text-gray-500"
            }`}
          >
            {badCoordCount}
          </span>
        </button>
        <button
          onClick={() => setOnlyUnrouted((p) => !p)}
          disabled={!cycleLoaded}
          title={
            routes
              ? "Stores no sales rep visits in the four weeks, for a reason somebody can fix. Closed stores and channels nobody calls on are left out."
              : "No routes have been generated yet, so no store is in a cycle"
          }
          className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${
            onlyUnrouted
              ? "border-violet-500 bg-violet-50 text-violet-800 font-medium"
              : "border-gray-200 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Not in a cycle
          <span
            className={`inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[10px] font-bold ${
              unroutedCount > 0 ? "bg-violet-500 text-white" : "bg-gray-200 text-gray-500"
            }`}
          >
            {cycleLoaded ? unroutedCount.toLocaleString("en-ZA") : "..."}
          </span>
        </button>
        {hasFilters && (
          <button
            onClick={clearAllFilters}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stat Cards */}
      {(() => {
        const uniqueRegions = new Set(filtered.map((s) => (s.region || "").trim()).filter(Boolean));
        const uniqueProvinces = new Set(filtered.map((s) => (s.province || "").trim()).filter(Boolean));
        const uniqueReps = new Set(filtered.map((s) => (s.repCode || "").trim()).filter(Boolean));
        // SHOWN, never silently subtracted: the Stores card still counts them.
        const closedCount = filtered.filter((s) => isClosed(s)).length;
        const cards = [
          { label: "Stores", value: filtered.length, color: "text-gray-900" },
          { label: "Closed", value: closedCount, color: closedCount > 0 ? "text-gray-500" : "text-gray-300" },
          { label: "Reps", value: uniqueReps.size, color: "text-green-600" },
          { label: "Regions", value: uniqueRegions.size, color: "text-blue-600" },
          { label: "Provinces", value: uniqueProvinces.size, color: "text-purple-600" },
        ];
        return (
          <div className="grid grid-cols-5 gap-4 mb-4">
            {cards.map((c) => (
              <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{c.label}</p>
                <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {saveError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError("")} className="text-xs opacity-60 hover:opacity-100 ml-4">dismiss</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2 text-xs text-gray-400">
        <span>Click a heading to sort. Drag a heading&apos;s right edge to resize it; double-click the edge to reset it.</span>
        {cols.customised && (
          <button
            onClick={cols.resetAll}
            title="Put every column back to its default width"
            className="text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
          >
            Reset column widths
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* The header is sticky against THIS container, so it needs its own
            scroll and a bounded height; otherwise the page scrolls instead and
            the header leaves with it. */}
        <div className="overflow-auto max-h-[calc(100vh-24rem)]">
          <table
            className="text-xs table-fixed border-separate border-spacing-0"
            style={{ width: visibleColumns.reduce((sum, key) => sum + cols.widthOf(key), 0) }}
          >
            <colgroup>
              {visibleColumns.map((key) => (
                <col key={key} style={{ width: cols.widthOf(key) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50 text-left text-[10px] text-gray-500 uppercase tracking-wider">
                {visibleColumns.map((key) => (
                  <SortableTh
                    key={key}
                    sortId={key === "actions" ? undefined : key}
                    sort={sort}
                    align={key === "duration" || key === "actions" ? "right" : "left"}
                    className="px-3 py-2 bg-gray-50 border-b border-gray-200 truncate"
                    grip={renderGrip(key)}
                  >
                    {COLUMN_LABEL[key]}
                  </SortableTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((store) => {
                const isEditing = editing === store.id;
                const ch = channelMap.get(store.channelId);
                const rep = repMap.get(store.repCode);
                const coords = checkCoords(store.gpsLat, store.gpsLng);
                // While editing, check-on-map follows what has been TYPED, not
                // what is saved: that is the point of it, to test a correction
                // before committing it.
                const editCoords = isEditing ? checkCoords(editData.gpsLat, editData.gpsLng) : coords;
                const shown = isEditing ? editCoords : coords;
                const mappable = !Number.isNaN(shown.lat) && !Number.isNaN(shown.lng);
                const closed = isClosed(store);
                const why = unroutedReason.get(store.id);
                const td = "px-3 py-2 border-b border-gray-50";
                return (
                  <tr key={store.id} className={`hover:bg-gray-50 ${closed && !isEditing ? "text-gray-400" : ""}`}>
                    <td className={`${td} font-mono text-gray-500 truncate`} title={store.placeId}>{store.placeId}</td>
                    <td className={`${td} font-medium truncate ${closed ? "text-gray-400 line-through decoration-gray-300" : "text-gray-900"}`} title={store.name}>
                      {store.name}
                    </td>

                    {isEditing ? (
                      <>
                        <td className={td}>
                          <select
                            value={editData.channelId || ""}
                            onChange={(e) => setEditData({ ...editData, channelId: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {channels.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className={td}>
                          <select
                            value={editData.province || ""}
                            onChange={(e) => setEditData({ ...editData, province: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            <option value="">None</option>
                            {SA_PROVINCES.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </td>
                        <td className={td}>
                          <select
                            value={editData.region || ""}
                            onChange={(e) => setEditData({ ...editData, region: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            <option value="">None</option>
                            {regionList.map((r) => (
                              <option key={r.id} value={r.name}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className={td}>
                          <input
                            value={editData.gpsLat ?? ""}
                            onChange={(e) => setEditData({ ...editData, gpsLat: e.target.value })}
                            placeholder="-26.0597"
                            className={`border rounded px-1 py-0.5 text-xs w-full font-mono ${
                              editCoords.ok ? "border-gray-200" : "border-amber-400 bg-amber-50"
                            }`}
                          />
                        </td>
                        <td className={td}>
                          <input
                            value={editData.gpsLng ?? ""}
                            onChange={(e) => setEditData({ ...editData, gpsLng: e.target.value })}
                            placeholder="28.0920"
                            className={`border rounded px-1 py-0.5 text-xs w-full font-mono ${
                              editCoords.ok ? "border-gray-200" : "border-amber-400 bg-amber-50"
                            }`}
                          />
                        </td>
                        <td className={td}>
                          <select
                            value={editData.repCode || ""}
                            onChange={(e) => setEditData({ ...editData, repCode: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {/* A store whose rep code names nobody must not
                                show (and then save) the first rep as if chosen. */}
                            {!repMap.has(editData.repCode || "") && (
                              <option value={editData.repCode || ""}>{editData.repCode ? `${editData.repCode} (no such rep)` : "No rep"}</option>
                            )}
                            {reps.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.name} ({getVisitRoleName(r.visitRoleId, visitRoles)})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={td}>
                          <select
                            value={editData.closed ? "closed" : "active"}
                            onChange={(e) => setEditData({ ...editData, closed: e.target.value === "closed" })}
                            title="A closed store is left out of every call cycle"
                            className={`border rounded px-1 py-0.5 text-xs w-full ${
                              editData.closed ? "border-gray-400 bg-gray-100" : "border-gray-200"
                            }`}
                          >
                            <option value="active">Active</option>
                            <option value="closed">Closed</option>
                          </select>
                        </td>
                        <td className={td}>
                          <select
                            value={editData.frequency || "monthly"}
                            onChange={(e) => setEditData({ ...editData, frequency: e.target.value as FrequencyType })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {FREQUENCY_OPTIONS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className={td}>
                          <input
                            type="number"
                            value={editData.duration ?? 30}
                            onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full text-right"
                          />
                        </td>
                        <td className={td}>
                          <select
                            value={editData.dayOfWeek || ""}
                            onChange={(e) => setEditData({ ...editData, dayOfWeek: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {DAYS.map((d) => (
                              <option key={d} value={d}>{d || "-"}</option>
                            ))}
                          </select>
                        </td>
                        <td className={td}>
                          <select
                            value={editData.weekNumber || ""}
                            onChange={(e) => setEditData({ ...editData, weekNumber: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {WEEKS.map((w) => (
                              <option key={w} value={w}>{w || "-"}</option>
                            ))}
                          </select>
                        </td>
                        {onlyUnrouted && <td className={`${td} text-gray-500 truncate`}>{why ? REASONS[why].label : ""}</td>}
                        <td className={`${td} text-right space-x-2 whitespace-nowrap`}>
                          {mappable ? (
                            <a
                              href={googleMapsUrl(shown.lat, shown.lng)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open these coordinates in Google Maps (unsaved edits included)"
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Check on Map
                            </a>
                          ) : (
                            <span className="text-gray-300" title={shown.problem}>Check on Map</span>
                          )}
                          <button onClick={() => saveEdit(store.id)} disabled={saving} className="text-green-600 hover:text-green-800 font-medium">
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button onClick={() => { setEditing(null); setEditData({}); setSaveError(""); }} className="text-gray-400 hover:text-gray-600 font-medium">
                            Cancel
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={`${td} text-gray-600 truncate`} title={ch?.name || store.channelId}>
                          {ch?.name || store.channelId}
                          {ch?.notARepChannel && (
                            <span className="ml-1 text-[10px] text-gray-400" title="Nobody calls on this channel (Channels page, Called on?)">not called on</span>
                          )}
                        </td>
                        <td className={`${td} text-gray-500 truncate`}>{store.province || "-"}</td>
                        <td className={`${td} text-gray-500 truncate`}>{store.region || "-"}</td>
                        <td
                          className={`${td} font-mono truncate ${coords.ok ? "text-gray-500" : "text-amber-700 font-semibold"}`}
                          title={coords.ok ? "" : coords.problem}
                        >
                          {store.gpsLat?.trim() || "-"}
                          {!coords.ok && <span className="ml-1" aria-label="coordinate problem">{"⚠"}</span>}
                        </td>
                        <td
                          className={`${td} font-mono truncate ${coords.ok ? "text-gray-500" : "text-amber-700 font-semibold"}`}
                          title={coords.ok ? "" : coords.problem}
                        >
                          {store.gpsLng?.trim() || "-"}
                        </td>
                        <td className={`${td} text-gray-600 truncate`} title={rep ? `${rep.name} (${getVisitRoleName(rep.visitRoleId, visitRoles)})` : store.repCode}>
                          {rep?.name || store.repCode || <span className="text-red-500">No rep</span>}
                          {rep && (
                            <span className="text-gray-400">
                              {" "}({getVisitRoleName(rep.visitRoleId, visitRoles)})
                            </span>
                          )}
                        </td>
                        <td className={td}>
                          <span
                            title={
                              closed
                                ? `${closedReasonLabel(store)}${store.closedAt ? ` on ${fmtDate(store.closedAt)}` : ""}. Left out of every call cycle.`
                                : "Open, and in the call cycles"
                            }
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              closed ? "bg-gray-200 text-gray-600" : "bg-green-50 text-green-700"
                            }`}
                          >
                            {closed ? "Closed" : "Active"}
                          </span>
                        </td>
                        <td className={`${td} text-gray-600 truncate`}>{getFrequencyLabel(store.frequency)}</td>
                        <td className={`${td} text-right text-gray-600`}>{store.duration}m</td>
                        <td className={`${td} text-gray-500`}>{store.dayOfWeek || "-"}</td>
                        <td className={`${td} text-gray-500`}>{store.weekNumber || "-"}</td>
                        {onlyUnrouted && (
                          <td className={`${td} truncate`} title={why ? `${REASONS[why].label}. ${REASONS[why].action ?? ""}` : ""}>
                            {why && (
                              <>
                                <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: REASONS[why].colour }} />
                                <span className="text-gray-700">{REASONS[why].label}</span>
                              </>
                            )}
                          </td>
                        )}
                        <td className={`${td} text-right space-x-2 whitespace-nowrap`}>
                          {mappable ? (
                            <a
                              href={googleMapsUrl(coords.lat, coords.lng)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open ${coords.lat}, ${coords.lng} in Google Maps`}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Check on Map
                            </a>
                          ) : (
                            <span className="text-gray-300" title={coords.problem}>Check on Map</span>
                          )}
                          {can("manage_stores") && (
                            <button onClick={() => startEdit(store)} className="text-iram-green hover:text-iram-green-dark font-medium">
                              Edit
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6 py-8 text-center text-gray-400">
                    {/* Until the routes are in, every store looks unrouted-free,
                        and claiming they are all in a cycle would be false. */}
                    {onlyUnrouted && !cycleLoaded
                      ? "Loading the call cycles to find the stores not in one..."
                      : onlyUnrouted && unroutedCount === 0
                      ? "Every store these filters leave is in a sales cycle, closed, or in a channel nobody calls on."
                      : "No store matches these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
