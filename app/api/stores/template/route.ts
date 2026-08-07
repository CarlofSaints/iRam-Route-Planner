import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getVisitRoles } from "@/lib/data";
import { storeRoleColumns, VisitRole } from "@/lib/types";
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

/**
 * The Standard template, built around whatever visit roles exist right now.
 *
 * The old fixed SECONDARY/THIRD pair is gone: two slots could not hold three
 * non-primary roles, and neither slot said which role it was for, so the same
 * column meant a different thing on every row. There is now one ID/NAME pair
 * per non-primary role, and adding a role on the Visit Roles page adds its
 * columns here automatically.
 */
function buildStandard(roles: VisitRole[]): Variant {
  const extraRoles = roles.filter((r) => !r.isPrimary);
  const primaryName = roles.find((r) => r.isPrimary)?.name || "Sales Rep";

  const headers = [
    "PLACE ID",
    "PLACE NAME",
    "CHANNEL",
    "REPRESENTATIVE ID",
    "REPRESENTATIVE NAME",
    ...extraRoles.flatMap((r) => {
      const c = storeRoleColumns(r);
      return [c.id, c.name];
    }),
    "GPS LATITUDE",
    "GPS LONGITUDE",
    "REGION",
  ];

  const widths = [
    16, 34, 20, 20, 26,
    ...extraRoles.flatMap((r) => [Math.max(14, r.name.length + 5), Math.max(20, r.name.length + 8)]),
    16, 16, 20,
  ];

  // Only the first role is filled in on the sample rows — the point being that
  // these columns are optional and independent, not a set you must complete.
  const blanksForRoles = extraRoles.flatMap(() => ["", ""]);
  const firstRoleFilled = extraRoles.flatMap((_, i) =>
    i === 0 ? ["R09", "Lerato Dlamini"] : ["", ""]
  );

  const examples: (string | number)[][] = [
    ["1001", "Checkers Fourways", "RETAIL", "R01", "Thabo Mokoena", ...firstRoleFilled, "-26.0186", "28.0089", "Gauteng"],
    ["1002", "Spar Rivonia", "INDEPENDENT", "R01", "Thabo Mokoena", ...blanksForRoles, "-26.0575", "28.0605", "Gauteng"],
  ];

  const notes: [string, string][] = [
    ["PLACE ID", "Required. Unique per store — this is the merge key, so re-uploading the same ID updates that store instead of adding a duplicate."],
    ["PLACE NAME", "Required. Rows missing PLACE ID or PLACE NAME are skipped."],
    ["CHANNEL", "Channel name, matched ignoring case and surrounding spaces. Created automatically if it does not exist yet (defaults: monthly, 30 min) — set the real frequency and duration afterwards in Channels."],
    ["REPRESENTATIVE ID", `The ${primaryName}'s code — the rep this store belongs to. Routing, capacity and the map all work off this one. Created automatically if unknown, with blank contact details.`],
    ["REPRESENTATIVE NAME", "Only used when the rep code is new."],
  ];

  if (extraRoles.length === 0) {
    notes.push([
      "No other visit roles",
      "Only the primary role exists, so there are no extra rep columns. Create roles under Visit Roles and they will appear here.",
    ]);
  } else {
    for (const r of extraRoles) {
      const c = storeRoleColumns(r);
      notes.push([
        c.id,
        `The rep who does ${r.name} calls at this store. Optional — leave blank where ${r.name} does not call here. They get their OWN route at ${r.name}'s frequency and duration, not a ride-along with the ${primaryName}. A rep code that does not exist yet is created and set to ${r.name}.`,
      ]);
      notes.push([c.name, "Only used when that rep code is new."]);
    }
  }

  notes.push(
    ["GPS LATITUDE", "Decimal degrees, negative for South Africa (e.g. -26.0186). Needed for routing and the map."],
    ["GPS LONGITUDE", "Decimal degrees (e.g. 28.0089)."],
    ["REGION", "Optional free-text region. Province is derived separately from GPS."],
    ["", ""],
    ["One column per role", "These columns come from the Visit Roles page. Rename a role and its columns are renamed here too — so re-download this template after any change there, or an older file will no longer match."],
    ["A role is set on the PERSON", "A rep performs one role everywhere. If you put someone in a role's column who is set to a different role under Reps, the upload reports it rather than silently changing how they are planned."],
    ["Columns left out are left alone", "A column this file does not contain is not touched on stores that already exist. A column that IS present but blank clears that value — that is how you remove a rep from a role."],
    ["Older files", "SECONDARY / THIRD REPRESENTATIVE ID are still accepted for backwards compatibility, but they cannot say which role they mean. Use the role columns."],
    ["Delete the example rows", "The two sample rows are illustration only — clear them before uploading."]
  );

  return { label: "Standard", filename: "Store_Upload_Template", headers, widths, examples, notes };
}

