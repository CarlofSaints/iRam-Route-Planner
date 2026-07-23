"use client";

import { useState, useRef } from "react";

export default function StoreUploadPage() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; headers?: string[]; skipped?: number; rowsInFile?: number } | null>(null);
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
      <h1 className="text-xl font-bold text-gray-900 mb-1">Store Upload</h1>
      <p className="text-sm text-gray-500 mb-6">
        Upload an Excel file to import or update stores. Channels and reps will be auto-created if they don&apos;t exist.
      </p>

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
          <span>ZONE (optional)</span>
          <span>REGION / PROVINCE / AREA (optional)</span>
        </div>
      </div>
    </div>
  );
}
