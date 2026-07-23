"use client";

import { useState, useEffect, useCallback } from "react";
import { PerigeeSyncLogEntry, CronLogEntry, PollSlot, PollSchedule } from "@/lib/types";

interface ConfigView {
  apiKey: string; // masked
  hasApiKey: boolean;
  endpoint: string;
  customer: string;
  requestBody: string;
  enabled: boolean;
  lastVisitSync: string | null;
}

const EMPTY_CONFIG: ConfigView = {
  apiKey: "",
  hasApiKey: false,
  endpoint: "https://live.perigeeportal.co.za/api/visits",
  customer: "",
  requestBody: "",
  enabled: false,
  lastVisitSync: null,
};

const todayISO = () => new Date().toISOString().slice(0, 10);

function fmtDate(d: string | null | undefined) {
  if (!d) return "Never";
  return new Date(d).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PerigeePage() {
  const [config, setConfig] = useState<ConfigView>(EMPTY_CONFIG);
  const [schedule, setSchedule] = useState<PollSchedule>({ slots: [], timezone: "Africa/Johannesburg" });
  const [syncLogs, setSyncLogs] = useState<PerigeeSyncLogEntry[]>([]);
  const [cronLogs, setCronLogs] = useState<CronLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // API connection
  const [editKey, setEditKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Manual pull
  const [from, setFrom] = useState(todayISO);
  const [to, setTo] = useState(todayISO);
  const [syncing, setSyncing] = useState<"test" | "import" | null>(null);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string; detail?: string } | null>(null);

  // Schedule
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState("");
  const [runningNow, setRunningNow] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [cfgRes, schRes, logRes] = await Promise.all([
        fetch("/api/perigee/config", { cache: "no-store" }),
        fetch("/api/perigee/schedule", { cache: "no-store" }),
        fetch("/api/perigee/logs", { cache: "no-store" }),
      ]);
      if (cfgRes.ok) setConfig({ ...EMPTY_CONFIG, ...(await cfgRes.json()) });
      if (schRes.ok) setSchedule(await schRes.json());
      if (logRes.ok) {
        const l = await logRes.json();
        setSyncLogs(Array.isArray(l.sync) ? l.sync : []);
        setCronLogs(Array.isArray(l.cron) ? l.cron : []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---------- API connection ----------

  const configBody = (extra: Record<string, unknown> = {}) => ({
    endpoint: config.endpoint,
    customer: config.customer,
    requestBody: config.requestBody,
    enabled: config.enabled,
    ...(editKey ? { apiKey: editKey } : {}),
    ...extra,
  });

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    const res = await fetch("/api/perigee/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configBody()),
    });
    const data = await res.json().catch(() => ({}));
    setTestResult(res.ok ? { ok: true, msg: "Settings saved" } : { ok: false, msg: data.error || "Failed to save" });
    setEditKey("");
    setSaving(false);
    loadData();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/perigee/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configBody({ test: true })),
    });
    const data = await res.json().catch(() => ({}));
    setTestResult(
      data.connected
        ? { ok: true, msg: `Connected — ${data.rowsToday ?? 0} visit(s) on today's page 1` }
        : { ok: false, msg: data.error || "Connection failed" }
    );
    setEditKey("");
    setTesting(false);
    loadData();
  };

  // ---------- Manual pull ----------

  const handleSync = async (mode: "test" | "import") => {
    setSyncing(mode);
    setSyncResult(null);
    try {
      const res = await fetch("/api/perigee/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncResult({ ok: false, msg: data.error || "Pull failed" });
      } else if (mode === "test") {
        setSyncResult({
          ok: true,
          msg: `Found ${data.fetched} visit(s) over ${data.pageInfo?.pagesFetched ?? 1} page(s)`,
          detail: JSON.stringify(data.sample, null, 2),
        });
      } else {
        setSyncResult({
          ok: true,
          msg: `Imported ${data.imported}, skipped ${data.skipped} duplicate(s)${
            data.unmatchedReps ? ` — ${data.unmatchedReps} visit(s) could not be matched to a rep` : ""
          }`,
        });
      }
    } catch (err) {
      setSyncResult({ ok: false, msg: err instanceof Error ? err.message : "Error" });
    }
    setSyncing(null);
    loadData();
  };

  // ---------- Schedule ----------

  const addSlot = () =>
    setSchedule((p) => ({
      ...p,
      slots: [...p.slots, { id: crypto.randomUUID(), time: "08:00", type: "short", enabled: true }],
    }));

  const updateSlot = (id: string, patch: Partial<PollSlot>) =>
    setSchedule((p) => ({ ...p, slots: p.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const removeSlot = (id: string) =>
    setSchedule((p) => ({ ...p, slots: p.slots.filter((s) => s.id !== id) }));

  const saveSchedule = async () => {
    setScheduleSaving(true);
    setScheduleMsg("");
    const res = await fetch("/api/perigee/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    });
    const data = await res.json().catch(() => ({}));
    setScheduleMsg(res.ok ? "Schedule saved" : data.error || "Failed to save");
    setScheduleSaving(false);
    loadData();
  };

  const runNow = async () => {
    setRunningNow(true);
    setScheduleMsg("");
    try {
      const res = await fetch("/api/cron/poll-visits?force=true", { cache: "no-store" });
      const data = await res.json();
      setScheduleMsg(
        res.ok && data.ok
          ? `Poll ran: ${data.imported ?? 0} imported, ${data.skipped ?? 0} skipped`
          : data.error || data.reason || "Poll failed"
      );
    } catch {
      setScheduleMsg("Poll failed");
    }
    setRunningNow(false);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Perigee Integration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pull actual visits from Perigee for planned vs actual reporting.
        </p>
      </div>

      {/* Section 1: API connection */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">API Connection</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint</label>
            <input
              value={config.endpoint}
              onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="https://live.perigeeportal.co.za/api/visits"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Token</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={editKey}
                onChange={(e) => setEditKey(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10"
                placeholder={config.hasApiKey ? `Saved (${config.apiKey}) — leave blank to keep` : "Perigee bearer token"}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {showKey ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <input
                value={config.customer}
                onChange={(e) => setConfig({ ...config, customer: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Perigee customer name"
              />
              <p className="text-xs text-gray-400 mt-1">Sent as <code>customers: [ ... ]</code>.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Extra request body (JSON)</label>
              <textarea
                value={config.requestBody}
                onChange={(e) => setConfig({ ...config, requestBody: e.target.value })}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder={'{ "projects": ["..."] }'}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              className="rounded border-gray-300"
            />
            Scheduled polling enabled
          </label>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleTest}
              disabled={testing || saving}
              className="px-4 py-2 bg-iram-green text-white rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || testing}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
            <span className="text-xs text-gray-400">Last successful pull: {fmtDate(config.lastVisitSync)}</span>
            {testResult && (
              <span className={`text-sm font-medium ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
                {testResult.ok ? "✓" : "✗"} {testResult.msg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Manual pull */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Pull Visits</h2>
        <p className="text-xs text-gray-500 mb-4">
          Test previews the first few rows without storing anything. Import stores new visits — re-running a
          range is safe, duplicates are skipped.
        </p>

        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => handleSync("test")}
            disabled={syncing !== null}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing === "test" ? "Testing..." : "Test"}
          </button>
          <button
            onClick={() => handleSync("import")}
            disabled={syncing !== null}
            className="px-4 py-2 bg-iram-green text-white rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
          >
            {syncing === "import" ? "Importing..." : "Import"}
          </button>
        </div>

        {syncResult && (
          <div className="mt-4">
            <p className={`text-sm font-medium ${syncResult.ok ? "text-green-600" : "text-red-600"}`}>
              {syncResult.ok ? "✓" : "✗"} {syncResult.msg}
            </p>
            {syncResult.detail && (
              <pre className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-[11px] text-gray-700 overflow-auto max-h-64">
                {syncResult.detail}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Section 3: Poll schedule */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Poll Schedule</h2>
        <p className="text-xs text-gray-500 mb-4">
          Vercel wakes the poller every 30 minutes; it only pulls when the time lands on one of these slots
          (within 15 minutes). <strong>Short</strong> pulls today only, <strong>long</strong> pulls the last 7
          days so back-dated visits are picked up. Times are {schedule.timezone}.
        </p>

        <div className="space-y-2">
          {schedule.slots.length === 0 && (
            <p className="text-sm text-gray-400">No slots yet — nothing is polled automatically.</p>
          )}
          {schedule.slots.map((slot) => (
            <div key={slot.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
              <input
                type="checkbox"
                checked={slot.enabled}
                onChange={(e) => updateSlot(slot.id, { enabled: e.target.checked })}
                className="rounded border-gray-300"
              />
              <input
                type="time"
                value={slot.time}
                onChange={(e) => updateSlot(slot.id, { time: e.target.value })}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <select
                value={slot.type}
                onChange={(e) => updateSlot(slot.id, { type: e.target.value as PollSlot["type"] })}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="short">Short — today</option>
                <option value="long">Long — last 7 days</option>
              </select>
              <button
                onClick={() => removeSlot(slot.id)}
                className="ml-auto text-xs text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button
            onClick={addSlot}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50"
          >
            + Add slot
          </button>
          <button
            onClick={saveSchedule}
            disabled={scheduleSaving}
            className="px-4 py-2 bg-iram-green text-white rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
          >
            {scheduleSaving ? "Saving..." : "Save Schedule"}
          </button>
          <button
            onClick={runNow}
            disabled={runningNow}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
          >
            {runningNow ? "Running..." : "Run Poll Now"}
          </button>
          {scheduleMsg && <span className="text-sm text-gray-600">{scheduleMsg}</span>}
        </div>
      </div>

      {/* Section 4: Import log */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Import Log</h2>
        {syncLogs.length === 0 ? (
          <p className="text-sm text-gray-400">No imports yet.</p>
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-left">Range</th>
                  <th className="px-4 py-2 text-right">Imported</th>
                  <th className="px-4 py-2 text-right">Skipped</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {syncLogs.map((entry, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtDate(entry.timestamp)}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {entry.source}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                      {entry.from === entry.to ? entry.from : `${entry.from} → ${entry.to}`}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">{entry.recordsImported}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{entry.recordsSkipped}</td>
                    <td className="px-4 py-2">
                      {entry.error ? (
                        <span className="text-red-600 text-xs">{entry.error}</span>
                      ) : (
                        <span className="text-green-600 text-xs">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 5: Cron activity */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Scheduler Activity</h2>
        {cronLogs.length === 0 ? (
          <p className="text-sm text-gray-400">The scheduler has not run yet.</p>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Slot</th>
                  <th className="px-4 py-2 text-right">Imported</th>
                  <th className="px-4 py-2 text-left">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cronLogs.map((entry, i) => (
                  <tr key={i} className={`hover:bg-gray-50 ${entry.matched ? "" : "text-gray-400"}`}>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(entry.timestamp)}</td>
                    <td className="px-4 py-2 text-xs">
                      {entry.matched ? `${entry.slotTime} (${entry.slotType})` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">{entry.imported ?? "—"}</td>
                    <td className="px-4 py-2 text-xs">
                      {entry.error ? <span className="text-red-600">{entry.error}</span> : entry.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
