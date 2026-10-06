"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/components/SessionProvider";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";

type Severity = "blocking" | "warning" | "info";

interface HealthIssue {
  id: string;
  title: string;
  severity: Severity;
  count: number;
  summary: string;
  action: string;
  columns: string[];
  rows: (string | number)[][];
  truncated?: boolean;
}

interface Report {
  checkedAt: string;
  totals: {
    stores: number;
    reps: number;
    channels: number;
    issueTypes: number;
    blocking: number;
    storesBlocked: number;
    storesClosed: number;
    storesNotCalledOn: number;
  };
  issues: HealthIssue[];
}

const TONE: Record<Severity, { chip: string; bar: string; label: string }> = {
  blocking: { chip: "bg-red-100 text-red-700", bar: "bg-red-500", label: "Blocking" },
  warning: { chip: "bg-amber-100 text-amber-800", bar: "bg-amber-400", label: "Warning" },
  info: { chip: "bg-gray-100 text-gray-600", bar: "bg-gray-300", label: "Info" },
};

/**
 * One issue's rows.
 *
 * Its own component because each issue declares its own columns, so each needs
 * its own sort state — a single hook at page level would make every table on the
 * page jump when one header was clicked.
 *
 * Rows are positional arrays, so a column sorts on its INDEX.
 */
function IssueTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  const sort = useTableSort("0", "asc");
  const accessors = Object.fromEntries(
    columns.map((_, i) => [String(i), (row: (string | number)[]) => row[i] ?? null])
  );
  const sorted = useSortedRows(rows, accessors, sort);

  return (
    <table className="w-full text-xs">
      <thead className="bg-gray-50 text-left">
        <tr className="text-[10px] uppercase tracking-wide text-gray-500">
          {columns.map((c, i) => (
            <SortableTh key={c} sortId={String(i)} sort={sort} className="px-3 py-2 font-medium whitespace-nowrap">
              {c}
            </SortableTh>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sorted.map((row, i) => (
          <tr key={i} className="hover:bg-gray-50">
            {row.map((cell, j) => (
              <td key={j} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                {cell === "" ? <span className="text-gray-300">-</span> : String(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "bad" | "good" }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-600" : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function DataHealthPage() {
  const { can } = useSession();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showClean, setShowClean] = useState(false);

  useEffect(() => {
    fetch("/api/data-health")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Could not run the health checks."}
        </div>
      </div>
    );
  }

  const found = data.issues.filter((i) => i.count > 0);
  const clean = data.issues.filter((i) => i.count === 0);
  const t = data.totals;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Data Health</h1>
          <p className="text-sm text-gray-500">
            Every data problem that stops or skews a route, in one place. Checked{" "}
            {new Date(data.checkedAt).toLocaleString("en-ZA")}.
          </p>
        </div>
        {can("export_data") && (
          <a
            href="/api/data-health/export"
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg bg-iram-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-iram-green-dark"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export all issues
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Checks run" value={data.issues.length} />
        <Stat label="Found something" value={found.length} tone={found.length > 0 ? "bad" : "good"} />
        <Stat
          label="Records blocked"
          value={t.blocking.toLocaleString()}
          tone={t.blocking > 0 ? "bad" : "good"}
        />
        <Stat
          label="Stores affected"
          value={`${t.storesBlocked.toLocaleString()} of ${t.stores.toLocaleString()}`}
          tone={t.storesBlocked > 0 ? "bad" : "good"}
        />
      </div>

      {(t.storesClosed > 0 || t.storesNotCalledOn > 0) && (
        <p className="-mt-3 mb-6 text-xs text-gray-500">
          Every check below runs on the <strong>{t.stores.toLocaleString()}</strong> stores reps
          actually call on.{" "}
          {t.storesClosed > 0 && (
            <>
              <strong>{t.storesClosed.toLocaleString()}</strong> closed stores are excluded, because a
              shop that is never routed cannot have a routing problem. Reopen one and it returns to
              these checks.{" "}
            </>
          )}
          {t.storesNotCalledOn > 0 && (
            <>
              A further <strong>{t.storesNotCalledOn.toLocaleString()}</strong> sit in channels marked
              channels switched to <em>not called on</em> and are excluded for the same reason: a missing
              coordinate on a store nobody visits is not a problem to fix. Switch that channel back on
              (Channels page, Called on?) and they all return.
            </>
          )}
        </p>
      )}

      {found.length === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 mb-6">
          <p className="text-sm font-semibold text-green-800">Nothing to fix.</p>
          <p className="mt-1 text-xs text-green-700">
            All {data.issues.length} checks came back clean.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {found.map((issue) => {
          const tone = TONE[issue.severity];
          const isOpen = open.has(issue.id);
          return (
            <div key={issue.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => toggle(issue.id)}
                className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors"
              >
                <span className={`mt-1 h-8 w-1 flex-shrink-0 rounded ${tone.bar}`} />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{issue.title}</span>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone.chip}`}>
                      {tone.label}
                    </span>
                    <span className="text-sm font-bold text-gray-900">{issue.count.toLocaleString()}</span>
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">{issue.summary}</span>
                </span>
                <svg
                  className={`mt-1 h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100">
                  <p className="px-4 py-2.5 text-xs text-gray-700 bg-amber-50">
                    <strong className="font-semibold">What to do: </strong>
                    {issue.action}
                  </p>
                  <div className="overflow-x-auto">
                    <IssueTable columns={issue.columns} rows={issue.rows} />
                  </div>
                  {issue.truncated && (
                    <p className="px-4 py-2 text-[11px] text-gray-500 bg-gray-50">
                      Sorting orders these rows only. Showing the first {issue.rows.length} of{" "}
                      {issue.count.toLocaleString()}. The export has every one.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* A clean check has to be visible, or "not on the report" and "nothing
          found" look identical and a check that silently stopped running is
          indistinguishable from a pass. */}
      {clean.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowClean(!showClean)}
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            {showClean ? "Hide" : "Show"} the {clean.length} check{clean.length === 1 ? "" : "s"} that came back clean
          </button>
          {showClean && (
            <ul className="mt-2 space-y-1">
              {clean.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-xs text-gray-500">
                  <svg className="h-3.5 w-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {i.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
