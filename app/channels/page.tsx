"use client";

import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import {
  Channel,
  VisitRole,
  ChannelRoleDefault,
  FREQUENCY_OPTIONS,
  FrequencyType,
  getFrequencyLabel,
  DEFAULT_VISIT_ROLES,
} from "@/lib/types";
import { resolveRoleDefault, roleCallsOnChannel, withRoleEnabled } from "@/lib/repStores";

/**
 * Column widths are user-draggable, so they cannot live in Tailwind classes:
 * the frozen columns' left offsets are derived from them at render time, and a
 * hardcoded left-14/left-28 would tear away from the header the moment anything
 * was resized.
 */
const COL_MIN = 60;
const COL_DEFAULTS: Record<string, number> = {
  select: 56,
  num: 56,
  name: 240,
  actions: 150,
};
const ROLE_FREQ_DEFAULT = 190;
const ROLE_DUR_DEFAULT = 140;
const ROLE_CALLS_DEFAULT = 84;
const WIDTH_STORAGE_KEY = "channels.columnWidths.v1";

const freqKey = (roleId: string) => `${roleId}:freq`;
const durKey = (roleId: string) => `${roleId}:dur`;
const callsKey = (roleId: string) => `${roleId}:calls`;

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [visitRoles, setVisitRoles] = useState<VisitRole[]>(DEFAULT_VISIT_ROLES);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Channel>>({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFreq, setNewFreq] = useState<FrequencyType>("monthly");
  const [newDuration, setNewDuration] = useState(30);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyPreview, setApplyPreview] = useState<{
    totalStores: number;
    wouldChange: number;
    keptOverridden: number;
    manualEditsProtected: number;
    byChannel: { name: string; count: number; to: string }[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  // "<channelId>:<roleId>" of a switch mid-save, so only that one greys out.
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // Restore saved widths once on mount. Kept in localStorage rather than on the
  // channel record because this is a per-person view preference, not data.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
      if (raw) setColWidths(JSON.parse(raw));
    } catch {
      // A corrupt entry just means default widths; never worth failing the page.
    }
  }, []);

  const persistWidths = (next: Record<string, number>) => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode / quota — the resize still works for this session.
    }
  };

  /** Every leaf column, left to right, with its current width. */
  const columns = useMemo(() => {
    const cols: { key: string; width: number }[] = [
      { key: "select", width: colWidths.select ?? COL_DEFAULTS.select },
      { key: "num", width: colWidths.num ?? COL_DEFAULTS.num },
      { key: "name", width: colWidths.name ?? COL_DEFAULTS.name },
    ];
    for (const role of visitRoles) {
      // The primary role gets no switch — see roleCallsOnChannel — so it gets
      // no column either rather than a permanently-on control taking up width.
      if (!role.isPrimary) {
        cols.push({ key: callsKey(role.id), width: colWidths[callsKey(role.id)] ?? ROLE_CALLS_DEFAULT });
      }
      cols.push({ key: freqKey(role.id), width: colWidths[freqKey(role.id)] ?? ROLE_FREQ_DEFAULT });
      cols.push({ key: durKey(role.id), width: colWidths[durKey(role.id)] ?? ROLE_DUR_DEFAULT });
    }
    cols.push({ key: "actions", width: colWidths.actions ?? COL_DEFAULTS.actions });
    return cols;
  }, [visitRoles, colWidths]);

  const widthOf = (key: string) => columns.find((c) => c.key === key)?.width ?? COL_MIN;

  // Left offsets for the three frozen columns, derived from live widths.
  const leftSelect = 0;
  const leftNum = widthOf("select");
  const leftName = widthOf("select") + widthOf("num");

  /** Drag a column edge. */
  const startResize = (key: string, e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthOf(key);
    let latest = startWidth;

    // The listeners go on WINDOW, not on the grip.
    //
    // Every pointermove re-renders this table, and re-rendering replaces the
    // grip's DOM node. Anything bound to that node — listeners, pointer
    // capture — dies with it on the very first move, and the drag with it.
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(COL_MIN, Math.round(startWidth + (ev.clientX - startX)));
      setColWidths((prev) => ({ ...prev, [key]: latest }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      setColWidths((prev) => {
        const next = { ...prev, [key]: latest };
        persistWidths(next);
        return next;
      });
    };
    // Dragging across a table otherwise selects every cell it crosses.
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /** Double-click a grip to put that column back to its default. */
  const resetColumn = (key: string) => {
    setColWidths((prev) => {
      const next = { ...prev };
      delete next[key];
      persistWidths(next);
      return next;
    });
  };

  const resetAllColumns = () => {
    setColWidths({});
    persistWidths({});
  };

  /**
   * The drag grip. Sits on the row-2 header cell but spans both header rows so
   * the target is the full header height, not the 20px sub-row.
   *
   * Deliberately a plain function returning a <span>, NOT a nested component.
   * A component declared inside this one gets a fresh identity on every render,
   * so React tears down and rebuilds its DOM node each time the width changes —
   * which is mid-drag, every frame.
   *
   * The hairline is always visible: a 6px invisible hit area is impossible to
   * find if nothing marks where the edges are.
   */
  const renderGrip = (colKey: string) => (
    <span
      onPointerDown={(e) => startResize(colKey, e)}
      onDoubleClick={() => resetColumn(colKey)}
      title="Drag to resize — double-click to reset"
      className="absolute -top-11 bottom-0 right-0 w-2 cursor-col-resize z-50 hover:bg-iram-green/30"
    >
      <span className="absolute right-0 top-0 bottom-0 w-px bg-gray-300" />
    </span>
  );

  /**
   * The on/off switch for one role on one channel.
   *
   * Deliberately a plain function returning markup, not a nested component —
   * a component declared in here gets a fresh identity every render and React
   * rebuilds its DOM node each time, which is what killed the resize grips.
   */
  const renderToggle = (
    on: boolean,
    onChange: (next: boolean) => void,
    label: string,
    busy: boolean
  ) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-iram-green focus:ring-offset-1 disabled:opacity-40 ${
        on ? "bg-iram-green" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );

  /**
   * Turn a role's calls on this channel on or off.
   *
   * While a row is open for editing, this writes to the edit buffer instead of
   * the server: Save sends its own copy of roleDefaults, so a straight-to-server
   * write here would be silently undone a moment later.
   *
   * Outside editing it saves immediately and optimistically. There are 71
   * channels and a switch per role, and waiting on a round trip for each one
   * makes that job unbearable; a failure puts the switch back and says so.
   */
  const setRoleEnabled = async (ch: Channel, role: VisitRole, next: boolean) => {
    if (editing === ch.id) {
      setEditData((prev) => ({
        ...prev,
        roleDefaults: withRoleEnabled(prev.roleDefaults, role, next),
      }));
      return;
    }

    const key = `${ch.id}:${role.id}`;
    const before = ch.roleDefaults;
    const roleDefaults = withRoleEnabled(before, role, next);

    setTogglingKey(key);
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, roleDefaults } : c)));
    try {
      const res = await fetch("/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ch.id, roleDefaults }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setChannels((prev) =>
        prev.map((c) => (c.id === ch.id ? { ...c, roleDefaults: before } : c))
      );
      setImportMsg({
        type: "error",
        text: `Could not save ${role.name} on ${ch.name} — the switch has been put back.`,
      });
    } finally {
      setTogglingKey(null);
    }
  };

  const load = () => {
    Promise.all([
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/visit-roles").then((r) => r.json()).catch(() => []),
    ]).then(([chs, roles]) => {
      setChannels(Array.isArray(chs) ? chs : []);
      // The primary role has to come first — it is the column that maps to the
      // channel's own frequency/duration, and the one everything else defers to.
      const list: VisitRole[] = Array.isArray(roles) && roles.length ? roles : DEFAULT_VISIT_ROLES;
      setVisitRoles([...list].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)));
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  /**
   * What a role actually calls at on this channel — the value the route engine
   * will use, whether it was set here or inherited from the role.
   */
  const effectiveFor = (ch: Channel, role: VisitRole): ChannelRoleDefault =>
    resolveRoleDefault(ch, role);

  /**
   * Edit one cell. The primary role writes to the channel's own
   * frequency/duration (there is deliberately no second copy of those); every
   * other role writes into roleDefaults under its own id.
   */
  const setRoleField = (
    role: VisitRole,
    field: "frequency" | "duration",
    value: FrequencyType | number
  ) => {
    if (role.isPrimary) {
      setEditData((prev) => ({ ...prev, [field]: value }));
      return;
    }
    setEditData((prev) => {
      const current =
        prev.roleDefaults?.[role.id] ??
        // First edit of an unset role starts from what it inherits, so changing
        // only the duration cannot silently reset the frequency to something else.
        { frequency: role.frequency, duration: role.duration };
      return {
        ...prev,
        roleDefaults: {
          ...(prev.roleDefaults ?? {}),
          [role.id]: { ...current, [field]: value },
        },
      };
    });
  };

  /** Drop a role's override so it goes back to inheriting. */
  const clearRole = (role: VisitRole) => {
    setEditData((prev) => {
      const next = { ...(prev.roleDefaults ?? {}) };
      delete next[role.id];
      return { ...prev, roleDefaults: next };
    });
  };

  const startEdit = (ch: Channel) => {
    setEditing(ch.id);
    // Clone roleDefaults — editing must not mutate the loaded channel in place,
    // or cancelling an edit would silently keep the change.
    setEditData({
      name: ch.name,
      frequency: ch.frequency,
      duration: ch.duration,
      roleDefaults: JSON.parse(JSON.stringify(ch.roleDefaults ?? {})),
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditData({});
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    const res = await fetch("/api/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    const data = await res.json().catch(() => ({}));
    setEditing(null);
    setEditData({});
    setSaving(false);
    // Say what happened to the STORES. A channel edit that reports nothing is
    // how "BUCO is set to 120 minutes but every store still says 30" went
    // unnoticed for so long.
    if (res.ok && typeof data.storesUpdated === "number") {
      setImportMsg(
        data.storesUpdated > 0
          ? {
              type: "success",
              text: `Updated ${data.storesUpdated} store${data.storesUpdated === 1 ? "" : "s"} in this channel${data.storesPinned ? `; ${data.storesPinned} kept their own override` : ""}.`,
            }
          : { type: "success", text: "Channel saved. No stores needed changing." }
      );
    }
    load();
  };

  const previewDefaults = async () => {
    setApplyBusy(true);
    setApplyPreview(null);
    try {
      const res = await fetch("/api/channels/apply-defaults", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ type: "error", text: data.error || "Could not read defaults" });
        return;
      }
      setApplyPreview(data);
    } finally {
      setApplyBusy(false);
    }
  };

  const applyDefaults = async () => {
    setApplyBusy(true);
    try {
      const res = await fetch("/api/channels/apply-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectManualEdits: true }),
      });
      const data = await res.json();
      setImportMsg(
        res.ok
          ? {
              type: "success",
              text: `Applied channel defaults to ${data.storesUpdated} store(s). ${data.keptOverridden} kept an existing override; ${data.overridesCreated} manual edit(s) preserved.`,
            }
          : { type: "error", text: data.error || "Failed to apply defaults" }
      );
      setApplyPreview(null);
    } finally {
      setApplyBusy(false);
    }
  };

  const addChannel = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), frequency: newFreq, duration: newDuration }),
    });
    setNewName("");
    setNewFreq("monthly");
    setNewDuration(30);
    setShowAdd(false);
    setAdding(false);
    load();
  };

  const deleteChannel = async (id: string, name: string) => {
    if (!confirm(`Delete channel "${name}"? This cannot be undone.`)) return;
    await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    load();
  };

  const filtered = channels.filter((ch) =>
    ch.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((ch) => selected.has(ch.id));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((ch) => next.delete(ch.id));
      } else {
        filtered.forEach((ch) => next.add(ch.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} channel${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelected(new Set());
    setBulkDeleting(false);
    load();
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/channels/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ text: data.error || "Import failed", type: "error" });
        return;
      }
      const parts: string[] = [];
      if (data.updated) parts.push(`${data.updated} updated`);
      if (data.created) parts.push(`${data.created} created`);
      if (data.errors?.length) parts.push(`${data.errors.length} error${data.errors.length > 1 ? "s" : ""}`);
      if (!data.updated && !data.created && !data.errors?.length) parts.push("No changes");
      setImportMsg({
        text: parts.join(", ") + (data.errors?.length ? ": " + data.errors.join("; ") : ""),
        type: data.errors?.length && !data.updated && !data.created ? "error" : "success",
      });
      load();
    } catch {
      setImportMsg({ text: "Import failed", type: "error" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Channels</h1>
          <p className="text-sm text-gray-500">
            {channels.length} channels configured
            {search.trim() && ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/channels/export"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export Excel
          </a>
          <label
            className={`px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 cursor-pointer transition-colors ${importing ? "opacity-50 pointer-events-none" : ""}`}
          >
            {importing ? "Importing..." : "Import Excel"}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
              }}
            />
          </label>
          <button
            onClick={previewDefaults}
            disabled={applyBusy}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Push every channel's frequency and duration onto its stores"
          >
            {applyBusy ? "Checking..." : "Apply defaults to stores"}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2 bg-iram-green text-white text-sm font-medium rounded-lg hover:bg-iram-green-dark transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Channel
          </button>
        </div>
      </div>

      {/* Import message */}
      {importMsg && (
        <div
          className={`p-3 rounded-lg text-sm mb-6 flex items-center justify-between ${
            importMsg.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          <span>{importMsg.text}</span>
          <button onClick={() => setImportMsg(null)} className="text-xs opacity-60 hover:opacity-100 ml-4">dismiss</button>
        </div>
      )}

      {/* Apply-defaults preview — always shown before anything is written */}
      {applyPreview && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">
            Apply channel defaults to stores
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            A channel&apos;s frequency and duration are defaults that live on each store. Stores
            that drifted from their channel are listed below.
          </p>

          {applyPreview.wouldChange === 0 ? (
            <p className="text-sm text-gray-600">
              Every store already matches its channel. Nothing to do.
            </p>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto border border-gray-100 rounded-lg mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Channel</th>
                      <th className="px-3 py-2 text-right">Stores</th>
                      <th className="px-3 py-2 text-left">Will be set to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applyPreview.byChannel.map((c) => (
                      <tr key={c.name}>
                        <td className="px-3 py-1.5 text-gray-700">{c.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{c.count}</td>
                        <td className="px-3 py-1.5 text-gray-600">{c.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                <span className="font-medium text-gray-700">{applyPreview.wouldChange}</span> of{" "}
                {applyPreview.totalStores} stores will change.{" "}
                {applyPreview.keptOverridden} store(s) have a call override and are left alone.{" "}
                {applyPreview.manualEditsProtected > 0 && (
                  <>
                    {applyPreview.manualEditsProtected} store(s) look hand-edited and will be kept
                    as-is — an override record is created for each so they stay protected.
                  </>
                )}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={applyDefaults}
                  disabled={applyBusy}
                  className="px-4 py-2 bg-iram-green text-white text-sm font-medium rounded-lg hover:bg-iram-green-dark disabled:opacity-50"
                >
                  {applyBusy ? "Applying..." : `Apply to ${applyPreview.wouldChange} store(s)`}
                </button>
                <button
                  onClick={() => setApplyPreview(null)}
                  className="px-4 py-2 text-gray-500 text-sm font-medium hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Add Channel Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">New Channel</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Channel Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Pick n Pay"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default Frequency</label>
              <select
                value={newFreq}
                onChange={(e) => setNewFreq(e.target.value as FrequencyType)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              >
                {FREQUENCY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
              <input
                type="number"
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                min={5}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={addChannel}
              disabled={adding || !newName.trim()}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {adding ? "Saving..." : "Save Channel"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-gray-500 text-sm font-medium hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search + bulk actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {Object.keys(colWidths).length > 0 && (
          <button
            onClick={resetAllColumns}
            title="Put every column back to its default width"
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 whitespace-nowrap"
          >
            Reset column widths
          </button>
        )}

        {selected.size > 0 && (
          <div className="flex items-center gap-3 sm:ml-auto bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-600">{selected.size} selected</span>
            <button
              onClick={deleteSelected}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-iram-green text-white text-xs font-medium rounded-lg hover:bg-iram-green-dark disabled:opacity-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {bulkDeleting ? "Deleting..." : `Delete selected`}
            </button>
            <button
              onClick={clearSelection}
              className="text-gray-400 hover:text-gray-600 text-xs font-medium"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {/* 20rem of reserved space was roughly double what the page header and
            toolbar actually occupy (~11rem), so a third of the screen went
            unused. 12rem leaves them room and gives the rest to rows. The
            viewport is the hard ceiling here — the header can only stay frozen
            while THIS container is the thing that scrolls. */}
        <div className="overflow-auto max-h-[calc(100vh-12rem)]">
          <table className="text-sm border-separate border-spacing-0 table-fixed">
            <colgroup>
              {columns.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th
                  style={{ left: leftSelect }}
                  className="sticky top-0 z-40 h-11 bg-gray-50 px-3 py-3 border-b border-gray-200"
                >
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="w-4 h-4 rounded border-gray-300 text-iram-green focus:ring-iram-green cursor-pointer align-middle"
                    aria-label="Select all"
                  />
                </th>
                <th
                  style={{ left: leftNum }}
                  className="sticky top-0 z-40 h-11 bg-gray-50 px-3 py-3 border-b border-gray-200"
                >
                  #
                </th>
                <th
                  style={{ left: leftName }}
                  className="sticky top-0 z-40 h-11 bg-gray-50 px-6 py-3 border-b border-r border-gray-200 truncate"
                >
                  Channel Name
                </th>
                {visitRoles.map((role) => (
                  <th
                    key={role.id}
                    colSpan={role.isPrimary ? 2 : 3}
                    className="sticky top-0 z-30 h-11 bg-gray-50 px-6 py-3 text-center border-l border-b border-gray-200"
                    title={
                      role.isPrimary
                        ? "The sales rep's call cycle. These values are copied onto every store in the channel. It has no switch — a sales rep is allocated store by store, not channel by channel."
                        : `How ${role.name} calls on this channel. Switch it off if ${role.name} never visits this channel. Blank values = this role's own default of ${getFrequencyLabel(role.frequency)} / ${role.duration} min.`
                    }
                  >
                    {role.name}
                    {role.isPrimary && <span className="ml-1 text-gray-400 normal-case">(primary)</span>}
                  </th>
                ))}
                <th className="sticky top-0 z-30 h-11 bg-gray-50 px-6 py-3 text-right border-b border-gray-200">Actions</th>
              </tr>
              <tr className="bg-gray-50 text-left text-[10px] text-gray-400 uppercase tracking-wider">
                <th
                  style={{ left: leftSelect }}
                  className="sticky top-11 z-40 bg-gray-50 px-3 pb-2 border-b border-gray-200 relative"
                >
                  {renderGrip("select")}
                </th>
                <th
                  style={{ left: leftNum }}
                  className="sticky top-11 z-40 bg-gray-50 px-3 pb-2 border-b border-gray-200 relative"
                >
                  {renderGrip("num")}
                </th>
                <th
                  style={{ left: leftName }}
                  className="sticky top-11 z-40 bg-gray-50 px-6 pb-2 border-b border-r border-gray-200 relative"
                >
                  {renderGrip("name")}
                </th>
                {visitRoles.map((role) => (
                  <Fragment key={role.id}>
                    {!role.isPrimary && (
                      <th className="sticky top-11 z-30 bg-gray-50 px-3 pb-2 text-center border-l border-b border-gray-200 relative">
                        Calls
                        {renderGrip(callsKey(role.id))}
                      </th>
                    )}
                    <th
                      className={`sticky top-11 z-30 bg-gray-50 px-6 pb-2 border-b border-gray-200 relative ${
                        role.isPrimary ? "border-l" : ""
                      }`}
                    >
                      Frequency
                      {renderGrip(freqKey(role.id))}
                    </th>
                    <th className="sticky top-11 z-30 bg-gray-50 px-6 pb-2 text-right border-b border-gray-200 relative">
                      Duration
                      {renderGrip(durKey(role.id))}
                    </th>
                  </Fragment>
                ))}
                <th className="sticky top-11 z-30 bg-gray-50 px-6 pb-2 border-b border-gray-200 relative">
                  {renderGrip("actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ch, i) => (
                <tr
                  key={ch.id}
                  className={`group hover:bg-gray-50 ${selected.has(ch.id) ? "bg-red-50/40" : ""}`}
                >
                  <td
                    style={{ left: leftSelect }}
                    className={`sticky z-10 px-3 py-3 border-b border-gray-100 ${
                      selected.has(ch.id) ? "bg-red-50" : "bg-white"
                    } group-hover:bg-gray-50`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(ch.id)}
                      onChange={() => toggleOne(ch.id)}
                      className="w-4 h-4 rounded border-gray-300 text-iram-green focus:ring-iram-green cursor-pointer align-middle"
                      aria-label={`Select ${ch.name}`}
                    />
                  </td>
                  <td
                    style={{ left: leftNum }}
                    className={`sticky z-10 px-3 py-3 text-gray-400 border-b border-gray-100 ${
                      selected.has(ch.id) ? "bg-red-50" : "bg-white"
                    } group-hover:bg-gray-50`}
                  >
                    {i + 1}
                  </td>

                  {editing === ch.id ? (
                    <>
                      <td
                        style={{ left: leftName }}
                        className={`sticky z-10 px-6 py-3 border-b border-r border-gray-200 ${
                          selected.has(ch.id) ? "bg-red-50" : "bg-white"
                        } group-hover:bg-gray-50`}
                      >
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      {visitRoles.map((role) => {
                        const eff = effectiveFor(editData as Channel, role);
                        const entry = editData.roleDefaults?.[role.id];
                        const calls = roleCallsOnChannel(editData as Channel, role);
                        // A switched-off entry exists only to hold the flag, so
                        // it must not read as a frequency someone chose.
                        const isSet = role.isPrimary || (!!entry && entry.enabled !== false);
                        return (
                          <Fragment key={role.id}>
                            {!role.isPrimary && (
                              <td className="px-3 py-3 text-center border-l border-b border-gray-200">
                                {renderToggle(
                                  calls,
                                  (next) => setRoleEnabled(ch, role, next),
                                  calls
                                    ? `${role.name} calls on ${ch.name} — switch off if they never visit this channel`
                                    : `${role.name} does not call on ${ch.name}`,
                                  false
                                )}
                              </td>
                            )}
                            <td className={`px-6 py-3 border-b border-gray-200 ${role.isPrimary ? "border-l" : ""}`}>
                              {calls ? (
                                <select
                                  value={eff.frequency}
                                  onChange={(e) => setRoleField(role, "frequency", e.target.value as FrequencyType)}
                                  className={`border rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green ${
                                    isSet ? "border-gray-200" : "border-gray-200 text-gray-400 italic"
                                  }`}
                                >
                                  {FREQUENCY_OPTIONS.map((f) => (
                                    <option key={f.value} value={f.value}>
                                      {f.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs text-gray-400 italic">Does not call</span>
                              )}
                            </td>
                            <td className="px-6 py-3 border-b border-gray-100">
                              {calls ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    value={eff.duration}
                                    onChange={(e) => setRoleField(role, "duration", Number(e.target.value))}
                                    className={`border rounded px-2 py-1 text-sm w-20 text-right focus:outline-none focus:ring-1 focus:ring-iram-green ${
                                      isSet ? "border-gray-200" : "border-gray-200 text-gray-400 italic"
                                    }`}
                                  />
                                  {!role.isPrimary && isSet && (
                                    <button
                                      onClick={() => clearRole(role)}
                                      title={`Clear — fall back to the ${role.name} role's own default`}
                                      className="text-gray-300 hover:text-red-500 text-xs px-1"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="text-right text-xs text-gray-300">—</div>
                              )}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="px-6 py-3 text-right space-x-2 border-b border-gray-100">
                        <button
                          onClick={() => saveEdit(ch.id)}
                          disabled={saving}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-gray-400 hover:text-gray-600 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td
                        style={{ left: leftName }}
                        className={`sticky z-10 px-6 py-3 font-medium text-gray-900 border-b border-r border-gray-200 ${
                          selected.has(ch.id) ? "bg-red-50" : "bg-white"
                        } group-hover:bg-gray-50`}
                        title={ch.name}
                      >
                        <span className="block truncate">{ch.name}</span>
                      </td>
                      {visitRoles.map((role) => {
                        const eff = effectiveFor(ch, role);
                        const entry = ch.roleDefaults?.[role.id];
                        const calls = roleCallsOnChannel(ch, role);
                        const isSet = role.isPrimary || (!!entry && entry.enabled !== false);
                        const why = isSet
                          ? ""
                          : `Not set for this channel — falls back to the ${role.name} role's own default`;
                        return (
                          <Fragment key={role.id}>
                            {!role.isPrimary && (
                              <td className="px-3 py-3 text-center border-l border-b border-gray-200">
                                {renderToggle(
                                  calls,
                                  (next) => setRoleEnabled(ch, role, next),
                                  calls
                                    ? `${role.name} calls on ${ch.name} — switch off if they never visit this channel`
                                    : `${role.name} does not call on ${ch.name}`,
                                  togglingKey === `${ch.id}:${role.id}`
                                )}
                              </td>
                            )}
                            <td
                              className={`px-6 py-3 border-b border-gray-200 ${role.isPrimary ? "border-l" : ""}`}
                              title={calls ? why : `${role.name} does not call on this channel — no visits are planned and no time is charged to their capacity`}
                            >
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  !calls
                                    ? "bg-gray-100 text-gray-400"
                                    : isSet
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-gray-50 text-gray-400 italic"
                                }`}
                              >
                                {calls ? getFrequencyLabel(eff.frequency) : "Does not call"}
                              </span>
                            </td>
                            <td
                              className={`px-6 py-3 text-right border-b border-gray-100 ${
                                !calls ? "text-gray-300" : isSet ? "text-gray-600" : "text-gray-400 italic"
                              }`}
                              title={calls ? why : ""}
                            >
                              {calls ? `${eff.duration} min` : "—"}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="px-6 py-3 text-right space-x-3 border-b border-gray-100">
                        <button
                          onClick={() => startEdit(ch)}
                          className="text-iram-green hover:text-red-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteChannel(ch.id, ch.name)}
                          className="text-gray-400 hover:text-red-600 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-8 text-center text-gray-400">
                    {channels.length === 0
                      ? 'No channels configured. Click "Add Channel" to create one.'
                      : `No channels match "${search}".`}
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
