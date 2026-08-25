"use client";

import { useState, useRef } from "react";

export default function StoreUploadPage() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templateMenu, setTemplateMenu] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    headers?: string[];
    skipped?: number;
    rowsInFile?: number;
    roleColumnsFound?: string[];
    roleColumnsMissing?: string[];
    roleMismatches?: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      setResult({ ok: false, message: "Please upload an .xlsx or .xls file" });
      return;
    }
    setUploading(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/stores/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        const added = data.added ?? 0;
        const updated = data.updated ?? 0;
        const noChange = added === 0 && updated === 0 && (data.skippedRows ?? 0) > 0;
        setResult({
          ok: !noChange,
          message: noChange
            ? `No stores imported — ${data.skippedRows} of ${data.rowsInFile} rows skipped (missing Place ID or Store Name column).`
            : `${added} new stores added, ${updated} updated — ${data.total ?? 0} total stores, ${data.channels} channels, ${data.reps} reps`,
          headers: data.fileHeaders,
          skipped: data.skippedRows,
          rowsInFile: data.rowsInFile,
          roleColumnsFound: data.roleColumnsFound,
          roleColumnsMissing: data.roleColumnsMissing,
          roleMismatches: data.roleMismatches,
        });
      } else {
        setResult({ ok: false, message: data.error || "Upload failed" });
      }
    } catch {
      setResult({ ok: false, message: "Please close the file you're attempting to load" });
    }
    setUploading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Store Upload</h1>
          <p className="text-sm text-gray-500">
            Upload an Excel file to import or update stores. Channels and reps will be auto-created if they don&apos;t exist.
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setTemplateMenu((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-iram-green hover:bg-iram-green-dark rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
            </svg>
            Export Template
          </button>

          {templateMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setTemplateMenu(false)} />
              <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                <a
                  href="/api/stores/template?format=standard"
                  onClick={() => setTemplateMenu(false)}
                  className="block px-4 py-3 hover:bg-gray-50 border-b border-gray-100"
                >
                  <span className="block text-sm font-medium text-gray-800">Standard template</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Use this one. PLACE ID / PLACE NAME / CHANNEL / a column per visit role / GPS
                  </span>
                </a>
                <a
                  href="/api/stores/template?format=perigee"
                  onClick={() => setTemplateMenu(false)}
                  className="block px-4 py-3 hover:bg-gray-50"
                >
                  <span className="block text-sm font-medium text-gray-800">Perigee site export</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Only if you are starting from a file Perigee produced. Same role columns,
                    but ID / Name / Tags instead of PLACE ID / PLACE NAME / CHANNEL.
                  </span>
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
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

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
            <p className="text-sm text-gray-600">Uploading and processing...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Drag & drop your Excel file here
              </p>
              <p className="text-xs text-gray-400 mt-1">or click to browse (.xlsx, .xls)</p>
            </div>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${
          result.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"
        }`}>
          <p>{result.message}</p>
          {result.headers && result.headers.length > 0 && !result.ok && (
            <div className="mt-2 pt-2 border-t border-amber-200">
              <p className="text-xs font-medium mb-1">Your file headers:</p>
              <div className="flex flex-wrap gap-1">
                {result.headers.map((h, i) => (
                  <span key={i} className="inline-block px-2 py-0.5 bg-white rounded text-[11px] border border-amber-200">{h}</span>
                ))}
              </div>
              <p className="text-[11px] mt-2 text-amber-600">
                The uploader needs a column matching &quot;PLACE ID&quot; or &quot;STORE ID&quot; and one matching &quot;PLACE NAME&quot; or &quot;STORE NAME&quot;.
              </p>
            </div>
          )}

          {/* What happened to the visit-role columns. Reported even on success:
              a file that simply lacked them imports perfectly and leaves every
              role assignment untouched, which reads as "roles didn't work". */}
          {(result.roleColumnsFound?.length || result.roleColumnsMissing?.length) && (
            <div className={`mt-2 pt-2 border-t ${result.ok ? "border-green-200" : "border-amber-200"}`}>
              {result.roleColumnsFound && result.roleColumnsFound.length > 0 && (
                <p className="text-xs">
                  Visit role columns read: {result.roleColumnsFound.join(", ")}
                </p>
              )}
              {result.roleColumnsMissing && result.roleColumnsMissing.length > 0 && (
                <p className="text-xs mt-1">
                  Not in this file, so left unchanged on every store:{" "}
                  {result.roleColumnsMissing.join(", ")}. Download the template again to get them.
                </p>
              )}
            </div>
          )}

          {result.roleMismatches && result.roleMismatches.length > 0 && (
            <div className={`mt-2 pt-2 border-t ${result.ok ? "border-green-200" : "border-amber-200"}`}>
              <p className="text-xs font-medium mb-1">
                {result.roleMismatches.length} rep{result.roleMismatches.length === 1 ? " is" : "s are"} in
                a role column that does not match their role under Reps:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {result.roleMismatches.map((m, i) => (
                  <li key={i} className="text-[11px]">{m}</li>
                ))}
              </ul>
              <p className="text-[11px] mt-1 opacity-80">
                A rep performs one role everywhere, so the store was still assigned — but they will be
                planned at their own role&apos;s frequency and duration. Change their role under Reps if that is wrong.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Expected columns */}
      <div className="mt-8 bg-white border border-gray-100 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Expected Columns</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500">
          <span>PLACE ID / STORE ID</span>
          <span>PLACE NAME / STORE NAME</span>
          <span>CHANNEL</span>
          <span>REPRESENTATIVE ID / REP CODE</span>
          <span>REPRESENTATIVE NAME / REP NAME</span>
          <span>GPS LATITUDE</span>
          <span>GPS LONGITUDE</span>
          <span>MONTHLY AVERAGE / VALUE</span>
          <span>REGION / PROVINCE / AREA (optional)</span>
          <span className="text-gray-400">SECONDARY / THIRD REPRESENTATIVE ID (old files only)</span>
        </div>
        <p className="text-[11px] text-gray-500 mt-3">
          Every visit role other than the sales rep has its OWN pair of columns, named after the
          role: for example <span className="font-medium">Team Leader ID</span> and{" "}
          <span className="font-medium">Team Leader Name</span>. Add or rename a role on{" "}
          <a href="/visit-roles" className="text-iram-green hover:underline">Visit Roles</a> and those
          column names change with it.
        </p>
        <p className="text-[11px] text-gray-400 mt-2">
          Grab a pre-formatted file with Export Template above: it already carries a pair for every
          role you have. The old SECONDARY and THIRD columns are still read so existing files keep
          working, but they cannot say WHICH role they are for, so use the named pairs.
        </p>
      </div>
    </div>
  );
}
