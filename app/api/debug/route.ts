import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requireAdmin } from "@/lib/auth";
import { hasGoogleMapsKey } from "@/lib/google-maps";

export const dynamic = "force-dynamic";

/** Two points ~12km apart in Johannesburg, used to prove Directions answers. */
const PROBE_ORIGIN = "-26.2041,28.0473";
const PROBE_DEST = "-26.1076,28.0567";

async function probeGoogleMaps() {
  if (!hasGoogleMapsKey()) {
    return { keyPresent: false, ok: false, detail: "GOOGLE_MAPS_API_KEY is not set" };
  }

  const key = process.env.GOOGLE_MAPS_API_KEY || "";
  const out: Record<string, unknown> = { keyPresent: true, keyLength: key.length };

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${PROBE_ORIGIN}&destination=${PROBE_DEST}&key=${key}`
    );
    const data = await res.json();
    out.directions = {
      ok: data.status === "OK",
      status: data.status,
      // error_message can echo the key back — never surface it verbatim.
      detail: data.status === "OK" ? undefined : String(data.error_message ?? "").replace(key, "<key>"),
      roadDistanceKm:
        data.status === "OK"
          ? +(data.routes?.[0]?.legs?.[0]?.distance?.value / 1000).toFixed(2)
          : undefined,
      hasPolyline: !!data.routes?.[0]?.overview_polyline?.points,
    };
  } catch (e) {
    out.directions = { ok: false, status: "FETCH_FAILED", detail: String(e) };
  }

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${PROBE_ORIGIN}&key=${key}`
    );
    const data = await res.json();
    out.geocoding = {
      ok: data.status === "OK",
      status: data.status,
      detail: data.status === "OK" ? undefined : String(data.error_message ?? "").replace(key, "<key>"),
      sample: data.status === "OK" ? data.results?.[0]?.formatted_address : undefined,
    };
  } catch (e) {
    out.geocoding = { ok: false, status: "FETCH_FAILED", detail: String(e) };
  }

  return out;
}

// Admin-only. This reports on stored data and integration health, so it must
// never be reachable without a session — it previously returned a preview of
// users.json (emails and password hashes) to anyone with the URL.
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { blobs } = await list();

    return NextResponse.json({
      blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      totalBlobs: blobs.length,
      // Names and sizes only — never blob contents.
      blobs: blobs.map((b) => ({ pathname: b.pathname, size: b.size })),
      googleMaps: await probeGoogleMaps(),
      perigeeConfigured: blobs.some((b) => b.pathname === "config/perigee-api.json"),
      cronSecretSet: !!process.env.CRON_SECRET,
      resendConfigured: !!process.env.RESEND_API_KEY,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
