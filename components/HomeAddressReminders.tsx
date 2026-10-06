"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The Monday reminder, on the page where somebody would go looking for it.
 * Ported from Clippa Rep Router.
 *
 * It is not a settings screen. Its job is to answer, at a glance, the three
 * questions an automated mail-out raises: who is it going to write to, is it
 * actually running, and how do I stop it. The list of names is the important
 * part: 180 real people get this mail, and nobody should have to guess who.
 *
 * Declared in its own module rather than inside the Reps page. A component
 * defined inside another component is a new type on every render, so React
 * remounts it and every bit of open/closed state here would snap shut each time
 * the reps list reloaded.
 */

interface OutstandingRep {
  repId: string;
  code: string;
  name: string;
  email: string;
  activeStores: number;
  hasAddressWithoutGps: boolean;
  teamName: string;
  managerName: string;
  managerEmail: string;
  timesReminded: number;
  lastRemindedAt: string | null;
}

type BlockReason = "no_email" | "no_login" | "no_manager";

interface BlockedRep extends OutstandingRep {
  reason: BlockReason;
}

interface ReminderRun {
  id: string;
  startedAt: string;
  trigger: "cron" | "manual";
  dryRun: boolean;
  outstanding: number;
  sent: number;
  failed: number;
  blocked: number;
  managersEmailed: number;
  summarySent: boolean;
  settled: number;
  skippedReason?: string;
  error?: string;
}

interface ReminderStatus {
  enabled: boolean;
  schedule: string;
  summaryTo: string[];
  cronSecretSet: boolean;
  plan: {
    outstanding: OutstandingRep[];
    mailable: string[];
    blocked: BlockedRep[];
    settled: { repId: string; code: string; name: string; timesReminded: number }[];
    managerDigests: { managerName: string; managerEmail: string; teamName: string; repCount: number }[];
    repsWithNoManagerContact: number;
    managerAddressIssues: { teamName: string; storedValue: string; usableCount: number; outstandingReps: number }[];
    totalReps: number;
    repsWithHome: number;
  };
  runs: ReminderRun[];
}

const BLOCK_LABEL: Record<BlockReason, string> = {
  no_email: "No email address",
  no_login: "No login yet",
  no_manager: "No team manager",
};

