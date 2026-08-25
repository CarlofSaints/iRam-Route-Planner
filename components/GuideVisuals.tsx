"use client";

/**
 * The pictures in the guide.
 *
 * Deliberately drawn here rather than shipped as images: they stay sharp at any
 * zoom, they print properly, they carry real selectable text, and when the app
 * changes they are edited in one place instead of being re-exported from a
 * design tool nobody can find.
 *
 * Every one of them is built from plain elements and inline SVG, so nothing here
 * depends on a chart library and nothing breaks in a print stylesheet.
 */

const GREEN = "#7CC042";
const INK = "#32373C";
const GREY = "#6B7280";
const LINE = "#E5E7EB";

/* ─────────────────────────────────────────────────────────────────────────
   The chronology: what to do, in order, first time through.
   ───────────────────────────────────────────────────────────────────────── */

const FLOW_STEPS = [
  {
    n: 1,
    title: "Set your channels",
    where: "Control Centre → Channels",
    what: "How often each type of store is visited, and for how long.",
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  },
  {
    n: 2,
    title: "Load your reps",
    where: "Reps → Import Excel",
    what: "Rep codes and names. Email addresses if they will have logins.",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    n: 3,
    title: "Load your stores",
    where: "Control Centre → Store Upload",
    what: "Each store carries its rep code, its channel and its coordinates.",
    icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z",
  },
  {
    n: 4,
    title: "Check the data",
    where: "Control Centre → Data Health",
    what: "Clear the blocking items. They are the records that cannot be planned.",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    n: 5,
    title: "Capture home addresses",
    where: "Reps, or the rep's own profile",
    what: "So each day starts at the rep's door, not the middle of their stores.",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    n: 6,
    title: "Generate the routes",
    where: "Routes → Generate Routes",
    what: "The four-week cycle is built and saved.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    accent: true,
  },
  {
    n: 7,
    title: "Read the plan",
    where: "Routes · Map · Rep Capacity",
    what: "Check the workload is realistic before anyone drives it.",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  {
    n: 8,
    title: "Send it to Repsly",
    where: "Routes → Repsly export",
    what: "The cycle becomes dated visits on the calendar.",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
];

export function FlowTimeline() {
  return (
    <div className="guide-flow">
      <ol className="relative">
        {FLOW_STEPS.map((s, i) => (
          <li key={s.n} className="relative flex gap-4 pb-5 last:pb-0 break-inside-avoid">
            {/* the spine */}
            {i < FLOW_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[19px] top-10 bottom-0 w-px"
                style={{ background: LINE }}
              />
            )}
            <span
              className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white"
              style={{ borderColor: s.accent ? GREEN : LINE }}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke={s.accent ? GREEN : GREY}
                strokeWidth={1.7}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
              </svg>
              <span
                className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: s.accent ? GREEN : INK }}
              >
                {s.n}
              </span>
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-semibold" style={{ color: INK }}>
                {s.title}
              </p>
              <p className="text-[11px] font-medium" style={{ color: GREEN }}>
                {s.where}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: GREY }}>
                {s.what}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {/* The loop is the part people miss, so it is drawn, not just written. */}
      <div
        className="mt-4 flex items-start gap-3 rounded-lg border p-3 break-inside-avoid"
        style={{ borderColor: "#e8f5d9", background: "#f3fae9" }}
      >
        <svg className="mt-0.5 h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke={GREEN} strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <p className="text-xs" style={{ color: INK }}>
          <strong className="font-semibold">Anything changes after this, go back to step 6.</strong> A new rep, a
          corrected coordinate, a different call frequency: the saved plan does not know about any of it until you
          generate again.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   What the system is made of, and what feeds what.
   ───────────────────────────────────────────────────────────────────────── */

export function DataModel() {
  const box = (x: number, y: number, w: number, h: number, fill: string, stroke: string) => (
    <rect x={x} y={y} width={w} height={h} rx="8" fill={fill} stroke={stroke} strokeWidth="1.5" />
  );

  return (
    <svg viewBox="0 0 620 300" className="w-full" role="img" aria-label="Channels and reps feed stores, which produce the route plan">
      <defs>
        <marker id="gm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill={GREY} />
        </marker>
        <marker id="gm-arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill={GREEN} />
        </marker>
      </defs>

      {/* CHANNELS */}
      {box(10, 20, 160, 70, "#F9FAFB", LINE)}
      <text x="90" y="45" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>CHANNELS</text>
      <text x="90" y="63" textAnchor="middle" fontSize="10.5" fill={GREY}>How often · how long</text>
      <text x="90" y="78" textAnchor="middle" fontSize="10.5" fill={GREY}>e.g. Spar, weekly, 90 min</text>

      {/* REPS */}
      {box(10, 190, 160, 70, "#F9FAFB", LINE)}
      <text x="90" y="215" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>REPS</text>
      <text x="90" y="233" textAnchor="middle" fontSize="10.5" fill={GREY}>Rep code · name</text>
      <text x="90" y="248" textAnchor="middle" fontSize="10.5" fill={GREY}>home address</text>

      {/* STORES */}
      {box(235, 95, 175, 110, "#f3fae9", "#e8f5d9")}
      <text x="322" y="122" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>STORES</text>
      <text x="322" y="142" textAnchor="middle" fontSize="10.5" fill={GREY}>Place ID · name</text>
      <text x="322" y="157" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={GREEN}>rep code</text>
      <text x="322" y="172" textAnchor="middle" fontSize="10.5" fill={GREY}>channel</text>
      <text x="322" y="187" textAnchor="middle" fontSize="10.5" fill={GREY}>coordinates</text>

      {/* ROUTE PLAN */}
      {box(465, 95, 145, 110, "#F9FAFB", LINE)}
      <text x="537" y="122" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>ROUTE PLAN</text>
      <text x="537" y="142" textAnchor="middle" fontSize="10.5" fill={GREY}>4 weeks × 5 days</text>
      <text x="537" y="157" textAnchor="middle" fontSize="10.5" fill={GREY}>per rep</text>
      <text x="537" y="177" textAnchor="middle" fontSize="10" fontStyle="italic" fill={GREY}>saved, not live</text>

      {/* arrows in */}
      <path d="M170 60 C205 60 205 120 232 128" fill="none" stroke={GREY} strokeWidth="1.5" markerEnd="url(#gm-arrow)" />
      <text x="196" y="88" fontSize="9.5" fill={GREY}>gives its</text>
      <text x="196" y="99" fontSize="9.5" fill={GREY}>rhythm to</text>

      <path d="M170 224 C205 224 205 178 232 172" fill="none" stroke={GREEN} strokeWidth="2" markerEnd="url(#gm-arrow-red)" />
      <text x="188" y="205" fontSize="9.5" fontWeight="700" fill={GREEN}>matched by</text>
      <text x="188" y="216" fontSize="9.5" fontWeight="700" fill={GREEN}>rep code</text>

      {/* arrow out */}
      <path d="M412 150 L460 150" fill="none" stroke={GREY} strokeWidth="1.5" markerEnd="url(#gm-arrow)" />
      <text x="436" y="142" textAnchor="middle" fontSize="9.5" fill={GREY}>generate</text>

      {/* the note that matters */}
      <text x="322" y="238" textAnchor="middle" fontSize="10" fontWeight="600" fill={GREEN}>
        The rep code on the store IS the allocation.
      </text>
      <text x="322" y="252" textAnchor="middle" fontSize="10" fill={GREY}>
        There is no separate allocation screen.
      </text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   The two ways stores get in, and what each one overwrites.
   ───────────────────────────────────────────────────────────────────────── */

export function TwoDoors() {
  const Door = ({
    title,
    where,
    use,
    rows,
    tone,
  }: {
    title: string;
    where: string;
    use: string;
    rows: { label: string; yes: boolean; text: string }[];
    tone: "red" | "grey";
  }) => (
    <div
      className="flex-1 rounded-lg border p-4 break-inside-avoid"
      style={{ borderColor: tone === "red" ? "#e8f5d9" : LINE, background: tone === "red" ? "#f3fae9" : "#F9FAFB" }}
    >
      <p className="text-sm font-bold" style={{ color: INK }}>{title}</p>
      <p className="text-[11px] font-medium" style={{ color: tone === "red" ? GREEN : GREY }}>{where}</p>
      <p className="mt-2 text-xs" style={{ color: GREY }}>{use}</p>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2 text-xs">
            <svg
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke={r.yes ? GREEN : "#16A34A"}
              strokeWidth={2.5}
              aria-hidden="true"
            >
              {r.yes ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0l-7.1 12.25A2 2 0 004.99 19z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              )}
            </svg>
            <span style={{ color: INK }}>
              <strong className="font-semibold">{r.label}</strong> {r.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Door
        tone="red"
        title="Store Upload"
        where="Control Centre → Store Upload"
        use="The full picture. Use it to add new stores, or to load the store list for the first time."
        rows={[
          { label: "Adds new stores.", yes: false, text: "" },
          { label: "Rewrites the rep on every row it touches.", yes: true, text: "A missing column writes a blank." },
          { label: "Rewrites the monthly average too.", yes: true, text: "Same again." },
        ]}
      />
      <Door
        tone="grey"
        title="Import Excel"
        where="Stores → Import Excel"
        use="Corrections only. Use it to fix details on stores that already exist, such as coordinates."
        rows={[
          { label: "Never touches the rep allocation.", yes: false, text: "" },
          { label: "Never touches the monthly average.", yes: false, text: "" },
          { label: "Only updates the columns your file carries.", yes: false, text: "Unknown Place IDs are reported, not created." },
        ]}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   What "a four-week cycle" actually looks like.
   ───────────────────────────────────────────────────────────────────────── */

export function CycleGrid() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const weeks = ["Week 1", "Week 2", "Week 3", "Week 4"];
  return (
    <div className="break-inside-avoid">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-[11px]">
          <thead>
            <tr>
              <th className="w-16" />
              {days.map((d) => (
                <th key={d} className="px-2 py-1 font-semibold" style={{ color: GREY }}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, wi) => (
              <tr key={w}>
                <th className="pr-2 text-right font-semibold" style={{ color: GREY }}>
                  {w}
                </th>
                {days.map((d) => (
                  <td key={d} className="p-1">
                    <div
                      className="rounded border px-1 py-2"
                      style={{
                        borderColor: LINE,
                        background: wi === 0 ? "#f3fae9" : "#F9FAFB",
                      }}
                    >
                      <span className="block text-[10px] font-semibold" style={{ color: INK }}>
                        {8 + ((wi + d.length) % 5)} stops
                      </span>
                      <span className="block text-[9px]" style={{ color: GREY }}>
                        one area
                      </span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs" style={{ color: GREY }}>
        Every rep gets twenty working days. A monthly store appears once somewhere in the grid; a weekly store appears
        on the same day in all four weeks. Each day is one cluster of stores, ordered so the driving between them is as
        short as possible.
      </p>
    </div>
  );
}

export function GuideDiagram({ id }: { id: "flow" | "model" | "doors" | "cycle" }) {
  if (id === "flow") return <FlowTimeline />;
  if (id === "model") return <DataModel />;
  if (id === "doors") return <TwoDoors />;
  return <CycleGrid />;
}
