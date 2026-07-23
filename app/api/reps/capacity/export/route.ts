import { NextResponse } from "next/server";
import { getReps, getStores, getRoutes, getTeams } from "@/lib/data";
import { computeCapacity } from "@/lib/capacity";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export async function GET() {
  try {
    await requireSession();

    const [reps, stores, doc, teams] = await Promise.all([
      getReps(),
      getStores(),
      getRoutes(),
      getTeams(),
    ]);

    const result = computeCapacity(reps, stores, doc);
    const teamName = new Map(teams.map((t) => [t.id, t.name || t.managerName || ""]));

    const rows: (string | number)[][] = [
      [
        "Rep Code",
        "Rep Name",
        "Team",
        "Stores",
        "Calls/Month",
        "Hours/Day",
        "Scheduled Hours/Month",
        "Visit Hours",
        "Travel Hours",
        "Available Hours/Month",
        "Utilisation %",
        "Spare Hours",
        "Over-Capacity Days",
        "Unassigned Stores",
        "Routed",
      ],
    ];

    const sorted = [...result.reps].sort((a, b) => b.utilization - a.utilization);
    for (const r of sorted) {
      rows.push([
        r.repCode,
        r.repName,
        teamName.get(r.teamId) || "Unassigned",
        r.storeCount,
        r.callsPerMonth,
        r.workingHoursPerDay,
        r.hasRoute ? r.scheduledHours : "",
        r.hasRoute ? r.visitHours : "",
        r.hasRoute ? r.travelHours : "",
        r.availableHours,
        r.hasRoute ? Math.round(r.utilization * 100) : "",
        r.hasRoute ? r.spareHours : "",
        r.overCapacityDays,
        r.unassignedStores,
        r.hasRoute ? "Yes" : "No",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 24 }, { wch: 20 }, { wch: 8 }, { wch: 11 },
      { wch: 9 }, { wch: 20 }, { wch: 11 }, { wch: 12 }, { wch: 20 },
      { wch: 12 }, { wch: 11 }, { wch: 17 }, { wch: 16 }, { wch: 8 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rep Capacity");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Rep_Capacity_${date}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Rep capacity export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
