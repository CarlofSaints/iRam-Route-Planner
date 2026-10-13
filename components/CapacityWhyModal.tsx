"use client";

import { useEffect, useState } from "react";
import { FAR_HOME_KM, type CapacityExplanation } from "@/lib/capacityExplain";

/**
 * "Tell me why" for one row of the Capacity grid: the sum behind the
 * percentage, the causes in order of how much they explain, and click steps
 * to fix each. Every line is computed from the plan and the stores; nothing
 * here is a guess.
 */
export default function CapacityWhyModal({ repCode, onClose }: { repCode: string; onClose: () => void }) {
  const [data, setData] = useState<CapacityExplanation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reps/capacity/explain?repCode=${encodeURIComponent(repCode)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError(body.error || `Could not load the explanation (${r.status})`);
        else setData(body);
      })
      .catch(() => !cancelled && setError("Could not reach the server. Check the connection and try again."));
    return () => {
      cancelled = true;
    };
  }, [repCode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const m = data?.maths;
  const pct = m ? Math.round(m.utilization * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Why this capacity figure"
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">
              Why {data?.repName ?? repCode}
              {m && data?.hasRoute ? ` is at ${pct}%` : ""}
            </h2>
            {data?.generatedAt && (
              <p className="text-xs text-gray-500 mt-0.5">
                From the route plan generated {new Date(data.generatedAt).toLocaleString("en-ZA")}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1" title="Close">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-6 text-sm">
          {error && <div className="p-3 rounded-lg bg-red-50 text-red-700">{error}</div>}
          {!data && !error && (
            <div className="flex justify-center py-10">
              <div className="animate-spin w-6 h-6 border-2 border-iram-green border-t-transparent rounded-full" />
            </div>
          )}

          {data && m && (
            <>
              {!data.hasRoute ? (
                <p className="text-gray-600">
                  This rep has no generated route, so there is no utilisation to explain yet. Generate routes on the
                  Routes page first.
                </p>
              ) : (
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
                    The sum, per month <span className="normal-case tracking-normal">(one 4-week cycle, {m.workingDays} working days)</span>
                  </h3>
                  <table className="w-full max-w-md text-sm">
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="py-1.5 text-gray-600">In-store time scheduled this month</td>
                        <td className="py-1.5 text-right font-mono">{m.visitHours.toFixed(1)}h</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-gray-600">Driving this month</td>
                        <td className={`py-1.5 text-right font-mono ${m.travelHours > m.visitHours ? "font-semibold text-red-700" : ""}`}>
                          {m.travelHours.toFixed(1)}h
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-medium text-gray-800">Total for the month</td>
                        <td className="py-1.5 text-right font-mono font-medium">{m.scheduledHours.toFixed(1)}h</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-gray-600">
                          Available this month ({m.workingHoursPerDay}h &times; {m.workingDays} days)
                        </td>
                        <td className="py-1.5 text-right font-mono">{m.availableHours.toFixed(0)}h</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-gray-700">
                    {m.scheduledHours.toFixed(1)} &divide; {m.availableHours.toFixed(0)} ={" "}
                    <span className={`font-semibold ${pct > 100 ? "text-red-700" : "text-gray-900"}`}>{pct}%</span>.
                  </p>
                </section>
              )}

              {/* The grid counts the ROUTE; the red "stores need Nx their
                  hours" warning counts the STORES. This is the bridge, so the
                  two numbers never look like they contradict each other. */}
              {data.hasRoute && data.route && (
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
                    What the stores ask for vs what is on the route, per month
                  </h3>
                  <table className="w-full max-w-xl text-sm">
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="py-1.5 text-gray-600">
                          Visits the stores ask for <span className="text-gray-400">(frequency &times; visit length)</span>
                        </td>
                        <td className={`py-1.5 text-right font-mono ${data.route.bookVisitHours > m.availableHours ? "font-semibold text-red-700" : ""}`}>
                          {data.route.bookVisitHours.toFixed(1)}h
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-gray-600">Visits on the route <span className="text-gray-400">(what the % above counts)</span></td>
                        <td className="py-1.5 text-right font-mono">{data.route.routedVisitHours.toFixed(1)}h</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-medium text-gray-800">
                          Not on the route ({data.route.gapVisits} visit{data.route.gapVisits === 1 ? "" : "s"})
                        </td>
                        <td className={`py-1.5 text-right font-mono font-medium ${data.route.gapHours > 0 ? "text-amber-700" : ""}`}>
                          {data.route.gapHours.toFixed(1)}h
                        </td>
                      </tr>
                      {data.route.byReason.map((g) => (
                        <tr key={g.reason}>
                          <td className="py-1 pl-4 text-xs text-gray-600">
                            {g.reason}: {g.visits} visit{g.visits === 1 ? "" : "s"}
                            <span className="block text-gray-400">{g.stores.join(", ")}</span>
                          </td>
                          <td className="py-1 text-right font-mono text-xs text-amber-700">{g.hours.toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.route.gapHours > 0 && (
                    <p className="mt-2 text-gray-700">
                      The percentage only counts what is on the route. With every visit on it, this rep would need{" "}
                      <span className="font-semibold">
                        {Math.round(((m.scheduledHours + data.route.gapHours) / m.availableHours) * 100)}%
                      </span>{" "}
                      of their hours, before any extra driving.
                    </p>
                  )}
                </section>
              )}

              <section>
                <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
                  {data.causes.length ? "What is causing it" : "Nothing stands out"}
                </h3>
                {data.causes.length === 0 && (
                  <p className="text-gray-600">
                    No single cause explains this figure: the start point is near the stores, the visits fit the hours
                    and no visit was left unscheduled.
                  </p>
                )}
                <ol className="space-y-3">
                  {data.causes.map((c, i) => (
                    <li key={c.kind} className={`rounded-lg border p-3 ${i === 0 ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
                      <p className={`font-semibold ${i === 0 ? "text-red-800" : "text-gray-800"}`}>{c.title}</p>
                      <p className="mt-1 text-gray-700">{c.detail}</p>
                      {c.fix.length > 0 && (
                        <ol className="mt-2 list-decimal pl-5 space-y-0.5 text-gray-700">
                          {c.fix.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ol>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              {data.stores.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
                    Stores, farthest from the day&apos;s start first
                    {data.start.medianKmToStores !== null && (
                      <span className="normal-case tracking-normal"> · typical distance {data.start.medianKmToStores.toLocaleString()} km</span>
                    )}
                  </h3>
                  <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left">Store</th>
                          <th className="px-3 py-2 text-right">From start</th>
                          <th className="px-3 py-2 text-left">Frequency</th>
                          <th className="px-3 py-2 text-right">Visit</th>
                          <th className="px-3 py-2 text-right">Hours/mo</th>
                          <th className="px-3 py-2 text-right">On route</th>
                          <th className="px-3 py-2 text-left">Not on route</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.stores.map((s) => (
                          <tr key={s.storeId}>
                            <td className="px-3 py-1.5 text-gray-800">{s.storeName}</td>
                            <td className={`px-3 py-1.5 text-right font-mono ${s.kmFromStart !== null && s.kmFromStart > FAR_HOME_KM ? "text-red-700 font-semibold" : ""}`}>
                              {s.kmFromStart === null ? <span className="text-gray-300">no GPS</span> : `${s.kmFromStart.toLocaleString()} km`}
                            </td>
                            <td className="px-3 py-1.5 text-gray-600">{s.frequency}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{s.durationMin} min</td>
                            <td className="px-3 py-1.5 text-right font-mono text-gray-600">{s.hoursPerMonth}h</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">
                              {s.scheduled} of {Math.round(s.callsPerMonth)}
                            </td>
                            <td className="px-3 py-1.5 text-amber-700">
                              {s.notOnRoute > 0 ? `${s.notOnRoute}: ${s.notOnRouteReason}` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {data.days.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Day by day, all {data.days.length} working days of the month</h3>
                  <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left">Day</th>
                          <th className="px-3 py-2 text-right">Calls</th>
                          <th className="px-3 py-2 text-right">In store</th>
                          <th className="px-3 py-2 text-right">Driving</th>
                          <th className="px-3 py-2 text-right">Distance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.days.map((d) => (
                          <tr key={`${d.week}-${d.day}`} className={d.overCapacity ? "bg-red-50/60" : ""}>
                            <td className="px-3 py-1.5 text-gray-700">
                              {d.week} {d.day}
                              {d.overCapacity && <span className="ml-1 text-red-700 font-medium">over</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right">{d.stops}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{(d.visitMin / 60).toFixed(1)}h</td>
                            <td className={`px-3 py-1.5 text-right font-mono ${d.driveMin > d.visitMin ? "text-red-700" : ""}`}>
                              {(d.driveMin / 60).toFixed(1)}h
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{d.driveKm.toLocaleString()} km</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
