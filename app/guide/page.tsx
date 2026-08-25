"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { GUIDE, GUIDE_VERSION, Block, GuideSection } from "@/lib/guide";
import { GuideDiagram } from "@/components/GuideVisuals";

/**
 * The user guide.
 *
 * One renderer for both screen and paper: "Download PDF" opens the browser's
 * own print dialogue against a print stylesheet, rather than generating a
 * second document server-side. That keeps one source of truth — a separately
 * generated PDF is a copy, and a copy goes stale the first time the app changes.
 */

const TONE = {
  info: { border: "border-gray-200", bg: "bg-gray-50", head: "text-gray-900", body: "text-gray-600", icon: "text-gray-400" },
  good: { border: "border-green-200", bg: "bg-green-50", head: "text-green-900", body: "text-green-800", icon: "text-green-500" },
  warn: { border: "border-amber-200", bg: "bg-amber-50", head: "text-amber-900", body: "text-amber-800", icon: "text-amber-500" },
  danger: { border: "border-red-200", bg: "bg-red-50", head: "text-red-900", body: "text-red-800", icon: "text-iram-green" },
} as const;

const TONE_ICON = {
  info: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  good: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  warn: "M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0l-7.1 12.25A2 2 0 004.99 19z",
  danger: "M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0l-7.1 12.25A2 2 0 004.99 19z",
} as const;

/**
 * A screenshot slot. The image lives at /guide/<slot>.png; if it has not been
 * dropped in yet the slot renders as a labelled placeholder saying what to
 * capture, because a picture that is silently absent is a picture nobody
 * remembers to add.
 */
/**
 * Tries each extension in turn, then gives up and shows the placeholder. Two of
 * them because a screenshot captured from a browser arrives as a JPEG and one
 * exported from a design tool arrives as a PNG, and whoever drops the next one
 * in should not have to know which this file expects. JPEG is first only because
 * that is what everything here currently is: a miss costs a real 404.
 */
const EXTENSIONS = ["jpg", "png"];

/**
 * A screenshot opened full-screen.
 *
 * Guide screenshots are shown at column width, which is fine for "where is that
 * button" and useless for reading a table in one. Clicking opens it as large as
 * the window allows.
 *
 * The overlay itself is the dismiss target, so a click anywhere outside the
 * image closes it, and Escape does too: a full-screen layer with no way out but
 * one small button is the thing people get stuck behind. Page scrolling is
 * frozen while it is open so the page underneath does not slide about, and
 * hidden entirely in print.
 */
function Lightbox({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption}
      onClick={onClose}
      className="guide-hide-print fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* The image must not inherit the overlay's dismiss click: clicking the
          picture you just opened should not close it again. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={caption}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
      />
      <p className="max-w-2xl text-center text-xs text-white/70">{caption}</p>
    </div>
  );
}

