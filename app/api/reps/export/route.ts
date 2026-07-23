import { NextRequest, NextResponse } from "next/server";
import { getReps } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";

    const reps = await getReps();

    const rows: (string | number)[][] = [
      ["Rep Code", "Rep Name", "Email", "Cell Number", "Home Address", "Hours/Day"],
    ];

    const sorted = [...reps].sort((a, b) => a.name.localeCompare(b.name));

    for (const rep of sorted) {
      rows.push([
        rep.code || "",
        rep.name || "",
        rep.email || "",
        rep.cell || "",
        rep.homeAddress || "",
        rep.workingHoursPerDay ?? 8.5,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, // Rep Code
      { wch: 24 }, // Rep Name
      { wch: 28 }, // Email
      { wch: 16 }, // Cell Number
      { wch: 40 }, // Home Address
      { wch: 10 }, // Hours/Day
    ];

    const date = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const csv = XLSX.utils.sheet_to_csv(ws);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="Sales_Reps_${date}.csv"`,
        },
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Reps");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Sales_Reps_${date}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Reps export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
