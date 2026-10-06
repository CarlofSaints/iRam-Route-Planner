/**
 * The one definition of a time of day on a route.
 *
 * Every stop's arrival and departure is a bare "HH:mm" string, and three places
 * now need to do arithmetic on one — the engine, the map's summary and the
 * Routes day panel. It lives apart from the engine so a browser page can add
 * half an hour to a departure time without pulling the routing engine into its
 * bundle.
 */

/** "08:30" → minutes past midnight. Anything unparseable counts as 0. */
export function parseClock(hhmm: string): number {
  const [h, m] = (hhmm ?? "").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Minutes past midnight → "16:42".
 *
 * Rounded to the minute BEFORE it is split into hours and minutes. Rounding
 * afterwards turns 16:59.6 into "16:60", which is not a time.
 */
export function formatClock(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