function Screenshot({ slot, caption, capture }: { slot: string; caption: string; capture: string }) {
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const missing = attempt >= EXTENSIONS.length;
  const imgRef = useRef<HTMLImageElement>(null);
  const src = `/guide/${slot}.${EXTENSIONS[Math.min(attempt, EXTENSIONS.length - 1)]}`;

  /**
   * onError alone is not enough. The markup is server-rendered, so the browser
   * starts fetching the image while the HTML is still parsing and can finish
   * failing BEFORE React attaches its handler. The error is then never
   * delivered, the fallback never runs, and the reader is left looking at a
   * broken-image icon. This catches that case on mount: an <img> that has
   * finished loading but has no intrinsic width did not load at all.
   */
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setAttempt((a) => a + 1);
    }
  }, [attempt]);

  if (missing) {
    return (
      <figure className="my-5 break-inside-avoid">
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <svg className="mx-auto h-7 w-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 9.75h.008v.008H18V9.75zM2.25 6h19.5v12H2.25V6z" />
          </svg>
          <p className="mt-2 text-sm font-medium text-gray-500">{caption}</p>
          <p className="mt-1 text-xs text-gray-400">Screenshot to capture: {capture}</p>
          <p className="mt-2 text-[11px] font-mono text-gray-400">public/guide/{slot}.png or .jpg</p>
        </div>
      </figure>
    );
  }

  return (
    <figure className="my-5 break-inside-avoid">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge: ${caption}`}
        className="guide-shot group relative block w-full overflow-hidden rounded-lg border border-gray-200 shadow-sm transition-shadow hover:shadow-md"
      >
        {/* A plain img, not next/image: the file may not exist, and this needs
            an onError to fall through to the placeholder above. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={EXTENSIONS[attempt]}
          ref={imgRef}
          src={src}
          alt={caption}
          onError={() => setAttempt((a) => a + 1)}
          className="block w-full"
        />
        {/* Nothing here says "clickable" on its own, so the hint has to. It is
            hidden in print, where there is nothing to click. */}
        <span className="guide-hide-print pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14zM11 8v6M8 11h6" />
          </svg>
          Click to enlarge
        </span>
      </button>
      <figcaption className="mt-2 text-xs text-gray-500">{caption}</figcaption>
      {open && <Lightbox src={src} caption={caption} onClose={() => setOpen(false)} />}
    </figure>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "lead":
      return <p className="mb-4 text-base leading-relaxed text-gray-800">{block.text}</p>;

    case "text":
      return <p className="mb-4 text-sm leading-relaxed text-gray-700">{block.text}</p>;

    case "where":
      return (
        <p className="mb-4 inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 text-xs">
          <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="font-semibold text-gray-900">{block.path}</span>
          <span className="text-gray-500">{block.text}</span>
        </p>
      );

    case "steps":
      return (
        <ol className="mb-5 space-y-3">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 break-inside-avoid">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-iram-green text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-medium text-gray-900">{item.do}</p>
                {item.detail && <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{item.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      );

    case "bullets":
      return (
        <ul className="mb-5 space-y-1.5">
          {block.items.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-iram-green" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      );

    case "note": {
      const tone = TONE[block.tone];
      return (
        <div className={`mb-5 flex gap-3 rounded-lg border p-3.5 break-inside-avoid ${tone.border} ${tone.bg}`}>
          <svg className={`mt-0.5 h-5 w-5 flex-shrink-0 ${tone.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d={TONE_ICON[block.tone]} />
          </svg>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${tone.head}`}>{block.title}</p>
            <p className={`mt-1 text-xs leading-relaxed ${tone.body}`}>{block.text}</p>
          </div>
        </div>
      );
    }

    case "table":
      return (
        <figure className="mb-5 break-inside-avoid">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {block.head.map((h) => (
                    <th key={h} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={`px-3 py-2 align-top text-xs ${j === 0 ? "font-medium text-gray-900" : "text-gray-600"}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && <figcaption className="mt-1.5 text-xs text-gray-500">{block.caption}</figcaption>}
        </figure>
      );

    case "shot":
      return <Screenshot slot={block.slot} caption={block.caption} capture={block.capture} />;

    case "diagram":
      return (
        <figure className="my-5 rounded-lg border border-gray-200 bg-white p-4 break-inside-avoid">
          <GuideDiagram id={block.id} />
          <figcaption className="mt-3 text-xs text-gray-500">{block.caption}</figcaption>
        </figure>
      );
  }
}

function SectionView({ section }: { section: GuideSection }) {
  return (
    <section id={section.id} className="guide-section scroll-mt-6">
      <div className="mb-4 flex items-start gap-3 border-b border-gray-200 pb-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-iram-green/10">
          <svg className="h-5 w-5 text-iram-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d={section.icon} />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-iram-green">Section {section.number}</p>
          <h2 className="text-lg font-bold leading-tight text-gray-900">{section.title}</h2>
          <p className="text-xs text-gray-500">{section.blurb}</p>
        </div>
      </div>
      {section.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </section>
  );
}

export default function GuidePage() {
  return (
    <div className="guide-root mx-auto max-w-4xl p-6">
      {/* Cover */}
      <header className="guide-cover mb-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Image src="/iram-logo.png" alt="iRam" width={150} height={50} className="h-11 w-auto" priority />
          <button
            onClick={() => window.print()}
            className="guide-hide-print inline-flex items-center gap-2 rounded-lg bg-iram-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-iram-green-dark"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Download PDF
          </button>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Route Planner: the complete guide</h1>
        <p className="mt-1 text-sm text-gray-600">
          How to load your data, build a call cycle, and keep it current. Written for the person who runs it, start to
          finish.
        </p>
        <p className="mt-3 text-xs text-gray-400">
          Version {GUIDE_VERSION} · iRam Route Planner · Powered by OuterJoin
        </p>
        <p className="guide-hide-screen mt-2 text-xs text-gray-500">
          Tip: in the print dialogue, choose Save as PDF and switch background graphics on so the diagrams keep their
          colour.
        </p>
      </header>

      {/* Contents */}
      <nav className="guide-toc mb-8 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">Contents</p>
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {GUIDE.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex items-center gap-2.5 rounded px-1.5 py-1 text-sm text-gray-700 hover:bg-white hover:text-iram-green">
                <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                </svg>
                <span className="w-4 flex-shrink-0 text-xs font-semibold text-gray-400">{s.number}</span>
                <span className="min-w-0 truncate">{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-10">
        {GUIDE.map((s) => (
          <SectionView key={s.id} section={s} />
        ))}
      </div>

      <footer className="mt-12 border-t border-gray-200 pt-4 text-center text-xs text-gray-400">
        iRam Route Planner · Guide version {GUIDE_VERSION} · Powered by OuterJoin
      </footer>
    </div>
  );
}
