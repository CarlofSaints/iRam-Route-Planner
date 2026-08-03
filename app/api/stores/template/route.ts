import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

// Blank upload template for Control Centre → Store Upload.
//
// Two variants, matching the two header layouts app/api/stores/upload/route.ts
// detects:
//   ?format=standard  → the "original format" branch (the default)
//   ?format=perigee   → the site-export branch, triggered when the file has
//                       the exact headers "ID" + "Name" + "Representative ID"
//
// The header strings below are the FIRST alias the uploader looks for in each
// branch, so a file built from this template always takes the intended path.
// NOTE: the perigee variant's headers are still the best-guess set carried over
// from the Repsly Places export — reconcile with a real Perigee site export.

type Variant = {
  label: string;
  filename: string;
  headers: string[];
  widths: number[];
  examples: (string | number)[][];
  notes: [string, string][];
};

const STANDARD: Variant = {
  label: "Standard",
  filename: "Store_Upload_Template",
  headers: [
    "PLACE ID",
    "PLACE NAME",
    "CHANNEL",
    "REPRESENTATIVE ID",
    "REPRESENTATIVE NAME",
    "SECONDARY REPRESENTATIVE ID",
    "SECONDARY REPRESENTATIVE NAME",
    "THIRD REPRESENTATIVE ID",
    "THIRD REPRESENTATIVE NAME",
    "GPS LATITUDE",
    "GPS LONGITUDE",
    "MONTHLY AVERAGE",
    "REGION",
  ],
  widths: [16, 34, 20, 20, 26, 28, 30, 26, 28, 16, 16, 18, 20],
  examples: [
    ["1001", "Checkers Fourways", "RETAIL", "R01", "Thabo Mokoena", "R02", "Lerato Dlamini", "", "", "-26.0186", "28.0089", 125000, "Gauteng"],
    ["1002", "Spar Rivonia", "INDEPENDENT", "R01", "Thabo Mokoena", "", "", "", "", "-26.0575", "28.0605", 48000, "Gauteng"],
  ],
  notes: [
    ["PLACE ID", "Required. Unique per store — this is the merge key, so re-uploading the same ID updates that store instead of adding a duplicate."],
    ["PLACE NAME", "Required. Rows missing PLACE ID or PLACE NAME are skipped."],
    ["CHANNEL", "Channel name. Created automatically if it does not exist yet (defaults: monthly, 30 min) — set the real frequency and duration afterwards in Channels."],
    ["REPRESENTATIVE ID", "The PRIMARY rep's code. Created automatically if unknown, with blank contact details — fill those in under Reps."],
    ["REPRESENTATIVE NAME", "Only used when the rep code is new."],
    ["SECONDARY REPRESENTATIVE ID", "Optional second rep on the store. Leave blank where there is only one. Also created automatically if unknown."],
    ["SECONDARY REPRESENTATIVE NAME", "Only used when that rep code is new."],
    ["THIRD REPRESENTATIVE ID", "Optional third rep. Leave blank unless the store genuinely has three."],
    ["THIRD REPRESENTATIVE NAME", "Only used when that rep code is new."],
    ["GPS LATITUDE", "Decimal degrees, negative for South Africa (e.g. -26.0186). Needed for routing and the map."],
    ["GPS LONGITUDE", "Decimal degrees (e.g. 28.0089)."],
    ["MONTHLY AVERAGE", "Monthly sales value. Currency symbols and spaces are stripped; blank counts as 0."],
    ["REGION", "Optional free-text region. Province is derived separately from GPS."],
    ["", ""],
    ["Accepted aliases", "PLACE ID / STORE ID · PLACE NAME / STORE NAME · REPRESENTATIVE ID / REP CODE · SECONDARY REPRESENTATIVE ID / REP CODE 2 / REPRESENTATIVE ID 2 · THIRD REPRESENTATIVE ID / REP CODE 3 / REPRESENTATIVE ID 3 · MONTHLY AVERAGE / VALUE / SALES · REGION / PROVINCE / AREA · LATITUDE / LONGITUDE. Header matching ignores case and surrounding spaces."],
    ["Secondary and third reps", "These are recorded against the store, but route generation, rep capacity and the map still work off the PRIMARY rep only. Confirm how a secondary rep should be treated before relying on it."],
    ["Delete the example rows", "The two sample rows are illustration only — clear them before uploading."],
  ],
};

const PERIGEE: Variant = {
  label: "Perigee site export",
  filename: "Store_Upload_Template_Perigee",
  headers: [
    "ID",
    "Name",
    "Representative ID",
    "Representative name",
    "Representative ID 2",
    "Representative name 2",
    "Representative ID 3",
    "Representative name 3",
    "Gps latitude",
    "Gps longitude",
    "State",
    "Tags",
  ],
  widths: [16, 34, 20, 26, 22, 26, 22, 26, 16, 16, 20, 30],
  examples: [
    ["1001", "Checkers Fourways", "R01", "Thabo Mokoena", "R02", "Lerato Dlamini", "", "", "-26.0186", "28.0089", "Gauteng", "RETAIL','GAUTENG"],
    ["1002", "Spar Rivonia", "R01", "Thabo Mokoena", "", "", "", "", "-26.0575", "28.0605", "Gauteng", "INDEPENDENT','GAUTENG"],
  ],
  notes: [
    ["Why this variant exists", "The uploader switches to this layout only when the file has all three headers ID, Name and Representative ID spelled exactly like that. Renaming any of them sends the file down the Standard path instead."],
    ["ID", "Required. The store's Perigee site ID — used as the merge key."],
    ["Name", "Required. Rows missing ID or Name are skipped."],
    ["Representative ID", "The PRIMARY rep code. Created automatically if unknown."],
    ["Representative name", "Only used when the rep code is new."],
    ["Representative ID 2 / 3", "Optional second and third reps on the store. Leave blank where they do not apply. Recorded against the store, but routing, capacity and the map still use the PRIMARY rep only."],
    ["Gps latitude", "Decimal degrees, negative for South Africa."],
    ["Gps longitude", "Decimal degrees."],
    ["State", "Region. \"Territory\" is accepted as an alias."],
    ["Tags", "Channel comes from the FIRST tag — e.g. \"RETAIL','GAUTENG\" gives channel RETAIL. Tags split on commas and apostrophes."],
    ["No sales column", "This layout has no monthly value, so every store imports at 0 — load values via the Standard template if you need them."],
    ["Unconfirmed", "These headers were carried over from the Repsly Places export and have not been checked against a real Perigee file. Send one through and this template will be corrected."],
  ],
};

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const format = request.nextUrl.searchParams.get("format") === "perigee" ? "perigee" : "standard";
    const variant = format === "perigee" ? PERIGEE : STANDARD;

    const ws = XLSX.utils.aoa_to_sheet([variant.headers, ...variant.examples]);
    ws["!cols"] = variant.widths.map((wch) => ({ wch }));

    const notesWs = XLSX.utils.aoa_to_sheet([["Column", "Notes"], ...variant.notes]);
    notesWs["!cols"] = [{ wch: 26 }, { wch: 110 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stores");
    XLSX.utils.book_append_sheet(wb, notesWs, "Notes");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${variant.filename}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Store template error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
