import { NextResponse } from "next/server";
import { getChannels, getVisitRoles } from "@/lib/data";
import { getFrequencyLabel, FREQUENCY_OPTIONS, roleColumns } from "@/lib/types";
import { resolveRoleDefault, roleCallsOnChannel } from "@/lib/repStores";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export async function GET() {
  try {
    await requireSession();

    const [channels, visitRoles] = await Promise.all([getChannels(), getVisitRoles()]);

    // Primary first, matching the on-screen grid. The primary role owns the
    // plain "Frequency"/"Duration (min)" columns — those are the channel's own
    // values, the ones materialised onto every store — so it gets no columns
    // of its own and no Calls switch.
    const roles = [...visitRoles].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const primary = roles.find((r) => r.isPrimary);
    const extraRoles = roles.filter((r) => !r.isPrimary);

    const header: string[] = [
      "Channel Name",
      "Frequency",
      "Duration (min)",
    ];
    for (const role of extraRoles) {
      const c = roleColumns(role);
      header.push(c.calls, c.frequency, c.duration);
    }

    const rows: (string | number)[][] = [header];

    const sorted = [...channels].sort((a, b) => a.name.localeCompare(b.name));

    for (const ch of sorted) {
      const row: (string | number)[] = [ch.name, ch.frequency, ch.duration];
      for (const role of extraRoles) {
        const calls = roleCallsOnChannel(ch, role);
        const eff = resolveRoleDefault(ch, role);
        // Always written out, never left blank — a role that is inheriting its
        // rhythm still HAS one, and an empty cell reads as broken and does not
        // survive a round trip. The importer only turns an inherited value into
        // an explicit one when the number actually changed.
        row.push(calls ? "Yes" : "No", eff.frequency, eff.duration);
      }
      rows.push(row);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    ws["!cols"] = [
      { wch: 30 }, // Channel Name
      { wch: 20 }, // Frequency
      { wch: 18 }, // Duration
      ...extraRoles.flatMap(() => [{ wch: 10 }, { wch: 20 }, { wch: 20 }]),
    ];

    // Reference sheet: valid frequency values.
    const refRows: string[][] = [["Frequency Value", "Label"]];
    for (const f of FREQUENCY_OPTIONS) {
      refRows.push([f.value, f.label]);
    }
    const refWs = XLSX.utils.aoa_to_sheet(refRows);
    refWs["!cols"] = [{ wch: 20 }, { wch: 25 }];

    // Reference sheet: what each role column means. Without this a reader has
    // no way to tell an inherited value from one set on the channel, and no way
    // to know what "Calls = No" does.
    const roleRows: (string | number)[][] = [
      ["Visit Role", "Primary", "Role's own Frequency", "Role's own Duration (min)", "Columns in the Channels sheet"],
      [
        primary?.name || "Sales Rep",
        "Yes",
        "n/a — uses the channel's own value",
        "n/a — uses the channel's own value",
        "Frequency, Duration (min)",
      ],
    ];
    for (const role of extraRoles) {
      const c = roleColumns(role);
      roleRows.push([
        role.name,
        "No",
        getFrequencyLabel(role.frequency),
        role.duration,
        `${c.calls}, ${c.frequency}, ${c.duration}`,
      ]);
    }
    roleRows.push([]);
    roleRows.push(["How to use this file"]);
    roleRows.push([
      "Calls",
      'Set to "No" where the role never visits that channel. Those stores drop out of that role\'s routes and out of their capacity entirely. "Yes" puts them back.',
    ]);
    roleRows.push([
      "Frequency / Duration",
      "Every cell is filled in with the value that is actually in force. Leaving a value as it is keeps the channel inheriting the role's own default; changing it pins that channel to the new number.",
    ]);
    roleRows.push([
      "Channel Name",
      "Matched case-insensitively against existing channels. A name that matches nothing creates a new channel.",
    ]);
    const roleWs = XLSX.utils.aoa_to_sheet(roleRows);
    roleWs["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 24 }, { wch: 26 }, { wch: 70 }];

    XLSX.utils.book_append_sheet(wb, ws, "Channels");
    XLSX.utils.book_append_sheet(wb, roleWs, "Visit Roles");
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
