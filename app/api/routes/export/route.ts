import { NextRequest, NextResponse } from "next/server";
import { getRoutes, getReps, getTeams } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { WeekLabel, DayLabel } from "@/lib/types";
import XLSX from "xlsx";

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];
const DAYS: DayLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("teamId") || "";
    const includeTimes = searchParams.get("includeTimes") === "1";

    const routes = await getRoutes();
    if (!routes || routes.repPlans.length === 0) {
      return NextResponse.json({ error: "No routes generated" }, { status: 404 });
    }

    const reps = await getReps();
    const teams = await getTeams();

    // Filter rep plans by team if specified
    let repPlans = routes.repPlans;
    if (teamId) {
      const teamRepCodes = new Set(
        reps.filter((r) => r.teamId === teamId).map((r) => r.code)
      );
      repPlans = repPlans.filter((p) => teamRepCodes.has(p.repCode));
    }

    if (repPlans.length === 0) {
      return NextResponse.json({ error: "No reps found for this team" }, { status: 404 });
    }

    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();

    for (const plan of repPlans) {
      // Build sheet name (max 31 chars, deduplicated)
      let sheetName = plan.repName.slice(0, 31);
      if (usedNames.has(sheetName)) {
        const suffix = ` (${plan.repCode})`;
        sheetName = plan.repName.slice(0, 31 - suffix.length) + suffix;
      }
      usedNames.add(sheetName);

      // Build day plans lookup
      const dayLookup = new Map<string, typeof plan.days[0]>();
      for (const dp of plan.days) {
        dayLookup.set(`${dp.week}-${dp.day}`, dp);
      }

      const rows: (string | null)[][] = [];

      // Row 1: Rep Name (RepCode)
      rows.push([`${plan.repName} (${plan.repCode})`]);
      // Row 2: blank
      rows.push([]);

      for (const week of WEEKS) {
        // Week header row
        rows.push([week]);

        // Day header row
        rows.push([null, ...DAYS]);

        // Find max stops in any day of this week
        let maxStops = 0;
        for (const day of DAYS) {
          const dp = dayLookup.get(`${week}-${day}`);
          if (dp) maxStops = Math.max(maxStops, dp.stops.length);
        }

        // Stop rows
        for (let stopIdx = 0; stopIdx < maxStops; stopIdx++) {
          const row: (string | null)[] = [null]; // first column blank (aligned under week label)
          for (const day of DAYS) {
            const dp = dayLookup.get(`${week}-${day}`);
            const stop = dp?.stops[stopIdx];
            if (stop) {
              row.push(
                includeTimes
                  ? `${stop.storeName} (${stop.arrivalTime})`
                  : stop.storeName
              );
            } else {
              row.push(null);
            }
          }
          rows.push(row);
        }

        // If no stops at all for this week, add one empty row
        if (maxStops === 0) {
          rows.push([null, ...DAYS.map(() => null)]);
        }

        // Blank row between weeks
        rows.push([]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Set column widths
      ws["!cols"] = [
        { wch: 6 },  // Week label column
        { wch: 30 }, // Monday
        { wch: 30 }, // Tuesday
        { wch: 30 }, // Wednesday
        { wch: 30 }, // Thursday
        { wch: 30 }, // Friday
      ];

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Build filename
    const teamName = teamId
      ? teams.find((t) => t.id === teamId)?.name || "Team"
      : "All";
    const filename = `Routes_${teamName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