/**
 * The Perigee site-export layout, with the same per-role columns appended.
 *
 * The role columns are read from the file's headers regardless of which layout
 * the uploader detects, so they work here exactly as they do in Standard.
 * Perigee itself will never emit them — they are ours, added to the end so a
 * real Perigee export can be opened, have its role columns filled in and be
 * uploaded without rearranging anything.
 */
function buildPerigee(roles: VisitRole[]): Variant {
  const extraRoles = roles.filter((r) => !r.isPrimary);

  const headers = [
    "ID",
    "Name",
    "Representative ID",
    "Representative name",
    "Gps latitude",
    "Gps longitude",
    "State",
    "Tags",
    ...extraRoles.flatMap((r) => {
      const c = storeRoleColumns(r);
      return [c.id, c.name];
    }),
  ];

  const widths = [
    16, 34, 20, 26, 16, 16, 20, 30,
    ...extraRoles.flatMap((r) => [Math.max(14, r.name.length + 5), Math.max(20, r.name.length + 8)]),
  ];

  const blanks = extraRoles.flatMap(() => ["", ""]);
  const firstFilled = extraRoles.flatMap((_, i) => (i === 0 ? ["R09", "Lerato Dlamini"] : ["", ""]));

  const examples: (string | number)[][] = [
    ["1001", "Checkers Fourways", "R01", "Thabo Mokoena", "-26.0186", "28.0089", "Gauteng", "RETAIL','GAUTENG", ...firstFilled],
    ["1002", "Spar Rivonia", "R01", "Thabo Mokoena", "-26.0575", "28.0605", "Gauteng", "INDEPENDENT','GAUTENG", ...blanks],
  ];

  const notes: [string, string][] = [
    ["Why this variant exists", "The uploader switches to this layout only when the file has all three headers ID, Name and Representative ID spelled exactly like that. Renaming any of them sends the file down the Standard path instead."],
    ["ID", "Required. The store's Perigee site ID — used as the merge key."],
    ["Name", "Required. Rows missing ID or Name are skipped."],
    ["Representative ID", "The PRIMARY rep code. Created automatically if unknown."],
    ["Representative name", "Only used when the rep code is new."],
    ["Gps latitude", "Decimal degrees, negative for South Africa."],
    ["Gps longitude", "Decimal degrees."],
    ["State", "Region. \"Territory\" is accepted as an alias."],
    ["Tags", "Channel comes from the FIRST tag — e.g. \"RETAIL','GAUTENG\" gives channel RETAIL. Tags split on commas and apostrophes. Channel names are matched ignoring case."],
  ];

  for (const r of extraRoles) {
    const c = storeRoleColumns(r);
    notes.push([
      c.id,
      `The rep who does ${r.name} calls at this store. Not part of a Perigee export — added here so roles can be set from this layout too. Optional; leave blank where ${r.name} does not call.`,
    ]);
    notes.push([c.name, "Only used when that rep code is new."]);
  }

  notes.push(
    ["", ""],
    ["Which template do I want?", "Standard, unless you are starting from a file Perigee produced. The two differ only in what the first few columns are called — the role columns are identical in both, and both end up in the same place."],
    ["Unconfirmed", "The Perigee column names here were carried over from the Repsly Places export and have NOT been checked against a real Perigee file. Send one through and this template will be corrected."],
    ["Delete the example rows", "The two sample rows are illustration only — clear them before uploading."]
  );

  return { label: "Perigee site export", filename: "Store_Upload_Template_Perigee", headers, widths, examples, notes };
}

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const format = request.nextUrl.searchParams.get("format") === "perigee" ? "perigee" : "standard";
    const roles = await getVisitRoles();
    const variant = format === "perigee" ? buildPerigee(roles) : buildStandard(roles);

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
        // The role columns change whenever a role is added or renamed, so this
        // download must never be served from a browser's heuristic cache.
        "Cache-Control": "no-store, must-revalidate",
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
