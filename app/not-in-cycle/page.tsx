"use client";

/**
 * Every store the call cycle misses, as a working list.
 *
 * Ported from Clippa (13e9652, 9e9ed39, 16b5576, a075285), without the sales
 * value and rank columns: iRam carries no sales data, so the list is ordered by
 * what can be acted on instead of by what a store is worth.
 *
 * The default view is deliberately the actionable one: OPEN stores only, so the
 * page opens on the shops somebody can do something about rather than on closed
 * ones. The filter says so, and switching it is one click.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";
import { TeamFilter } from "@/components/TeamFilter";
import { CoordinateEntry } from "@/components/CoordinateEntry";
import { EMPTY_SELECTION, filterRepsByTeam, type TeamSelection } from "@/lib/teamFilter";
import {
  filterNotInCycle,
  findNotInCycle,
  reasonCountsFor,
  isCorrectlyOut,
  REASONS,
  type NotInCycleReason,
  type StatusFilter,
} from "@/lib/notInCycle";
import { isClosed, closedReasonLabel } from "@/lib/closedStores";
import { parseLatLng } from "@/lib/latlng";
import { isTeamRole } from "@/lib/roles";
import {
  getVisitRoleName,
  type CallCycleType,
  type Channel,
  type Rep,
  type RoutePlanDocument,
  type Store,
  type StoreOverride,
  type Team,
  type VisitRole,
} from "@/lib/types";

const SELECT =
  "border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green";

export default function NotInCyclePage() {
  const { session, can } = useSession();
  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  // A Team Admin is scoped exactly like a team manager (lib/roles.ts). Testing
  // the one spelling let a Team Admin see every team's stores.
  const isTeamManager = isTeamRole(session?.role);
  const canFixGps = can("manage_stores");

  const [stores, setStores] = useState<Store[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [overrides, setOverrides] = useState<StoreOverride[]>([]);
  const [visitRoles, setVisitRoles] = useState<VisitRole[]>([]);
  const [cycleTypes, setCycleTypes] = useState<CallCycleType[]>([]);
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [teamSel, setTeamSel] = useState<TeamSelection>(EMPTY_SELECTION);
  const [repCode, setRepCode] = useState("");
  const [channelId, setChannelId] = useState("");
  const [reason, setReason] = useState<NotInCycleReason | "">("");
  // Open by default. A list that opens on closed shops buries the ones
  // somebody can act on, and "not in a cycle" is a to-do list, not an archive.
  const [status, setStatus] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");

  // Coordinates being typed, and the ones already written.
  const [edits, setEdits] = useState<Record<string, { lat: string; lng: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState("");
  // Synchronous twin of `saving`, so two clicks inside one render cannot both start.
  const savingRef = useRef(false);

  // ?rep=CODE lands on one rep's list. Read once from the URL rather than via
  // useSearchParams, which would force a Suspense boundary on the whole page.
  useEffect(() => {
    try {
      const rep = new URLSearchParams(window.location.search).get("rep");
      if (rep) setRepCode(rep);
    } catch {
      // No URL to read (prerender); the unfiltered list is fine.
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/routes").then((r) => r.json()).catch(() => null),
      fetch("/api/store-overrides").then((r) => r.json()).catch(() => ({ overrides: [] })),
      fetch("/api/visit-roles").then((r) => r.json()).catch(() => []),
      fetch("/api/call-cycle-types").then((r) => r.json()).catch(() => []),
    ]).then(([st, rp, tm, ch, rt, ov, vr, ct]) => {
      setStores(Array.isArray(st) ? st : []);
      setReps(Array.isArray(rp) ? rp : []);
      setTeams(Array.isArray(tm) ? tm : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null);
      setOverrides(Array.isArray(ov?.overrides) ? ov.overrides : Array.isArray(ov) ? ov : []);
      setVisitRoles(Array.isArray(vr) ? vr : []);
      setCycleTypes(Array.isArray(ct) ? ct : []);
      setLoading(false);
    });
  }, []);

  /**
   * Write one store's coordinate.
   *
   * The row is NOT removed afterwards. The store stays outside the cycle until
   * routes are regenerated, and quietly dropping it from the list would claim a
   * fix that has not happened yet. It says "saved, regenerate" instead.
   */
  const saveGps = async (storeId: string, lat: number, lng: number) => {
    // One save at a time: the server rewrites the whole store list on each,
    // so two in flight could each write back a list without the other's pin.
    if (savingRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // The VALIDATED numbers, not the box text: "- 26.1" passes the check once
    // cleaned, but saved raw it parses to NaN everywhere else.
    const gpsLat = String(lat);
    const gpsLng = String(lng);
    savingRef.current = true;
    setSaving(storeId);
    setSaveError("");
    try {
      const res = await fetch("/api/stores", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: storeId, gpsLat, gpsLng }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || `Could not save the coordinates (HTTP ${res.status}).`);
        return;
      }
      setSaved((p) => new Set(p).add(storeId));
      setStores((prev) => prev.map((s) => (s.id === storeId ? { ...s, gpsLat, gpsLng } : s)));
    } catch {
      setSaveError("Could not save the coordinates: the server could not be reached.");
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  // Role scoping first, always. The filters narrow what this user may see; they
  // never reach past it.
  const roleScopedReps = useMemo(() => {
    if (isTeamManager && session?.teamId) return reps.filter((r) => r.teamId === session.teamId);
    return reps;
  }, [reps, isTeamManager, session?.teamId]);

  const repsInTeam = useMemo(
    () => filterRepsByTeam(teams, teamSel, roleScopedReps),
    [teams, teamSel, roleScopedReps]
  );

  /**
   * Each rep's stores that DO have a coordinate, so the pin picker opens on
   * their patch rather than on the middle of the country, with the rest of the
   * round drawn around the pin as a sanity check.
   */
  const placedByRep = useMemo(() => {
    const out = new Map<string, { lat: number; lng: number; name: string }[]>();
    for (const s of stores) {
      const fix = parseLatLng(s.gpsLat, s.gpsLng);
      if (!fix) continue;
      const entry = { lat: fix.lat, lng: fix.lng, name: s.name };
      const list = out.get(s.repCode);
      if (list) list.push(entry);
      else out.set(s.repCode, [entry]);
    }
    return out;
  }, [stores]);

  const repByCode = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const strategy = useMemo(
    () => cycleTypes.find((t) => t.id === routes?.callCycleTypeId)?.strategy ?? null,
    [cycleTypes, routes]
  );

  const result = useMemo(
    () =>
      findNotInCycle({
        stores,
        channels,
        overrides,
        routes,
        reps,
        visitRoles,
        strategy,
        // Deliberately NOT narrowed by the rep filter: see filterNotInCycle.
        visibleRepCodes: isTeamManager ? new Set(roleScopedReps.map((r) => r.code)) : undefined,
      }),
    [stores, channels, overrides, routes, reps, visitRoles, strategy, isTeamManager, roleScopedReps]
  );

  const rows = useMemo(
    () =>
      filterNotInCycle(result, reps, { repCode, teams, teamSel, channelId, status, reason, search }).map(
        ({ store, reason: why }) => {
          const rep = repByCode.get(store.repCode);
          const team = rep?.teamId ? teamById.get(rep.teamId) : undefined;
          return {
            store,
            why,
            repName: rep?.name || store.repCode || "",
            repRole: rep ? getVisitRoleName(rep.visitRoleId, visitRoles) : "",
            teamName: team ? team.name || "Unnamed team" : "No team",
            leaderName: team?.managerName || "",
            channelName: channelById.get(store.channelId)?.name || store.channelId,
            closed: isClosed(store),
          };
        }
      ),
    [result, reps, repCode, teams, teamSel, channelId, status, reason, search, repByCode, teamById, channelById, visitRoles]
  );

  // The Reason dropdown counts what each choice would show under the other filters.
  const reasonCounts = useMemo(
    () => reasonCountsFor(result, reps, { repCode, teams, teamSel, channelId, status, search }),
    [result, reps, repCode, teams, teamSel, channelId, status, search]
  );

  const sort = useTableSort("why", "asc");
  const sorted = useSortedRows(
    rows,
    {
      name: (r) => r.store.name,
      placeId: (r) => r.store.placeId,
      rep: (r) => r.repName,
      team: (r) => r.teamName,
      channel: (r) => r.channelName,
      province: (r) => r.store.province || null,
      status: (r) => (r.closed ? "Closed" : "Open"),
      // By what can be acted on first. Ties keep findNotInCycle's name order,
      // because Array.prototype.sort is stable.
      why: (r) => REASONS[r.why].rank,
    },
    sort
  );

  /** The list on screen, as a workbook someone can work through in Perigee. */
  const exportList = async () => {
    setExporting(true);
    try {
      const { utils, write } = await import("xlsx");
      const header = [
        "PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "GPS LATITUDE", "GPS LONGITUDE",
        "REP CODE", "REP NAME", "TEAM", "STATUS", "WHY NOT IN A CYCLE", "WHAT TO DO", "WHERE TO FIX IT",
      ];
      const data: (string | number)[][] = [header];
      for (const r of sorted) {
        data.push([
          r.store.placeId || "", r.store.name || "", r.channelName || "", r.store.province || "",
          r.store.gpsLat || "", r.store.gpsLng || "", r.store.repCode || "", r.repName, r.teamName,
          r.closed ? "Closed" : "Active", REASONS[r.why].label, REASONS[r.why].action ?? "Nothing: correctly out of the cycle",
          REASONS[r.why].fixIn,
        ]);
      }
      const ws = utils.aoa_to_sheet(data);
      ws["!cols"] = [14, 34, 20, 16, 13, 13, 12, 24, 20, 9, 34, 50, 70].map((wch) => ({ wch }));
      ws["!autofilter"] = { ref: utils.encode_range({ s: { c: 0, r: 0 }, e: { c: header.length - 1, r: data.length - 1 } }) };

      const notes: (string | number)[][] = [
        ["Stores not in a call cycle"],
        ["Generated", new Date().toLocaleString("en-ZA")],
        ["Routes generated", routes?.generatedAt ? new Date(routes.generatedAt).toLocaleString("en-ZA") : "No routes generated yet"],
        ["Rows in this file", sorted.length],
        ["Not in a cycle (before filters)", result.missing.length],
        ["Stores visited by the sales cycle", result.scheduled],
        [],
        ["Reading it"],
        ["", "A store is in the cycle when its sales rep's route visits it at least once in the four weeks. QC and Training visits do not count."],
        ["", "Store details (name, channel, coordinates, rep allocation) come from Perigee through Store Upload, and each upload copies Perigee's values over this app's. A fix made only in this app is undone by the next upload unless Perigee is corrected too."],
        ["", "Closed, and In a channel nobody calls on, are correctly out of the cycle. Nothing needs fixing for those rows."],
        ["", "A saved fix shows up after routes are regenerated on the Routes page."],
      ];
      const notesWs = utils.aoa_to_sheet(notes);
      notesWs["!cols"] = [{ wch: 30 }, { wch: 120 }];

      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Not in a cycle");
      utils.book_append_sheet(wb, notesWs, "Notes");
      const buf = write(wb, { type: "array", bookType: "xlsx" });
      const url = URL.createObjectURL(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Not_In_A_Cycle_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
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
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stores not in a cycle</h1>
          <p className="text-sm text-gray-500">
            {routes ? (
              <>
                {result.scheduled.toLocaleString("en-ZA")} of {result.totalStores.toLocaleString("en-ZA")} stores
                are visited by a sales rep at least once in the four weeks.{" "}
                <span className="font-semibold text-amber-700">{result.missing.length.toLocaleString("en-ZA")}</span>{" "}
                are not, and each says why.
                {result.notPlottable > 0 && (
                  <span className="text-gray-400">
                    {" "}{result.notPlottable.toLocaleString("en-ZA")} have no usable coordinates, so no map can show them.
                  </span>
                )}
              </>
            ) : (
              "No routes have been generated yet, so no store is in a cycle."
            )}
          </p>
        </div>
        {can("export_data") && (
          <button
            onClick={exportList}
            disabled={exporting || sorted.length === 0}
            className="flex-shrink-0 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Download the rows on screen, with what to fix and where (Perigee or this app)"
          >
            {exporting ? "Building..." : `Export this list (${sorted.length.toLocaleString("en-ZA")})`}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {isAdmin && <TeamFilter teams={teams} value={teamSel} onChange={setTeamSel} reps={roleScopedReps} />}

        <select value={repCode} onChange={(e) => setRepCode(e.target.value)} className={SELECT} aria-label="Rep">
          <option value="">All reps</option>
          {repsInTeam.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name} ({r.code})
            </option>
          ))}
          {/* A rep picked from a link who is outside the team filter stays
              selectable, or the select would show the first option while the
              list is still narrowed to them. */}
          {repCode && !repsInTeam.some((r) => r.code === repCode) && (
            <option value={repCode}>{repByCode.get(repCode)?.name || repCode} ({repCode})</option>
          )}
        </select>

        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={SELECT} aria-label="Channel">
          <option value="">All channels</option>
          {/* Deduplicated by id: two channels sharing an id would filter
              identically and React refuses the duplicate key. */}
          {[...new Map(channels.map((c) => [c.id, c])).values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={SELECT} aria-label="Status">
          <option value="open">Open only</option>
          <option value="closed">Closed only</option>
          <option value="all">Open and closed</option>
        </select>

        <select value={reason} onChange={(e) => setReason(e.target.value as NotInCycleReason | "")} className={SELECT} aria-label="Reason">
          <option value="">Any reason</option>
          {(Object.keys(REASONS) as NotInCycleReason[])
            .sort((a, b) => REASONS[a].rank - REASONS[b].rank)
            .map((r) => (
              <option key={r} value={r}>
                {REASONS[r].label} ({reasonCounts[r]})
              </option>
            ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, Place ID or rep code..."
          className={`${SELECT} w-64`}
        />

        <span className="text-sm text-gray-500 ml-auto">
          {sorted.length.toLocaleString("en-ZA")} of {result.missing.length.toLocaleString("en-ZA")} not in a cycle
        </span>
      </div>

      {saveError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>
      )}

      {/* Grid */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="max-h-[calc(100vh-15rem)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 [&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:bg-gray-50 [&>tr>th]:z-10 [&>tr>th]:shadow-[inset_0_-1px_0_#e5e7eb]">
              <tr>
                <SortableTh sortId="name" sort={sort} className="px-4 py-3">Store</SortableTh>
                <SortableTh sortId="rep" sort={sort} className="px-4 py-3">Rep</SortableTh>
                <SortableTh sortId="team" sort={sort} className="px-4 py-3">Team</SortableTh>
                <SortableTh sortId="channel" sort={sort} className="px-4 py-3">Channel</SortableTh>
                <SortableTh sortId="province" sort={sort} className="px-4 py-3">Province</SortableTh>
                <SortableTh sortId="status" sort={sort} className="px-4 py-3">Status</SortableTh>
                <SortableTh sortId="why" sort={sort} className="px-4 py-3">Why not in a cycle</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((r) => (
                <tr key={r.store.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{r.store.name}</div>
                    <div className="text-xs text-gray-400 font-mono">{r.store.placeId}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {r.repName || <span className="text-gray-300">None</span>}
                    {r.store.repCode && (
                      <div className="text-xs text-gray-400 font-mono">
                        {r.store.repCode}
                        {r.repRole && <span className="font-sans"> · {r.repRole}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {r.teamName}
                    {r.leaderName && <div className="text-xs text-gray-400">{r.leaderName}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{r.channelName}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.store.province || <span className="text-gray-300">None</span>}</td>
                  <td className="px-4 py-2.5">
                    <span
                      title={closedReasonLabel(r.store) ?? undefined}
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        r.closed ? "bg-gray-100 text-gray-500" : "bg-green-50 text-green-700"
                      }`}
                    >
                      {r.closed ? "Closed" : "Open"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: REASONS[r.why].colour }} />
                      <div>
                        <div className={isCorrectlyOut(r.why) ? "text-gray-500" : "text-gray-800"}>{REASONS[r.why].label}</div>
                        {/* Fixable HERE. A coordinate is the one reason on this
                            list somebody can clear in ten seconds, and sending
                            them to another page to do it is how stores stay
                            unrouted. */}
                        {/* The Saved note is keyed on the save, not the reason:
                            a saved pin changes the store's reason straight
                            away, and the note must not vanish with it. */}
                        {saved.has(r.store.id) ? (
                          <div className="text-xs text-green-700">
                            GPS saved. Regenerate routes to bring it into the cycle, and correct it in Perigee too.
                          </div>
                        ) : r.why === "bad_gps" && canFixGps ? (
                          <div className="mt-1">
                            <CoordinateEntry
                              lat={edits[r.store.id]?.lat ?? ""}
                              lng={edits[r.store.id]?.lng ?? ""}
                              onChange={(lat, lng) => setEdits((p) => ({ ...p, [r.store.id]: { lat, lng } }))}
                              onSave={(lat, lng) => saveGps(r.store.id, lat, lng)}
                              saving={saving === r.store.id}
                              // Every row waits while any row is saving.
                              locked={saving !== null}
                              storeName={r.store.name}
                              nearby={placedByRep.get(r.store.repCode) ?? []}
                            />
                          </div>
                        ) : (
                          REASONS[r.why].action && <div className="text-xs text-gray-400">{REASONS[r.why].action}</div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    {result.missing.length === 0
                      ? "Every store that can be visited is in the cycle."
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
