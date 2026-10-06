"use client";

/**
 * Typing a store's coordinate, with the labels said out loud.
 *
 * What was here before was two boxes whose only labelling was a placeholder —
 * "lat e.g. -26.1" — and a placeholder disappears the moment you type into it.
 * Somebody a minute later is looking at two identical boxes holding two numbers
 * with no way to tell which is which.
 *
 * So: persistent labels, the South African rule stated where it is needed, live
 * validation, and a one-click fix when the pair looks swapped. A wrong
 * coordinate is worse than a missing one — a missing one is reported as
 * missing, while a wrong one silently sends a rep to the wrong place and the
 * router plans a day around it.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import { checkCoordinate, splitPastedPair, SA_LAT, SA_LNG } from "@/lib/saCoordinates";
import type { NearbyStore } from "./PinDropMap";

/** lib/saCoordinates is shared byte-for-byte with Clippa; keep its long dashes off screen. */
const plainDash = (text: string) => text.replace(/\s*—\s*/g, ": ");

// Leaflet touches `window` on import, so the picker must never be part of the
// server render — the same reason the main map is loaded this way.
const PinDropMap = dynamic(() => import("./PinDropMap"), { ssr: false });

interface Props {
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string) => void;
  /**
   * Called with the VALIDATED numbers. Save these, not the box text: the check
   * cleans what was typed ("- 26.1" reads as -26.1), so the raw text can pass
   * here and still be unparseable everywhere else once stored.
   */
  onSave: (lat: number, lng: number) => void;
  saving?: boolean;
  /** Save is unavailable for now (another row is saving), without saying "Saving...". */
  locked?: boolean;
  /** Shown above the boxes, e.g. the store name. */
  label?: string;
  compact?: boolean;
  /** Enables "Drop a pin" — without a name and some context there is no map worth opening. */
  storeName?: string;
  /** The rep's other placed stores, for centring the picker and for context. */
  nearby?: NearbyStore[];
}

export function CoordinateEntry({
  lat,
  lng,
  onChange,
  onSave,
  saving,
  locked,
  label,
  compact,
  storeName,
  nearby,
}: Props) {
  const [touched, setTouched] = useState(false);
  const [picking, setPicking] = useState(false);
  const check = checkCoordinate(lat, lng);
  const ready = check.problem === null && check.lat !== null;
  const showProblem = touched && check.message !== null;

  /** A pasted "-26.1, 28.0" fills both boxes, whichever one received it. */
  const handlePaste = (e: React.ClipboardEvent, field: "lat" | "lng") => {
    const pair = splitPastedPair(e.clipboardData.getData("text"));
    if (!pair) return;
    e.preventDefault();
    setTouched(true);
    onChange(pair.lat, pair.lng);
    void field;
  };

  const box = (field: "lat" | "lng") => {
    const value = field === "lat" ? lat : lng;
    const isLat = field === "lat";
    return (
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          {isLat ? "Latitude" : "Longitude"}
          <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
            {isLat ? "negative" : "positive"}
          </span>
        </span>
        <input
          value={value}
          inputMode="decimal"
          onPaste={(e) => handlePaste(e, field)}
          onChange={(e) => {
            setTouched(true);
            onChange(isLat ? e.target.value : lat, isLat ? lng : e.target.value);
          }}
          placeholder={isLat ? "-26.1075" : "28.0567"}
          className={`w-32 border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-iram-green ${
            showProblem ? "border-red-400" : "border-gray-300"
          }`}
        />
      </label>
    );
  };

  return (
    <div className={compact ? "" : "space-y-1.5"}>
      {label && <div className="text-xs font-medium text-gray-700">{label}</div>}

      <div className="flex items-end gap-2 flex-wrap">
        {box("lat")}
        {box("lng")}
        {/* Offered FIRST in reading order after the boxes, because for a store
            with no address it is the easier of the two ways in — there is
            nothing to look up, only somewhere to point. */}
        {storeName && (
          <button
            onClick={() => setPicking(true)}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-50"
          >
            Drop a pin
          </button>
        )}
        <button
          onClick={() => {
            if (ready) onSave(check.lat!, check.lng!);
          }}
          disabled={!ready || saving || locked}
          title={
            !ready
              ? "Enter a valid South African coordinate first"
              : locked && !saving
              ? "Another store's GPS is saving. Wait for it to finish."
              : undefined
          }
          className="px-3 py-1.5 bg-iram-green text-white rounded text-xs font-medium hover:bg-iram-green-dark disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save GPS"}
        </button>
      </div>

      {picking && storeName && (
        <PinDropMap
          storeName={storeName}
          nearby={nearby ?? []}
          initial={ready ? { lat: check.lat!, lng: check.lng! } : null}
          onCancel={() => setPicking(false)}
          onPick={(la, ln) => {
            setTouched(true);
            onChange(String(la), String(ln));
            setPicking(false);
          }}
        />
      )}

      {/* The rule, where it is needed, before anything goes wrong. */}
      {!showProblem && (
        <p className="text-[11px] text-gray-400">
          In South Africa latitude is between {SA_LAT.min} and {SA_LAT.max} (always negative) and
          longitude between {SA_LNG.min} and {SA_LNG.max}. You can paste both at once.
        </p>
      )}

      {showProblem && (
        <div className="text-[11px] text-red-600 flex items-center gap-2 flex-wrap">
          <span>{plainDash(check.message ?? "")}</span>
          {/* Offered as a BUTTON, not as an automatic correction. Silently
              reordering what someone typed would hide that the source data has
              them the wrong way round. */}
          {check.suggestion && (
            <button
              onClick={() => onChange(String(check.suggestion!.lat), String(check.suggestion!.lng))}
              className="px-2 py-0.5 border border-red-300 text-red-700 rounded hover:bg-red-50 font-medium"
            >
              Swap to {check.suggestion.lat}, {check.suggestion.lng}
            </button>
          )}
        </div>
      )}

      {ready && touched && (
        <a
          href={`https://www.google.com/maps?q=${check.lat},${check.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-blue-600 hover:underline"
        >
          Check this pin on Google Maps before saving
        </a>
      )}
    </div>
  );
}
