import { NextRequest, NextResponse } from "next/server";
import { getRoutes, getRoutesForType, getStores, getChannels } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const typeId = request.nextUrl.searchParams.get("typeId");
    const doc = typeId ? await getRoutesForType(typeId) : await getRoutes();

    const [stores, channels] = await Promise.all([getStores(), getChannels()]);
    const storeById = new Map(stores.map((s) => [s.id, s]));
    const channelName = new Map(channels.map((c) => [c.id, c.name]));

    const rows: (string | number)[][] = [
      ["Rep Code", "Rep Name", "Store Name", "Store ID", "Channel", "Reason"],
    ];

    for (const plan of doc?.repPlans ?? []) {
      for (const u of plan.stats?.unassignedStores ?? []) {
        const store = storeById.get(u.storeId);
        rows.push([
          plan.repCode,
          plan.repName,
          u.storeName,
          u.storeId,
          store ? channelName.get(store.channelId) || store.channelId || "" : "",
          u.reason,
        ]);
      }
    }

    // Sort data rows by rep name, then store name (keep header first)
    const body = rows.slice(1).sort((a, b) => {
      const r = String(a[1]).localeCompare(String(b[1]));
      return r !== 0 ? r : String(a[2]).localeCompare(String(b[2]));
    });
    const sheet = [rows[0], ...body];

    const ws = XLSX.utils.aoa_to_sheet(sheet);
    ws["!cols"] = [
      { wch: 12 }, // Rep Code
      { wch: 24 }, // Rep Name
      { wch: 36 }, // Store Name
      { wch: 22 }, // Store ID
      { wch: 20 }, // Channel
      { wch: 22 }, // Reason
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Unassigned Stores");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Unassigned_Stores_${date}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Unassigned export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
