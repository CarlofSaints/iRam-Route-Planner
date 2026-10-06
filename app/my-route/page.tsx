"use client";

/**
 * A rep's own four-week call cycle, one day at a time.
 *
 * Read-only by design. Reps cannot plan or regenerate routes, and they are
 * kept out of /routes and /map because the data behind those pages is the
 * whole business. Everything here comes from /api/my-route, which only ever
 * returns the signed-in rep's own plan.
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { MyDay, MyPlan, MyStore } from "@/lib/myRoute";
import { guessCycleDay } from "@/lib/cycleWeek";

const MyRouteMap = dynamic(() => import("@/components/MyRouteMap"), { ssr: false });

const WEEKS = ["Wk1", "Wk2", "Wk3", "Wk4"] as const;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

interface MyRouteResponse {
  rep: { code: string; name: string; hasHome: boolean; roleName: string } | null;
  generatedAt: string | null;
  plans: MyPlan[];
  stores: MyStore[];
  error?: string;
}

function fmtMinutes(m: number): string {
  const total = Math.round(m);
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (h === 0) return `${min} min`;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

const at = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;

/** Directions to one shop from wherever the rep is standing. Always works on a phone. */
function directionsTo(p: { lat: number; lng: number }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${at(p)}&travelmode=driving`;
}

/**
 * The whole day in Google Maps, home to home. Google caps the waypoints a link
 * can carry, so a day longer than that opens with the first calls only and the
 * per-stop links below cover the rest.
 */
const MAX_WAYPOINTS = 9;
function directionsForDay(home: { lat: number; lng: number } | null, day: MyDay) {
  const stops = day.stops;
  if (stops.length === 0) return null;
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  if (home) {
    params.set("origin", at(home));
    params.set("destination", at(home));
    params.set("waypoints", stops.slice(0, MAX_WAYPOINTS).map(at).join("|"));
  } else {
    // No home: start from where they are, end at the last call.
    const last = stops[Math.min(stops.length, MAX_WAYPOINTS + 1) - 1];
    params.set("destination", at(last));
    const wp = stops.slice(0, Math.min(stops.length, MAX_WAYPOINTS + 1) - 1).map(at);
    if (wp.length) params.set("waypoints", wp.join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export default function MyRoutePage() {
  const [data, setData] = useState<MyRouteResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  // A calendar guess, said to be one on screen; see lib/cycleWeek.ts.
  const [guess] = useState(() => guessCycleDay(new Date()));
  const [week, setWeek] = useState<(typeof WEEKS)[number]>(guess.week);
  const [day, setDay] = useState<(typeof DAYS)[number]>(guess.day);
  const [planIdx, setPlanIdx] = useState(0);
  const [showStores, setShowStores] = useState(false);

  useEffect(() => {
    fetch("/api/my-route", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load your route");
        setData(d);
      })
      .catch((e) => setLoadError(String(e.message || e)));
  }, []);

  const plan = data?.plans[planIdx] ?? null;
  const home = plan?.homeLatLng ?? null;

  const byKey = useMemo(() => {
    const m = new Map<string, MyDay>();
    for (const d of plan?.days ?? []) m.set(`${d.week}|${d.day}`, d);
    return m;
  }, [plan]);

  const current = byKey.get(`${week}|${day}`) ?? null;
  const dayLink = current ? directionsForDay(home, current) : null;
  const unplanned = (data?.stores ?? []).filter((s) => !s.planned).length;

  if (loadError) {
    return <div className="p-6 text-sm text-red-600">{loadError}</div>;
  }
  if (!data) {
    return <div className="p-6 text-sm text-gray-500">Loading your route...</div>;
  }
  if (!data.rep) {
    return (
      <div className="p-6 text-sm text-gray-600">
        This login isn&apos;t linked to a rep, so there is no route to show.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">My Route</h1>
        <p className="text-xs text-gray-500">
          Your four-week call cycle.
          {data.generatedAt &&
            ` Planned ${new Date(data.generatedAt).toLocaleDateString("en-ZA", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}.`}
        </p>
      </div>

      {!data.rep.hasHome && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong className="font-semibold">Your day isn&apos;t starting from home yet.</strong> We don&apos;t
          have your home pinned, so this route starts from the middle of your stores.{" "}
          <Link href="/account" className="font-semibold underline">
            Set your home
          </Link>
          .
        </div>
      )}

      {/* Normally one plan. Shown as a choice only if the book ever holds more
          than one for the same person, e.g. one per visit role. */}
      {data.plans.length > 1 && (
        <div className="flex gap-1 overflow-x-auto">
          {data.plans.map((p, i) => (
            <button
              key={`${p.visitRoleName}-${i}`}
              onClick={() => setPlanIdx(i)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                planIdx === i ? "bg-iram-dark text-white" : "bg-white text-gray-700 border border-gray-200"
              }`}
            >
              Show my {p.visitRoleName} route
            </button>
          ))}
        </div>
      )}

      {!plan ? (
        <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">
          No route has been planned for you yet. Your manager builds the routes; once they do, your
          calls will show here.
        </div>
      ) : (
        <>
          {/* Week, then day. Counts on each day so an empty day is obvious before tapping it. */}
          <div className="space-y-2">
            <div className="flex gap-1 overflow-x-auto">
              {WEEKS.map((w, i) => (
                <button
                  key={w}
                  onClick={() => setWeek(w)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                    week === w ? "bg-iram-dark text-white" : "bg-white text-gray-700 border border-gray-200"
                  }`}
                >
                  Week {i + 1}
                </button>
              ))}
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {DAYS.map((d) => {
                const n = byKey.get(`${week}|${d}`)?.stops.length ?? 0;
                return (
                  <button
                    key={d}
                    onClick={() => setDay(d)}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                      day === d
                        ? "bg-iram-green text-white font-medium"
                        : "bg-white text-gray-700 border border-gray-200"
                    }`}
                  >
                    {d.slice(0, 3)} <span className="opacity-75">({n})</span>
                  </button>
                );
              })}
            </div>
            {/* Said out loud because it IS a guess: nothing records when Week 1
                began. Gone once the rep picks a week themselves. */}
            {week === guess.week && (
              <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                We have assumed it is <strong>week {WEEKS.indexOf(guess.week) + 1}</strong> based on today&apos;s
                date, but we may be wrong. If you want, you can change the week using the buttons above.
              </p>
            )}
          </div>

          {!current || current.stops.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">
              No calls planned for {day}, week {WEEKS.indexOf(week) + 1}.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="Calls" value={String(current.calls)} />
                <Stat
                  label="Day"
                  value={
                    current.leaveHome && current.arriveHome
                      ? `${current.leaveHome} to ${current.arriveHome}`
                      : current.leaveHome
                        ? `From ${current.leaveHome}`
                        : "-"
                  }
                />
                <Stat label="Driving" value={`${Math.round(current.distanceKm)} km`} />
                <Stat label="Time on the road" value={fmtMinutes(current.travelMinutes)} />
              </div>

              {dayLink && (
                <a
                  href={dayLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-iram-green px-4 py-2 text-sm font-medium text-white hover:bg-iram-green-dark"
                >
                  Open the day in Google Maps
                </a>
              )}
              {current.stops.length > MAX_WAYPOINTS && (
                <p className="text-xs text-gray-500">
                  Google Maps takes {MAX_WAYPOINTS} stops at a time, so use the Directions link on each call
                  after that.
                </p>
              )}

              <div className="h-[320px] sm:h-[420px] overflow-hidden rounded-xl border border-gray-100">
                <MyRouteMap
                  home={home}
                  stops={current.stops}
                  polyline={current.polyline}
                  fitKey={`${planIdx}|${week}|${day}`}
                />
              </div>

              <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-100">
                {home && current.leaveHome && <Row title="Leave home" sub={current.leaveHome} />}
                {current.stops.map((s, i) => (
                  <div key={`${s.storeId}-${i}`} className="flex items-center gap-3 p-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-iram-green text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">{s.storeName}</div>
                      <div className="text-xs text-gray-500">
                        {s.arrivalTime} to {s.departureTime} · {Math.round(s.distanceFromPrev)} km,{" "}
                        {fmtMinutes(s.travelTimeFromPrev)} drive
                      </div>
                    </div>
                    <a
                      href={directionsTo(s)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-iram-green hover:bg-gray-50"
                    >
                      Directions
                    </a>
                  </div>
                ))}
                {home && current.returnKm != null && (
                  <Row
                    title="Back home"
                    sub={`${current.arriveHome ?? ""} · ${Math.round(current.returnKm)} km, ${fmtMinutes(
                      current.returnMinutes ?? 0
                    )} drive`}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Every store this person holds a visit role at, sales or otherwise, so
          a QC or training person sees their stores even when the route book
          does not plan them. */}
      {data.stores.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white">
          <button
            onClick={() => setShowStores((v) => !v)}
            className="flex w-full items-center justify-between p-3 text-left text-sm font-medium text-gray-900"
          >
            <span>
              {showStores ? "Hide" : "Show"} all my stores ({data.stores.length})
              {unplanned > 0 && (
                <span className="ml-2 text-xs font-normal text-amber-700">
                  {unplanned} not on this route
                </span>
              )}
            </span>
            <span className="text-gray-400">{showStores ? "−" : "+"}</span>
          </button>
          {showStores && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {data.stores.map((s) => (
                <li key={s.storeId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-900">{s.name}</span>
                  <span className="flex-shrink-0 text-xs text-gray-500">{s.roles.join(", ")}</span>
                  {!s.planned && (
                    <span className="flex-shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                      Not on this route
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
  );
}

function Row({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-iram-dark">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" />
        </svg>
      </span>
      <div>
        <div className="text-sm font-medium text-gray-900">{title}</div>
        <div className="text-xs text-gray-500">{sub}</div>
      </div>
    </div>
  );
}
