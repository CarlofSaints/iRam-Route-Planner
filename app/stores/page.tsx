"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Store, Channel, Rep, Team, VisitRole, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel, getVisitRoleName, SA_PROVINCES } from "@/lib/types";

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
    return { lat, lng, ok: false, problem: "Not a number — check for stray text or a comma decimal point" };
  if (lat === 0 && lng === 0)
    return { lat, lng, ok: false, problem: "0, 0 — this plots in the Atlantic Ocean off West Africa" };
  // SA latitude is negative and longitude positive; the reverse means the two
  // columns were transposed somewhere, which lands the pin in the Atlantic.
  if (lat >= SA_BOUNDS.lngMin && lat <= SA_BOUNDS.lngMax && lng >= SA_BOUNDS.latMin && lng <= SA_BOUNDS.latMax)
    return { lat, lng, ok: false, problem: "Latitude and longitude look swapped" };
  if (lat > 0)
    return { lat, lng, ok: false, problem: "Latitude is positive — South Africa is negative, the minus sign is missing" };
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
  const [onlyBadCoords, setOnlyBadCoords] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Store>>({});
  const [saving, setSaving] = useState(false);
  const [regionList, setRegionList] = useState<{ id: string; name: string }[]>([]);

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

  // Rankings
  const rankings = useMemo(() => {
    const sorted = [...stores].sort((a, b) => (b.monthlySales ?? 0) - (a.monthlySales ?? 0));
    const overallRank = new Map<string, number>();
    sorted.forEach((s, i) => overallRank.set(s.id, i + 1));

    const repRank = new Map<string, number>();
    const byRep = new Map<string, Store[]>();
    stores.forEach((s) => {
      const arr = byRep.get(s.repCode) || [];
      arr.push(s);
      byRep.set(s.repCode, arr);
    });
    byRep.forEach((arr) => {
      arr.sort((a, b) => (b.monthlySales ?? 0) - (a.monthlySales ?? 0));
      arr.forEach((s, i) => repRank.set(s.id, i + 1));
    });

    const channelRank = new Map<string, number>();
    const byCh = new Map<string, Store[]>();
    stores.forEach((s) => {
      const arr = byCh.get(s.channelId) || [];
      arr.push(s);
      byCh.set(s.channelId, arr);
    });
    byCh.forEach((arr) => {
      arr.sort((a, b) => (b.monthlySales ?? 0) - (a.monthlySales ?? 0));
      arr.forEach((s, i) => channelRank.set(s.id, i + 1));
    });

    return { overallRank, repRank, channelRank };
  }, [stores]);

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

  const filtered = useMemo(() => {
    return stores.filter((s) => {
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
  }, [stores, search, filterChannels, filterReps, filterTeamManagers, filterProvinces, filterRegions, filterFrequencies, onlyBadCoords, repTeamMap]);

  const badCoordCount = useMemo(
    () => stores.filter((s) => !checkCoords(s.gpsLat, s.gpsLng).ok).length,
    [stores]
  );

  const hasFilters = !!search || filterChannels.size > 0 || filterReps.size > 0 || filterTeamManagers.size > 0 || filterProvinces.size > 0 || filterRegions.size > 0 || filterFrequencies.size > 0 || onlyBadCoords;

  const clearAllFilters = () => {
    setSearch("");
    setFilterChannels(new Set());
    setFilterReps(new Set());
    setFilterTeamManagers(new Set());
    setFilterProvinces(new Set());
    setFilterRegions(new Set());
    setFilterFrequencies(new Set());
    setOnlyBadCoords(false);
  };

  const startEdit = (store: Store) => {
    setEditing(store.id);
    setEditData({
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
    setSaving(true);
    await fetch("/api/stores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

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
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stores</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} of {stores.length} stores
          </p>
        </div>
      </div>

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
        const cards = [
          { label: "Stores", value: filtered.length, color: "text-gray-900" },
          { label: "Reps", value: uniqueReps.size, color: "text-green-600" },
          { label: "Regions", value: uniqueRegions.size, color: "text-blue-600" },
          { label: "Provinces", value: uniqueProvinces.size, color: "text-purple-600" },
        ];
        return (
          <div className="grid grid-cols-4 gap-4 mb-4">
            {cards.map((c) => (
              <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{c.label}</p>
                <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* The header is sticky against THIS container, so it needs its own
            scroll and a bounded height — otherwise the page scrolls instead and
            the header leaves with it. */}
        <div className="overflow-auto max-h-[calc(100vh-22rem)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50 text-left text-[10px] text-gray-500 uppercase tracking-wider shadow-[inset_0_-1px_0_0_rgb(229,231,235)]">
                <th className="px-3 py-2 bg-gray-50">Place ID</th>
                <th className="px-3 py-2 bg-gray-50">Store Name</th>
                <th className="px-3 py-2 bg-gray-50">Channel</th>
                <th className="px-3 py-2 bg-gray-50">Province</th>
                <th className="px-3 py-2 bg-gray-50">Region</th>
                <th className="px-3 py-2 bg-gray-50">Latitude</th>
                <th className="px-3 py-2 bg-gray-50">Longitude</th>
                <th className="px-3 py-2 bg-gray-50">Rep</th>
                <th className="px-3 py-2 bg-gray-50 text-right">Monthly Sales</th>
                <th className="px-3 py-2 bg-gray-50 text-center">Rank Overall</th>
                <th className="px-3 py-2 bg-gray-50 text-center">Rank/Rep</th>
                <th className="px-3 py-2 bg-gray-50 text-center">Rank/Channel</th>
                <th className="px-3 py-2 bg-gray-50">Frequency</th>
                <th className="px-3 py-2 bg-gray-50 text-right">Duration</th>
                <th className="px-3 py-2 bg-gray-50">Day</th>
                <th className="px-3 py-2 bg-gray-50">Week</th>
                <th className="px-3 py-2 bg-gray-50 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((store) => {
                const isEditing = editing === store.id;
                const ch = channelMap.get(store.channelId);
                const rep = repMap.get(store.repCode);
                const coords = checkCoords(store.gpsLat, store.gpsLng);
                // While editing, check-on-map follows what has been TYPED, not
                // what is saved — that is the point of it, to test a correction
                // before committing it.
                const editCoords = isEditing
                  ? checkCoords(editData.gpsLat, editData.gpsLng)
                  : coords;
                const shown = isEditing ? editCoords : coords;
                const mappable = !Number.isNaN(shown.lat) && !Number.isNaN(shown.lng);
                return (
                  <tr key={store.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-500">{store.placeId}</td>
                    <td className="px-3 py-2 font-medium text-gray-900 max-w-[200px] truncate" title={store.name}>
                      {store.name}
                    </td>

                    {isEditing ? (
                      <>
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2">
                          <select
                            value={editData.province || ""}
                            onChange={(e) => setEditData({ ...editData, province: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            <option value="">—</option>
                            {SA_PROVINCES.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.region || ""}
                            onChange={(e) => setEditData({ ...editData, region: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            <option value="">—</option>
                            {regionList.map((r) => (
                              <option key={r.id} value={r.name}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={editData.gpsLat ?? ""}
                            onChange={(e) => setEditData({ ...editData, gpsLat: e.target.value })}
                            placeholder="-26.0597"
                            className={`border rounded px-1 py-0.5 text-xs w-24 font-mono ${
                              editCoords.ok ? "border-gray-200" : "border-amber-400 bg-amber-50"
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={editData.gpsLng ?? ""}
                            onChange={(e) => setEditData({ ...editData, gpsLng: e.target.value })}
                            placeholder="28.0920"
                            className={`border rounded px-1 py-0.5 text-xs w-24 font-mono ${
                              editCoords.ok ? "border-gray-200" : "border-amber-400 bg-amber-50"
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.repCode || ""}
                            onChange={(e) => setEditData({ ...editData, repCode: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {reps.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.name} ({getVisitRoleName(r.visitRoleId, visitRoles)})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{fmt(store.monthlySales)}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.overallRank.get(store.id)}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.repRank.get(store.id)}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.channelRank.get(store.id)}</td>
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={editData.duration ?? 30}
                            onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-14 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.dayOfWeek || ""}
                            onChange={(e) => setEditData({ ...editData, dayOfWeek: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {DAYS.map((d) => (
                              <option key={d} value={d}>{d || "\u2014"}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.weekNumber || ""}
                            onChange={(e) => setEditData({ ...editData, weekNumber: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {WEEKS.map((w) => (
                              <option key={w} value={w}>{w || "\u2014"}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
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
                            Save
                          </button>
                          <button onClick={() => { setEditing(null); setEditData({}); }} className="text-gray-400 hover:text-gray-600 font-medium">
                            Cancel
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-gray-600">{ch?.name || store.channelId}</td>
                        <td className="px-3 py-2 text-gray-500">{store.province || "\u2014"}</td>
                        <td className="px-3 py-2 text-gray-500">{store.region || "\u2014"}</td>
                        <td
                          className={`px-3 py-2 font-mono ${coords.ok ? "text-gray-500" : "text-amber-700 font-semibold"}`}
                          title={coords.ok ? "" : coords.problem}
                        >
                          {store.gpsLat?.trim() || "\u2014"}
                          {!coords.ok && <span className="ml-1" aria-label="coordinate problem">\u26a0</span>}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono ${coords.ok ? "text-gray-500" : "text-amber-700 font-semibold"}`}
                          title={coords.ok ? "" : coords.problem}
                        >
                          {store.gpsLng?.trim() || "\u2014"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {rep?.name || store.repCode}
                          {rep && (
                            <span className="text-gray-400">
                              {" "}({getVisitRoleName(rep.visitRoleId, visitRoles)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{fmt(store.monthlySales)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-blue-50 text-blue-700 font-medium">
                            {rankings.overallRank.get(store.id)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-green-50 text-green-700 font-medium">
                            {rankings.repRank.get(store.id)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-purple-50 text-purple-700 font-medium">
                            {rankings.channelRank.get(store.id)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{getFrequencyLabel(store.frequency)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{store.duration}m</td>
                        <td className="px-3 py-2 text-gray-500">{store.dayOfWeek || "\u2014"}</td>
                        <td className="px-3 py-2 text-gray-500">{store.weekNumber || "\u2014"}</td>
                        <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
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
                          <button onClick={() => startEdit(store)} className="text-iram-green hover:text-red-800 font-medium">
                            Edit
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
