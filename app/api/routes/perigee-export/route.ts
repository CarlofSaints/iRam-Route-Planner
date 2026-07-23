import { NextRequest, NextResponse } from "next/server";
import { getRoutes, getRoutesForType, getStores } from "@/lib/data";
import { DayLabel } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

// NOTE: carried over from the Repsly build — this is a best-guess schedule-import
// column layout and has NOT yet been confirmed against Perigee's own call-cycle
// import template. Adjust the headers here once Perigee's template is to hand.
const HEADERS = [
  "Representative ID",
  "Place ID",
  "From Date",
  "Repeat every (x) week",
  "Time",
  "Duration",
  "Weekday",
  "Rep Name",
  "Store Name",
];

const DAY_OFFSET: Record<DayLabel, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
};

const DAY_MS = 86400000;

function startMondayUTC(): Date {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = new Date(base);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const add = (1 - dow + 7) % 7; // 0 if Monday, else days to next Monday
  return new Date(base + add * DAY_MS);
}

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const sp = request.nextUrl.searchParams;
    const months = Math.min(6, Math.max(1, Number(sp.get("months")) || 3));
    const typeId = sp.get("typeId");
    const repFilter = sp.get("repCode") || "";
    const format = sp.get("format") === "csv" ? "csv" : "xlsx";

    const [doc, stores] = await Promise.all([
      typeId ? getRoutesForType(typeId) : getRoutes(),
      getStores(),
    ]);
    const placeIdById = new Map(stores.map((s) => [s.id, s.placeId || s.id]));

    const plans = (doc?.repPlans ?? []).filter((p) => !repFilter || p.repCode === repFilter);

    const start = startMondayUTC();
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + months);

    const rows: (string | number)[][] = [HEADERS];

    for (let w = 0; w < 60; w++) {
      const weekStart = new Date(start.getTime() + w * 7 * DAY_MS);
      if (weekStart > end) break;
      const cycleWeek = `Wk${(w % 4) + 1}`;

      for (const plan of plans) {
        for (const dp of plan.days) {
          if (dp.week !== cycleWeek) continue;
          const offset = DAY_OFFSET[dp.day as DayLabel] ?? 0;
          const date = new Date(weekStart.getTime() + offset * DAY_MS);
          if (date > end) continue;
          const dateStr = date.toISOString().slice(0, 10);

          for (const stop of dp.stops) {
            rows.push([
              plan.repCode,
              placeIdById.get(stop.storeId) || stop.storeId,
              dateStr,
              0, // explicit one-off visit (no recurrence)
              stop.arrivalTime,
              stop.visitDuration,
              dp.day,
              plan.repName,
              stop.storeName,
            ]);
          }
        }
      }
    }

    // Sort data rows by rep, then date, then time
    const body = rows.slice(1).sort((a, b) => {
      const r = String(a[0]).localeCompare(String(b[0]));
      if (r) return r;
      const d = String(a[2]).localeCompare(String(b[2]));
      if (d) return d;
      return String(a[4]).localeCompare(String(b[4]));
    });
    const sheet = [HEADERS, ...body];

    const ws = XLSX.utils.aoa_to_sheet(sheet);
    ws["!cols"] = [
      { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 8 },
      { wch: 9 }, { wch: 11 }, { wch: 22 }, { wch: 34 },
    ];

    const date = new Date().toISOString().slice(0, 10);
    const scope = repFilter || "all-reps";
    const base = `Perigee_CallCycle_${scope}_${months}mo_${date}`;

    if (format === "csv") {
      const csv = XLSX.utils.sheet_to_csv(ws);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.csv"`,
        },
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Perigee Schedule");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Perigee export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
