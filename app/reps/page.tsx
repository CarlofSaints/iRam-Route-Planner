"use client";

import { useState, useEffect, useRef } from "react";
import { Rep, VisitRole, Team } from "@/lib/types";
import { useSession } from "@/components/SessionProvider";

/**
 * Opens whatever has been typed into a Home Address field in Google Maps, in a
 * new tab, so the person capturing it can see it resolves to a real place
 * before saving. Routes anchor on the rep's home, so a typo here quietly moves
 * someone's whole day.
 *
 * Declared at module level on purpose — a component defined inside RepsPage
 * would remount on every keystroke and steal focus from the address input.
 */
function CheckAddressOnGoogle({ address, compact = false }: { address?: string; compact?: boolean }) {
  const value = (address || "").trim();
  const open = () =>
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`,
      "_blank",
      "noopener,noreferrer"
    );

  return (
    <button
      type="button"
      onClick={open}
      disabled={!value}
      title={value ? "Open this address in Google Maps to confirm it" : "Enter an address first"}
      className={`mt-1 inline-flex items-center gap-1 rounded border border-gray-200 font-medium text-iram-green transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300 ${
        compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"
      }`}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" strokeLinejoin="round" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
      Check on Google
    </button>
  );
}

interface GeocodeOutcome {
  repId: string;
  code: string;
  name: string;
  address: string;
  status: "saved" | "review" | "failed" | "skipped";
  reason: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

interface GeocodeResponse {
  considered: number;
  saved: number;
  needsReview: number;
  failed: number;
  outcomes: GeocodeOutcome[];
}

interface CreateAccountOutcome {
  repId: string;
  code: string;
  name: string;
  email: string;
  status: "created" | "created_no_email" | "exists" | "skipped" | "failed";
  detail: string;
  tempPassword?: string;
}

interface CreateAccountResponse {
  requested: number;
  created: number;
  createdNoEmail: number;
  alreadyExisted: number;
  skipped: number;
  failed: number;
  outcomes: CreateAccountOutcome[];
}

/** A rep is anchored on their home only when BOTH coordinates are present. */
function hasHomeGps(rep: Rep): boolean {
  return !!(rep.homeGpsLat || "").trim() && !!(rep.homeGpsLng || "").trim();
}

/**
 * Matches the server's check. 17 of the 244 reps have no email at all, and an
 * account cannot be sent anywhere without one — so the button says why rather
 * than failing when it is pressed.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || "").trim());
}

/** Sort order for the results list: anything needing a human comes first. */
function rank(status: CreateAccountOutcome["status"]): number {
  const order: Record<CreateAccountOutcome["status"], number> = {
    created_no_email: 0,
    failed: 1,
    skipped: 2,
    exists: 3,
    created: 4,
  };
  return order[status];
}

export default function RepsPage() {
  const { can } = useSession();
  const [reps, setReps] = useState<Rep[]>([]);
  const [visitRoles, setVisitRoles] = useState<VisitRole[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Rep>>({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newRep, setNewRep] = useState<Partial<Rep>>({ code: "", name: "", email: "", cell: "", homeAddress: "", workingHoursPerDay: 8.5 });
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savingTeamFor, setSavingTeamFor] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResponse | null>(null);
  const [geocodeError, setGeocodeError] = useState("");
  const [repsWithLogin, setRepsWithLogin] = useState<Set<string>>(new Set());
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [accountResult, setAccountResult] = useState<CreateAccountResponse | null>(null);
  const [accountError, setAccountError] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const canExport = can("export_data");
  const canImport = can("import_reps");
  const canManageReps = can("manage_reps");
  const canCreateAccounts = can("create_rep_accounts");

  // Reps whose address is captured but whose route still anchors on a store
  // centroid because no coordinate was ever derived from it.
  const awaitingGeocode = reps.filter(
    (r) => (r.homeAddress || "").trim() && !hasHomeGps(r)
  ).length;

  /** Has a usable email and no login yet — the reps the bulk button acts on. */
  const needsLogin = reps.filter(
    (r) => looksLikeEmail(r.email || "") && !repsWithLogin.has(r.id)
  );

  const load = () => {
    fetch("/api/reps")
      .then((r) => r.json())
      .then((data) => {
        setReps(data);
        setLoading(false);
      });
  };

  const loadAccounts = () => {
    if (!canCreateAccounts) return;
    fetch("/api/reps/create-account")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.repIdsWithLogin)) {
          setRepsWithLogin(new Set(data.repIdsWithLogin));
        }
      })
      .catch(() => {
        /* the column just shows nothing rather than blocking the page */
      });
  };

  useEffect(() => {
    load();
    fetch("/api/visit-roles")
      .then((r) => r.json())
      .then((data) => setVisitRoles(Array.isArray(data) ? data : []))
      .catch(() => setVisitRoles([]));
    fetch("/api/teams")
      .then((r) => r.json())
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch(() => setTeams([]));
  }, []);

  // Separate from the load above because `can()` reads the session, which
  // arrives asynchronously — firing this once on mount would skip it for anyone
  // whose session hadn't resolved yet, and the Login column would stay blank.
  useEffect(() => {
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreateAccounts]);

  /**
   * Give reps logins so they can maintain their own home address.
   *
   * Sent in chunks: each request mints passwords and sends mail one rep at a
   * time, so a single call covering 227 people would run past the function's
   * time budget and past the mail provider's send rate. The chunk size matches
   * the server's own cap.
   */
  const createAccounts = async (targets: Rep[]) => {
    if (targets.length === 0) return;
    setAccountError("");
    setAccountResult(null);

    const CHUNK = 20;
    const merged: CreateAccountResponse = {
      requested: 0, created: 0, createdNoEmail: 0, alreadyExisted: 0, skipped: 0, failed: 0, outcomes: [],
    };

    if (targets.length > CHUNK) setBulkProgress({ done: 0, total: targets.length });

    try {
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = targets.slice(i, i + CHUNK);
        const res = await fetch("/api/reps/create-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repIds: batch.map((r) => r.id) }),
        });
        const data = await res.json();

        if (!res.ok) {
          setAccountError(data.error || "Could not create logins");
          // Whatever succeeded before the failure still happened, so show it
          // rather than throwing the partial result away.
          break;
        }

        merged.requested += data.requested ?? 0;
        merged.created += data.created ?? 0;
        merged.createdNoEmail += data.createdNoEmail ?? 0;
        merged.alreadyExisted += data.alreadyExisted ?? 0;
        merged.skipped += data.skipped ?? 0;
        merged.failed += data.failed ?? 0;
        merged.outcomes.push(...(data.outcomes ?? []));

        if (targets.length > CHUNK) {
          setBulkProgress({ done: Math.min(i + CHUNK, targets.length), total: targets.length });
        }
      }
    } catch {
      setAccountError("Network error while creating logins. Some may have been created — reload to check.");
    } finally {
      setBulkProgress(null);
      if (merged.outcomes.length > 0) setAccountResult(merged);
      loadAccounts();
    }
  };

  const createOneAccount = async (rep: Rep) => {
    setCreatingFor(rep.id);
    await createAccounts([rep]);
    setCreatingFor(null);
  };

  /**
   * Assign straight from the row. Dragging reps into team cards is fine for a
   * handful of people but unusable at 147, which is what this list holds.
   */
  const setTeamForRep = async (rep: Rep, teamId: string) => {
    setSavingTeamFor(rep.id);
    // Optimistic — the dropdown should feel instant
    setReps((prev) => prev.map((r) => (r.id === rep.id ? { ...r, teamId } : r)));
    try {
      const res = await fetch("/api/reps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rep.id, teamId }),
      });
      if (!res.ok) load(); // revert to server truth
    } catch {
      load();
    } finally {
      setSavingTeamFor(null);
    }
  };

  /**
   * Derive home coordinates from home addresses. The route engine already
   * starts each day at the rep's home when it has one — this is what finally
   * gives it one. `force` re-submits a result the server held back as too
   * vague, once a human has looked at it.
   */
  const runGeocode = async (body: { all: true } | { repId: string; force?: boolean }) => {
    setGeocoding(true);
    setGeocodeError("");
    try {
      const res = await fetch("/api/reps/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGeocodeError(data.error || `Geocoding failed (${res.status})`);
        return;
      }
      // Merge single-rep results into any review list already on screen, so
      // accepting one row doesn't wipe the other rows still awaiting a decision.
      setGeocodeResult((prev) => {
        if (!prev || "all" in body) return data as GeocodeResponse;
        const incoming = (data as GeocodeResponse).outcomes;
        const byId = new Map(prev.outcomes.map((o) => [o.repId, o]));
        for (const o of incoming) byId.set(o.repId, o);
        const outcomes = [...byId.values()];
        return {
          considered: prev.considered,
          saved: outcomes.filter((o) => o.status === "saved").length,
          needsReview: outcomes.filter((o) => o.status === "review").length,
          failed: outcomes.filter((o) => o.status === "failed").length,
          outcomes,
        };
      });
      load();
    } catch (e) {
      setGeocodeError(String(e));
    } finally {
      setGeocoding(false);
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/reps/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportMsg({ type: "error", text: data.error || `Import failed (${res.status})` });
      } else {
        const parts = [`${data.created} created`, `${data.updated} updated`];
        if (data.errors?.length) parts.push(`${data.errors.length} rejected`);
        setImportMsg({
          type: data.errors?.length ? "error" : "success",
          text: `${parts.join(", ")}.${data.errors?.length ? " " + data.errors.slice(0, 5).join("; ") + (data.errors.length > 5 ? ` …and ${data.errors.length - 5} more` : "") : ""}`,
        });
        load();
      }
    } catch (e) {
      setImportMsg({ type: "error", text: String(e) });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  // A rep with no visitRoleId is on the primary sales role.
  const roleName = (id?: string) => {
    const role = id
      ? visitRoles.find((r) => r.id === id)
      : visitRoles.find((r) => r.isPrimary);
    return role?.name ?? "Sales Rep";
  };

  const startEdit = (rep: Rep) => {
    setEditing(rep.id);
    setEditData({ ...rep });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditData({});
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/reps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const addRep = async () => {
    setSaving(true);
    setError("");
    const res = await fetch("/api/reps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRep),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to add rep");
      setSaving(false);
      return;
    }
    setShowAdd(false);
    setNewRep({ code: "", name: "", email: "", cell: "", homeAddress: "", workingHoursPerDay: 8.5 });
    setSaving(false);
    load();
  };

  const deleteRep = async (id: string) => {
    if (!confirm("Delete this rep?")) return;
    await fetch("/api/reps", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
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
          <h1 className="text-xl font-bold text-gray-900">Sales Reps</h1>
          <p className="text-sm text-gray-500">{reps.length} reps</p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <>
              <a
                href="/api/reps/export?format=xlsx"
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Export Excel
              </a>
              <a
                href="/api/reps/export?format=csv"
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Export CSV
              </a>
            </>
          )}
          {canImport && (
            <label className={`px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors ${importing ? "opacity-50" : "hover:bg-gray-50 cursor-pointer"}`}>
              {importing ? "Importing..." : "Import Reps"}
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImport(f);
                }}
              />
            </label>
          )}
          {canManageReps && awaitingGeocode > 0 && (
            <button
              onClick={() => runGeocode({ all: true })}
              disabled={geocoding}
              title="Look up each rep's home address and store the coordinates, so routes start from home instead of the middle of their stores"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {geocoding ? "Locating..." : `Set Home GPS (${awaitingGeocode})`}
            </button>
          )}
          {canCreateAccounts && needsLogin.length > 0 && (
            <button
              onClick={() => createAccounts(needsLogin)}
              disabled={!!bulkProgress || !!creatingFor}
              title="Email each rep a login so they can set their own home address"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {bulkProgress
                ? `Creating ${bulkProgress.done}/${bulkProgress.total}...`
                : `Create Logins (${needsLogin.length})`}
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark transition-colors"
          >
            + Add Rep
          </button>
        </div>
      </div>

      {canImport && (
        <p className="text-xs text-gray-400 -mt-4 mb-4">
          Export the list, edit it in Excel, then import it back. Reps are matched on Rep Code —
          edit the Team column to reassign people in bulk.
        </p>
      )}

      {importMsg && (
        <div
          className={`p-3 rounded-lg text-sm mb-6 flex items-start justify-between gap-4 ${
            importMsg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          <span>{importMsg.text}</span>
          <button onClick={() => setImportMsg(null)} className="text-xs opacity-60 hover:opacity-100 flex-shrink-0">
            dismiss
          </button>
        </div>
      )}

      {geocodeError && (
        <div className="p-3 rounded-lg text-sm mb-6 bg-red-50 text-red-700">{geocodeError}</div>
      )}

      {accountError && (
        <div className="p-3 rounded-lg text-sm mb-6 bg-red-50 text-red-700">{accountError}</div>
      )}

      {/* Rep login results. Anything that did NOT get an account has to say so
          by name — a summary count would quietly hide the reps who were left
          without one because their email was blank. */}
      {accountResult && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">
                Rep logins: {accountResult.created} created and emailed
                {accountResult.createdNoEmail > 0 && `, ${accountResult.createdNoEmail} created but NOT emailed`}
                {accountResult.alreadyExisted > 0 && `, ${accountResult.alreadyExisted} already had one`}
                {accountResult.skipped > 0 && `, ${accountResult.skipped} skipped`}
                {accountResult.failed > 0 && `, ${accountResult.failed} failed`}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Each rep was asked to sign in and set their home address. Nothing changes on their routes
                until they do — and routes must be regenerated afterwards.
              </p>
            </div>
            <button
              onClick={() => setAccountResult(null)}
              className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              dismiss
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
            {accountResult.outcomes
              // Everything that needs a human sorts to the top; the plain
              // successes are the ones nobody has to read.
              .slice()
              .sort((a, b) => rank(a.status) - rank(b.status))
              .map((o) => (
                <div key={`${o.repId}-${o.email}`} className="py-2 text-xs flex items-start gap-3">
                  <span
                    className={`mt-0.5 px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                      o.status === "created"
                        ? "bg-iram-green/10 text-iram-green-dark"
                        : o.status === "exists"
                          ? "bg-gray-100 text-gray-500"
                          : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {o.status === "created"
                      ? "emailed"
                      : o.status === "created_no_email"
                        ? "no email sent"
                        : o.status === "exists"
                          ? "already had one"
                          : o.status === "skipped"
                            ? "skipped"
                            : "failed"}
                  </span>
                  <span className="flex-1">
                    <span className="font-medium text-gray-800">
                      {o.name} {o.code && <span className="text-gray-400">({o.code})</span>}
                    </span>
                    <span className="text-gray-500"> — {o.detail}</span>
                    {o.tempPassword && (
                      <span className="block mt-1 font-mono text-[11px] text-gray-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        {o.email} · {o.tempPassword}
                      </span>
                    )}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Geocoding results. Vague matches are listed rather than saved — a
          suburb centroid looks identical to a real home once it is stored. */}
      {geocodeResult && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">
                Home GPS: {geocodeResult.saved} saved
                {geocodeResult.needsReview > 0 && `, ${geocodeResult.needsReview} need checking`}
                {geocodeResult.failed > 0 && `, ${geocodeResult.failed} not found`}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Saved reps now start their day at home. Anything below was too vague to
                store on its own — check it on Google, then accept it or fix the address.
              </p>
            </div>
            <button
              onClick={() => setGeocodeResult(null)}
              className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              dismiss
            </button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {geocodeResult.outcomes
              .filter((o) => o.status !== "saved")
              .map((o) => (
                <div
                  key={o.repId}
                  className={`p-3 rounded-lg text-xs ${
                    o.status === "review" ? "bg-amber-50" : "bg-red-50"
                  }`}
                >
                  <div className="font-medium text-gray-900">
                    {o.name} <span className="font-mono text-gray-500">({o.code})</span>
                  </div>
                  <div className="text-gray-600 mt-0.5">Captured: {o.address}</div>
                  <div className={o.status === "review" ? "text-amber-700 mt-0.5" : "text-red-700 mt-0.5"}>
                    {o.reason}
                  </div>
                  {o.status === "review" && (
                    <div className="mt-2 flex items-center gap-3">
                      <CheckAddressOnGoogle address={o.address} compact />
                      <button
                        onClick={() => runGeocode({ repId: o.repId, force: true })}
                        disabled={geocoding}
                        className="mt-1 px-1.5 py-0.5 text-[11px] font-medium rounded border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Use it anyway
                      </button>
                    </div>
                  )}
                </div>
              ))}
            {geocodeResult.outcomes.every((o) => o.status === "saved") && (
              <p className="text-xs text-gray-500">Every address resolved cleanly. Nothing to check.</p>
            )}
          </div>
          <p className="text-xs text-amber-700 mt-3">
            Routes already generated still use the old anchor — regenerate them to pick this up.
          </p>
        </div>
      )}

      {/* Add Rep Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">New Rep</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "code", label: "Rep Code", placeholder: "e.g. GAU099" },
              { key: "name", label: "Full Name", placeholder: "Name Surname" },
              { key: "email", label: "Email", placeholder: "email@company.com" },
              { key: "cell", label: "Cell Number", placeholder: "+27..." },
              { key: "homeAddress", label: "Home Address", placeholder: "Street, City" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  value={(newRep as Record<string, string>)[key] || ""}
                  onChange={(e) => setNewRep({ ...newRep, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                />
                {key === "homeAddress" && <CheckAddressOnGoogle address={newRep.homeAddress} />}
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hours/Day</label>
              <input
                type="number"
                step={0.5}
                min={4}
                max={12}
                value={newRep.workingHoursPerDay ?? 8.5}
                onChange={(e) => setNewRep({ ...newRep, workingHoursPerDay: parseFloat(e.target.value) || 8.5 })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
          </div>
          {error && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={addRep}
              disabled={saving}
              className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Rep"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setError(""); }}
              className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reps Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Cell</th>
                <th className="px-6 py-3">Home Address</th>
                <th className="px-6 py-3">Starts Day At</th>
                {canCreateAccounts && <th className="px-6 py-3">Login</th>}
                <th className="px-6 py-3">Team</th>
                <th className="px-6 py-3">Visit Role</th>
                <th className="px-6 py-3 text-center">Hours/Day</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reps.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50">
                  {editing === rep.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.code || ""}
                          onChange={(e) => setEditData({ ...editData, code: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.email || ""}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.cell || ""}
                          onChange={(e) => setEditData({ ...editData, cell: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.homeAddress || ""}
                          onChange={(e) => setEditData({ ...editData, homeAddress: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                        <CheckAddressOnGoogle address={editData.homeAddress} compact />
                      </td>
                      <td className="px-6 py-3 text-xs text-gray-400 italic">
                        Save, then Set Home GPS
                      </td>
                      {canCreateAccounts && (
                        <td className="px-6 py-3 text-xs text-gray-400 italic">Save first</td>
                      )}
                      <td className="px-6 py-3">
                        <select
                          value={editData.teamId ?? ""}
                          onChange={(e) => setEditData({ ...editData, teamId: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                        >
                          <option value="">Unassigned</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={editData.visitRoleId ?? ""}
                          onChange={(e) => setEditData({ ...editData, visitRoleId: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                        >
                          {visitRoles.map((r) => (
                            <option key={r.id} value={r.isPrimary ? "" : r.id}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3 text-center">
                        <input
                          type="number"
                          step={0.5}
                          min={4}
                          max={12}
                          value={editData.workingHoursPerDay ?? 8.5}
                          onChange={(e) => setEditData({ ...editData, workingHoursPerDay: parseFloat(e.target.value) || 8.5 })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-16 text-center focus:outline-none focus:ring-1 focus:ring-iram-green"
                        />
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => saveEdit(rep.id)} disabled={saving} className="text-green-600 hover:text-green-800 text-xs font-medium">
                          Save
                        </button>
                        <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 text-xs font-medium">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-100 text-gray-700">
                          {rep.code}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-medium text-gray-900">{rep.name}</td>
                      <td className="px-6 py-3 text-gray-600">{rep.email || <span className="text-gray-300 italic">Not set</span>}</td>
                      <td className="px-6 py-3 text-gray-600">{rep.cell || <span className="text-gray-300 italic">Not set</span>}</td>
                      <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{rep.homeAddress || <span className="text-gray-300 italic">Not set</span>}</td>
                      {/* Never blank: falling back to the store centroid IS the
                          behaviour, and a rep silently anchored in the middle of
                          their patch is the thing worth seeing at a glance. */}
                      <td className="px-6 py-3 text-xs">
                        {hasHomeGps(rep) ? (
                          <span className="text-gray-600" title={`${rep.homeGpsLat}, ${rep.homeGpsLng}`}>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium">
                              Home
                            </span>
                            <span className="block text-gray-400 font-mono mt-0.5">
                              {parseFloat(rep.homeGpsLat).toFixed(4)}, {parseFloat(rep.homeGpsLng).toFixed(4)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-500">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              Store centroid
                            </span>
                            {canManageReps && (rep.homeAddress || "").trim() && (
                              <button
                                onClick={() => runGeocode({ repId: rep.id })}
                                disabled={geocoding}
                                className="block mt-1 text-iram-green hover:underline disabled:opacity-50"
                              >
                                Set from address
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                      {canCreateAccounts && (
                        <td className="px-6 py-3 text-xs">
                          {repsWithLogin.has(rep.id) ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-iram-green/10 text-iram-green-dark font-medium">
                              Has login
                            </span>
                          ) : !looksLikeEmail(rep.email || "") ? (
                            // Says why rather than offering a button that cannot work.
                            <span
                              className="text-gray-400"
                              title="A login is emailed to the rep, so there has to be an address to send it to"
                            >
                              No email
                            </span>
                          ) : (
                            <button
                              onClick={() => createOneAccount(rep)}
                              disabled={!!creatingFor || !!bulkProgress}
                              title={`Email ${rep.email} a login so they can set their own home address`}
                              className="rounded border border-gray-200 px-2 py-1 font-medium text-iram-green transition-colors hover:bg-gray-50 disabled:opacity-50"
                            >
                              {creatingFor === rep.id ? "Creating..." : "Create Account"}
                            </button>
                          )}
                        </td>
                      )}
                      <td className="px-6 py-3">
                        {/* Live dropdown — no need to enter edit mode just to
                            move someone between teams. */}
                        <select
                          value={rep.teamId || ""}
                          disabled={savingTeamFor === rep.id}
                          onChange={(e) => setTeamForRep(rep, e.target.value)}
                          className={`border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green disabled:opacity-50 ${
                            rep.teamId ? "border-gray-200 text-gray-700" : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          <option value="">Unassigned</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3 text-gray-600">{roleName(rep.visitRoleId)}</td>
                      <td className="px-6 py-3 text-center text-gray-600">{rep.workingHoursPerDay ?? 8.5}</td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => startEdit(rep)} className="text-iram-green hover:text-red-800 text-xs font-medium">
                          Edit
                        </button>
                        <button onClick={() => deleteRep(rep.id)} className="text-gray-400 hover:text-red-600 text-xs font-medium">
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
