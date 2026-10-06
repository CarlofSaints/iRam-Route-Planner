import { NextResponse } from "next/server";
import { getReps, getStores, getChannels, getStoreOverrides, getSettings, getVisitRoles } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { buildDataHealthReport } from "@/lib/dataHealth";

export const maxDuration = 60;

export async function GET() {
  try {
    await requireSession();

    const [reps, stores, channels, overrides, visitRoles, settings] = await Promise.all([
      getReps(),
      getStores(),
      getChannels(),
      getStoreOverrides(),
      getVisitRoles(),
      getSettings(),
    ]);

    const report = buildDataHealthReport({
      reps,
      stores,
      channels,
      overrides,
      visitRoles,
      outlierRadiusKm: settings.outlierRadiusKm ?? 150,
    });

    // The rows are the whole point of the export, but on screen the page only
    // shows the first handful of each. Sending thousands of rows to render 25 of them
    // is a payload nobody reads.
    return NextResponse.json({
      ...report,
      issues: report.issues.map((i) => ({ ...i, rows: i.rows.slice(0, 25), truncated: i.rows.length > 25 })),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
