import { NextResponse } from "next/server";
import { getReps, getStores, getChannels, getStoreOverrides, getSettings, getVisitRoles } from "@/lib/data";
import { requirePermission } from "@/lib/auth";
import { buildDataHealthReport } from "@/lib/dataHealth";
import XLSX from "xlsx";

/**
 * Every issue in one workbook: a contents page, then one sheet per check.
 *
 * A check that found NOTHING still gets a line on the contents page. Leaving it
 * out would make a clean check indistinguishable from a check that was never
 * run, and "it wasn't on the report" is how a silent failure survives.
 */
export const maxDuration = 60;

/** Excel sheet names: 31 chars, and none of : \ / ? * [ ] */
function sheetName(id: string, used: Set<string>): string {
  let base = id.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = `~${n++}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

export async function GET() {
  try {
    await requirePermission("export_data");

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

    const wb = XLSX.utils.book_new();
    const used = new Set<string>();
    const names = new Map<string, string>();
    for (const i of report.issues) names.set(i.id, sheetName(i.id, used));

    const t = report.totals;
    const contents: (string | number)[][] = [
      ["IRAM ROUTE PLANNER - DATA HEALTH"],
      ["Generated", new Date().toISOString().slice(0, 16).replace("T", " ")],
      [],
      ["Stores", t.stores],
      ["Reps", t.reps],
      ["Channels", t.channels],
      ["Checks that found something", t.issueTypes],
      ["Records that cannot be planned at all", t.blocking],
      ["Distinct stores blocked", t.storesBlocked],
      ["Closed stores (not checked)", t.storesClosed],
      ["Stores in channels nobody calls on (not checked)", t.storesNotCalledOn],
      [],
      ["CHECK", "SEVERITY", "FOUND", "SHEET", "WHAT IT MEANS"],
    ];
    for (const i of report.issues) {
      contents.push([
        i.title,
        i.severity,
        i.count,
        i.count > 0 ? names.get(i.id) || "" : "(nothing found)",
        i.count > 0 ? i.summary : "Checked. No records matched.",
      ]);
    }
    contents.push([]);
    contents.push(["WHAT TO DO"]);
    for (const i of report.issues) {
      if (i.count === 0) continue;
      contents.push([i.title, "", "", "", i.action]);
    }
    contents.push([]);
    contents.push(["SEVERITY MEANS"]);
    contents.push(["blocking", "", "", "", "The record cannot appear in a route at all."]);
    contents.push(["warning", "", "", "", "It will be planned, but probably wrongly."]);
    contents.push(["info", "", "", "", "Worth knowing. Nothing is broken."]);

    const wsContents = XLSX.utils.aoa_to_sheet(contents);
    wsContents["!cols"] = [{ wch: 48 }, { wch: 11 }, { wch: 8 }, { wch: 26 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsContents, "Contents");

    for (const i of report.issues) {
      if (i.count === 0) continue;
      const rows = [i.columns, ...i.rows];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = i.columns.map((c) => ({ wch: Math.min(Math.max(c.length + 3, 12), 46) }));
      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: i.columns.length - 1, r: rows.length - 1 } }),
      };
      XLSX.utils.book_append_sheet(wb, ws, names.get(i.id)!);
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);

    // ASCII only: HTTP headers are latin-1 and one long dash here throws.
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="iRam_Data_Health_${date}.xlsx"`,
      },
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to export data." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