/** Drops a leading capital so a standalone phrase reads inside a sentence. */
function midSentence(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function whenText(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "never";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export default function HomeAddressReminders() {
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"" | "preview" | "send" | "toggle">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);

  const load = useCallback(() => {
    fetch("/api/cron/home-address-reminder")
      .then(async (res) => {
        if (!res.ok) {
          // A 403 just means this login cannot manage reps. The panel simply
          // does not appear.
          if (res.status === 403 || res.status === 401) return null;
          throw new Error(`Could not read reminder status (${res.status})`);
        }
        return res.json();
      })
      .then((data) => setStatus(data))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summaryText = status?.summaryTo?.length ? status.summaryTo.join(" and ") : "";

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "send");
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/cron/home-address-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Run failed (${res.status})`);
      const r = data.run as ReminderRun;
      setMessage(
        dryRun
          ? `Preview only. Nothing was sent to any rep. The summary of ${r.outstanding} outstanding rep${r.outstanding === 1 ? "" : "s"} went to ${
              summaryText || "nobody, because no summary address is set"
            }.`
          : `Emailed ${r.sent} rep${r.sent === 1 ? "" : "s"} and copied ${r.managersEmailed} manager${r.managersEmailed === 1 ? "" : "s"}.${
              r.failed > 0 ? ` ${r.failed} failed, see the summary email.` : ""
            }`
      );
      setConfirmSend(false);
      load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy("");
    }
  };

  const toggle = async () => {
    if (!status) return;
    setBusy("toggle");
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeAddressRemindersEnabled: !status.enabled }),
      });
      if (!res.ok) throw new Error(`Could not change the setting (${res.status})`);
      load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy("");
    }
  };

  if (loading || !status) return null;

  const { plan } = status;
  const mailableCount = plan.mailable.length;
  const managerCount = plan.managerDigests.length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-sm">Home address reminders</h3>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                status.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {status.enabled ? "On" : "Off"}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {plan.outstanding.length === 0 ? (
              <>Every rep has a home the router can start from. Nothing to send.</>
            ) : (
              <>
                <strong className="text-gray-900">{plan.outstanding.length}</strong> of {plan.totalReps} reps have no home the
                router can use.{" "}
                {status.enabled ? (
                  <>
                    {mailableCount} will be emailed {midSentence(status.schedule)}, with {managerCount} manager
                    {managerCount === 1 ? "" : "s"} copied.
                  </>
                ) : (
                  <>Reminders are switched off, so nothing will be sent.</>
                )}
              </>
            )}
          </p>
          {plan.repsWithNoManagerContact > 0 && (
            <p className="text-sm text-amber-700 mt-1">
              {plan.repsWithNoManagerContact} of them are held back because they are not in a team with a manager. Put them in a
              team and they join the next run.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => run(true)}
            disabled={busy !== ""}
            title="Email the run summary of who would be written to. No rep or manager is contacted."
            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {busy === "preview" ? "Building..." : "Email the list to the summary recipients"}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            {expanded ? "Hide" : `Show who (${plan.outstanding.length})`}
          </button>
          <button
            onClick={toggle}
            disabled={busy !== ""}
            title={
              status.enabled
                ? "Stop the Monday reminder. The schedule still runs and is still logged, it just sends nothing."
                : "Start sending the Monday reminder again"
            }
            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {busy === "toggle" ? "Saving..." : status.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </div>

      {/* The two ways this quietly does nothing, said out loud. */}
      {!status.cronSecretSet && (
        <div className="mx-4 mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-700">
          <strong>CRON_SECRET is not set in Vercel.</strong> Without it the Monday run is refused and no email is ever sent, with
          nothing on any screen to say so.
        </div>
      )}
      {status.summaryTo.length === 0 && (
        <div className="mx-4 mb-4 p-3 rounded-lg text-sm bg-amber-50 text-amber-800">
          No summary address is set (<code>REMINDER_SUMMARY_TO</code> or <code>RESEND_REPLY_TO</code>), so nobody gets told what
          each run did.
        </div>
      )}

      {/* A manager email that cannot be sent to. Shown on the header, not in the
          drawer: a typo here silently stops a manager being copied every week. */}
      {plan.managerAddressIssues.length > 0 && (
        <div className="mx-4 mb-4 p-3 rounded-lg text-sm bg-amber-50 text-amber-800">
          <strong>Fix on the Teams page:</strong>{" "}
          {plan.managerAddressIssues.map((i, n) => (
            <span key={i.teamName}>
              {n > 0 && "; "}
              {i.teamName} has <code className="text-xs">{i.storedValue}</code> as its manager email.{" "}
              {i.usableCount > 0
                ? `${i.usableCount} of those addresses work and will be copied, the broken part will not.`
                : `Nothing in it can be sent to, so its ${i.outstandingReps} reps are held back.`}
            </span>
          ))}
        </div>
      )}

      {message && <div className="mx-4 mb-4 p-3 rounded-lg text-sm bg-green-50 text-green-700">{message}</div>}
      {error && <div className="mx-4 mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-700">{error}</div>}

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Outstanding" value={plan.outstanding.length} />
            <Stat label="Will be emailed" value={mailableCount} />
            <Stat label="Held back" value={plan.blocked.length} tone={plan.blocked.length ? "warn" : "plain"} />
            <Stat label="Anchored on home" value={plan.repsWithHome} />
          </div>

          {plan.outstanding.length > 0 && (
            <div className="overflow-x-auto border border-gray-100 rounded-lg mb-4 max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Rep</th>
                    <th className="px-3 py-2 text-left font-medium">Stores</th>
                    <th className="px-3 py-2 text-left font-medium">Reminded</th>
                    <th className="px-3 py-2 text-left font-medium">Manager copied</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Team</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plan.outstanding.map((r) => {
                    const blocked = plan.blocked.find((b) => b.repId === r.repId);
                    return (
                      <tr key={r.repId} className={blocked ? "bg-amber-50/50" : ""}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{r.name}</div>
                          <div className="text-xs text-gray-500">{r.code}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{r.activeStores}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {r.timesReminded === 0 ? (
                            <span className="text-gray-400">never</span>
                          ) : (
                            <>
                              {r.timesReminded}&times;
                              <span className="text-xs text-gray-500"> · last {whenText(r.lastRemindedAt)}</span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {r.managerEmail ? r.managerName || r.teamName : <span className="text-gray-400">nobody on file</span>}
                        </td>
                        <td className="px-3 py-2">
                          {blocked ? (
                            <span className="text-amber-700">{BLOCK_LABEL[blocked.reason]}</span>
                          ) : r.hasAddressWithoutGps ? (
                            <span className="text-gray-500">Address won&apos;t pin on the map</span>
                          ) : (
                            <span className="text-gray-500">Will be emailed</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.teamName ? <span className="text-gray-700">{r.teamName}</span> : <span className="text-gray-400">no team</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {plan.repsWithNoManagerContact > 0 && (
            <p className="text-xs text-amber-700 mb-4">
              {plan.repsWithNoManagerContact} of these reps are not in a team with a manager who has an email address, so they are
              held back. Nobody is chased without their manager being copied on the same run. Teams are set on the{" "}
              <a href="/teams" className="underline">
                Teams page
              </a>
              , and a team with a blank manager email counts as no manager.
            </p>
          )}

          {plan.settled.length > 0 && (
            <p className="text-xs text-gray-600 mb-4">
              <strong>Done since we started asking:</strong> {plan.settled.map((s) => `${s.code} ${s.name}`).join(", ")}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {confirmSend ? (
              <>
                <button
                  onClick={() => run(false)}
                  disabled={busy !== ""}
                  className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark transition-colors disabled:opacity-50"
                >
                  {busy === "send" ? "Sending..." : `Yes, email ${mailableCount} rep${mailableCount === 1 ? "" : "s"} now`}
                </button>
                <button
                  onClick={() => setConfirmSend(false)}
                  disabled={busy !== ""}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmSend(true)}
                disabled={busy !== "" || mailableCount === 0}
                title={mailableCount === 0 ? "There is nobody to email" : "Send this week's reminder now rather than waiting for Monday"}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Send reminders now
              </button>
            )}
            <span className="text-xs text-gray-500">
              {status.schedule}
              {summaryText ? ` · summary to ${summaryText}` : ""}
            </span>
          </div>

          {status.runs.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Last runs</div>
              <div className="space-y-1">
                {status.runs.map((r) => (
                  <div key={r.id} className="text-xs text-gray-600">
                    <span className="text-gray-400">{new Date(r.startedAt).toLocaleString("en-ZA")}</span>{" "}
                    <span className="text-gray-500">({r.trigger})</span>{" "}
                    {r.error ? (
                      <span className="text-red-600">failed: {r.error}</span>
                    ) : r.skippedReason ? (
                      <span className="text-amber-700">skipped: {r.skippedReason}</span>
                    ) : r.dryRun ? (
                      <>preview, {r.outstanding} outstanding, nothing sent</>
                    ) : (
                      <>
                        {r.sent} emailed, {r.managersEmailed} manager{r.managersEmailed === 1 ? "" : "s"} copied
                        {r.failed > 0 ? `, ${r.failed} failed` : ""}
                        {r.settled > 0 ? `, ${r.settled} done since last run` : ""}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: number; tone?: "plain" | "warn" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "warn" ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50"}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${tone === "warn" ? "text-amber-800" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}
