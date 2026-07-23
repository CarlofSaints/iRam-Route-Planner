import { NextResponse } from "next/server";
import { getChannels } from "@/lib/data";
import { getFrequencyLabel } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export async function GET() {
  try {
    await requireSession();

    const channels = await getChannels();

    const rows: (string | number)[][] = [
      ["Channel Name", "Frequency", "Duration (min)"],
    ];

    const sorted = [...channels].sort((a, b) => a.name.localeCompare(b.name));

    for (const ch of sorted) {
      rows.push([ch.name, ch.frequency, ch.duration]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    ws["!cols"] = [
      { wch: 30 }, // Channel Name
      { wch: 20 }, // Frequency
      { wch: 18 }, // Duration
    ];

    // Add a reference sheet with valid frequency values
    const refRows: string[][] = [
      ["Frequency Value", "Label"],
    ];
    const { FREQUENCY_OPTIONS } = await import("@/lib/types");
    for (const f of FREQUENCY_OPTIONS) {
      refRows.push([f.value, f.label]);
    }
    const refWs = XLSX.utils.aoa_to_sheet(refRows);
    refWs["!cols"] = [{ wch: 20 }, { wch: 25 }];

    XLSX.utils.book_append_sheet(wb, ws, "Channels");
    XLSX.utils.book_append_sheet(wb, refWs, "Frequency Reference");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `Channels_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Channel export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
