"use client";

import { useState, useRef } from "react";

/**
 * The Stores page's import — the return leg of its Excel export.
 *
 * Kept separate from Store Upload on purpose. That page loads the whole
 * picture, personnel included, and a sheet without rep columns going through it
 * unassigns every store it touches. This one posts to /api/stores/import, which
 * reads only the store's own fields, so the team can fix a column of GPS
 * coordinates in the exported file and send it straight back.
 */

type ImportResult = {
  ok?: boolean;
  error?: string;
  sheetName?: string;
  rowsInFile?: number;
  matched?: number;
  unchanged?: number;
  totalChanges?: number;
  changed?: {
    name: number;
    channel: number;
    province: number;
    region: number;
    gps: number;
    gpsCleared: number;
  };
  noIdRows?: number;
  columnsRead?: string[];
  columnsAbsent?: string[];
  gpsHalfPresent?: boolean;
  unmatchedCount?: number;
  unmatched?: string[];
  unknownChannels?: string[];
  blankRequired?: string[];
  blankRequiredCount?: number;
  duplicateIds?: string[];
  duplicateIdCount?: number;
  fileHeaders?: string[];
};

export default function StoreImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** Called after a run that actually wrote something, so the grid reloads. */
  onImported: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      setResult({ error: "Please choose an .xlsx or .xls file" });
      return;
    }
    setImporting(true);
    setResult(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/stores/import", { method: "POST", body: fd });
      const data: ImportResult = await res.json();
      if (res.ok) {
        setResult(data);
        if ((data.totalChanges ?? 0) > 0) onImported();
      } else {
        setResult({ error: data.error || "Import failed", fileHeaders: data.fileHeaders });
      }
    } catch {
      setResult({ error: "Could not read that file — close it in Excel and try again." });
    }
    setImporting(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const changed = result?.changed;
  const changeLines = changed
    ? ([
        ["GPS coordinates", changed.gps],
        ["Channel", changed.channel],
        ["Store name", changed.name],
        ["Province", changed.province],
        ["Region", changed.region],
      ] as const).filter(([, n]) => n > 0)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-lg border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div>
            <h3 className="font-semibold text-gray-900">Import Stores</h3>
            <p className="text-sm text-gray-500 mt-1">
              Send the exported file back after editing it. This reads store details only —
              GPS coordinates, name, channel, province and region.{" "}
              <span className="font-medium text-gray-700">
                Reps, visit roles and teams are never touched.
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none px-2"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="px-6 pb-6">
          {/* Drop zone */}
          <div
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) processFile(file);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragging(false);
            }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragging
                ? "border-iram-green bg-red-50"
                : "border-gray-300 hover:border-iram-green hover:bg-red-50/30"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            {importing ? (
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
                <p className="text-sm text-gray-600">Reading {fileName}...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <svg
                  className="w-10 h-10 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    Drag &amp; drop the edited Excel file here
                  </p>
                  <p className="text-xs text-gray-400 mt-1">or click to browse (.xlsx, .xls)</p>
                </div>
              </div>
            )}
          </div>

          {/* Result */}
          {result?.error && (
            <div className="mt-4 p-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
              <p>{result.error}</p>
              {result.fileHeaders && result.fileHeaders.length > 0 && (
                <div className="mt-2 pt-2 border-t border-amber-200">
                  <p className="text-xs font-medium mb-1">Columns found in your file:</p>
                  <div className="flex flex-wrap gap-1">
                    {result.fileHeaders.map((h, i) => (
                      <span
                        key={i}
                        className="inline-block px-2 py-0.5 bg-white rounded text-[11px] border border-amber-200"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {result?.ok && (
            <div
              className={`mt-4 p-3 rounded-lg text-sm border ${
                (result.totalChanges ?? 0) > 0
                  ? "bg-green-50 text-green-800 border-green-200"
                  : "bg-gray-50 text-gray-700 border-gray-200"
              }`}
            >
              <p className="font-medium">
                {(result.totalChanges ?? 0) > 0
                  ? `${result.totalChanges} change${result.totalChanges === 1 ? "" : "s"} saved across ${result.matched} matched store${result.matched === 1 ? "" : "s"}.`
                  : `Nothing changed — all ${result.matched} matched stores already held these values.`}
              </p>
              <p className="text-xs mt-1 opacity-80">
                {result.matched} of {result.rowsInFile} rows on sheet &quot;{result.sheetName}&quot;
                matched a store
                {(result.unchanged ?? 0) > 0 ? `, ${result.unchanged} already up to date` : ""}.
              </p>

              {changeLines.length > 0 && (
                <ul className="mt-2 pt-2 border-t border-green-200 space-y-0.5">
                  {changeLines.map(([label, n]) => (
                    <li key={label} className="text-xs">
                      {label}: <span className="font-medium">{n}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* A column that is not in the file is left alone on every store.
                  Said out loud, because a cut-down sheet importing "nothing"
                  for a field otherwise reads as the import having failed. */}
              {(result.columnsAbsent?.length ?? 0) > 0 && (
                <p className="text-xs mt-2 pt-2 border-t border-green-200 opacity-80">
                  Not in this file, so left unchanged on every store:{" "}
                  {result.columnsAbsent!.join(", ")}.
                </p>
              )}
            </div>
          )}

          {/* Warnings — anything the file asked for that was not done. */}
          {result?.ok &&
            ((result.unmatchedCount ?? 0) > 0 ||
              (result.unknownChannels?.length ?? 0) > 0 ||
              (result.blankRequiredCount ?? 0) > 0 ||
              (result.duplicateIdCount ?? 0) > 0 ||
              (result.noIdRows ?? 0) > 0 ||
              (result.changed?.gpsCleared ?? 0) > 0 ||
              result.gpsHalfPresent) && (
              <div className="mt-3 p-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200 space-y-2">
                {(result.changed?.gpsCleared ?? 0) > 0 && (
                  <p className="text-xs">
                    <span className="font-medium">
                      {result.changed!.gpsCleared} store
                      {result.changed!.gpsCleared === 1 ? " had its" : "s had their"} coordinates
                      cleared
                    </span>{" "}
                    — the GPS cells were blank in the file. If that was not intended, re-export,
                    fix, and import again.
                  </p>
                )}

                {result.gpsHalfPresent && (
                  <p className="text-xs">
                    Only one of GPS LATITUDE / GPS LONGITUDE is in this file. Coordinates move as a
                    pair, so neither was written. Include both columns.
                  </p>
                )}

                {(result.unmatchedCount ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-medium">
                      {result.unmatchedCount} row
                      {result.unmatchedCount === 1 ? "" : "s"} skipped — no store with that Place
                      ID.
                    </p>
                    <p className="text-[11px] mt-0.5 opacity-80">
                      This page updates existing stores only. Add new stores on Store Upload.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.unmatched!.map((id, i) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-0.5 bg-white rounded text-[11px] border border-amber-200"
                        >
                          {id}
                        </span>
                      ))}
                      {result.unmatchedCount! > result.unmatched!.length && (
                        <span className="text-[11px] self-center">
                          +{result.unmatchedCount! - result.unmatched!.length} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {(result.unknownChannels?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-medium">
                      Channel name not recognised, so those stores kept their channel:
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.unknownChannels!.map((c, i) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-0.5 bg-white rounded text-[11px] border border-amber-200"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] mt-1 opacity-80">
                      This page never creates a channel — a new one is almost always a typo. Create
                      it on the Channels page first, then import again.
                    </p>
                  </div>
                )}

                {(result.blankRequiredCount ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-medium">
                      {result.blankRequiredCount} row
                      {result.blankRequiredCount === 1 ? "" : "s"} left a required field blank:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 mt-0.5">
                      {result.blankRequired!.map((m, i) => (
                        <li key={i} className="text-[11px]">
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(result.duplicateIdCount ?? 0) > 0 && (
                  <p className="text-xs">
                    {result.duplicateIdCount} Place ID
                    {result.duplicateIdCount === 1 ? " appears" : "s appear"} more than once in the
                    file — the last row won: {result.duplicateIds!.join(", ")}
                  </p>
                )}

                {(result.noIdRows ?? 0) > 0 && (
                  <p className="text-xs">
                    {result.noIdRows} row{result.noIdRows === 1 ? "" : "s"} had no Place ID and{" "}
                    {result.noIdRows === 1 ? "was" : "were"} skipped.
                  </p>
                )}
              </div>
            )}

          {/* What this reads, stated before anyone uploads rather than after. */}
          <div className="mt-5 bg-gray-50 border border-gray-100 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-gray-700 mb-2">What this import reads</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-gray-500">
              <span>PLACE ID — matches the store, required</span>
              <span>PLACE NAME</span>
              <span>CHANNEL — must already exist</span>
              <span>PROVINCE</span>
              <span>REGION</span>
              <span>GPS LATITUDE + GPS LONGITUDE</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">
              Every other column in the exported file is ignored, including the rep, visit role and
              team columns and FREQUENCY / DURATION / DAY / WEEK. A column you delete from the file
              is left untouched on every store; a column you keep but leave blank clears that field.
              Stores whose Place ID is not already in the system are reported, not created.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
