import { NextRequest, NextResponse } from "next/server";
import { getReps, saveReps, getTeams, getVisitRoles } from "@/lib/data";
import { Rep } from "@/lib/types";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Import the edited rep list produced by /api/reps/export.
 *
 * Reps are matched on Rep Code, which is the key stores are allocated by
 * (Store.repCode). A row with an unknown code creates a rep; a row with a
 * known code updates it. The code itself is never rewritten from a file —
 * changing it would silently detach every store allocated to that rep.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission("import_reps");

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const dryRun = formData.get("dryRun") === "true";

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);

    if (rows.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    const [reps, teams, visitRoles] = await Promise.all([
      getReps(),
      getTeams(),
      getVisitRoles(),
    ]);

    const byCode = new Map(reps.map((r) => [r.code.toLowerCase().trim(), r]));
    const teamByName = new Map(teams.map((t) => [t.name.toLowerCase().trim(), t]));
    const roleByName = new Map(visitRoles.map((r) => [r.name.toLowerCase().trim(), r]));

    // Header lookup that tolerates case and stray whitespace, matching the
    // store and channel importers.
    const col = (row: Record<string, string | number>, ...keys: string[]) => {
      const trimmed = Object.entries(row).map(([k, v]) => [k.trim(), v] as const);
      for (const k of keys) {
        const entry = trimmed.find(([tk]) => tk.toLowerCase() === k.toLowerCase());
        if (entry !== undefined && entry[1] !== undefined && entry[1] !== "") {
          return String(entry[1]).trim();
        }
      }
      return "";
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNo = i + 2; // +1 for the header, +1 for 1-based rows

      const code = col(row, "Rep Code", "Code", "Rep_Code", "RepCode");
      if (!code) {
        // A blank trailing row is normal in Excel — only complain if the row
        // actually carries data.
        if (Object.values(row).some((v) => String(v ?? "").trim() !== "")) {
          errors.push(`Row ${rowNo}: missing Rep Code`);
        }
        skipped++;
        continue;
      }

      const name = col(row, "Rep Name", "Name", "Full Name");
      const email = col(row, "Email", "Email Address", "E-mail");
      const cell = col(row, "Cell Number", "Cell", "Mobile", "Phone", "Contact Number");
      const homeAddress = col(row, "Home Address", "Address", "Home");
      const hoursRaw = col(row, "Hours/Day", "Hours Per Day", "HoursPerDay", "Working Hours");
      const teamRaw = col(row, "Team", "Team Name");
      const roleRaw = col(row, "Visit Role", "Role", "VisitRole");

      let workingHoursPerDay: number | undefined;
      if (hoursRaw) {
        const n = Number(hoursRaw);
        if (isNaN(n) || n <= 0 || n > 24) {
          errors.push(`Row ${rowNo}: invalid Hours/Day "${hoursRaw}"`);
          continue;
        }
        workingHoursPerDay = n;
      }

      // Teams and visit roles are referenced by name in the sheet. An unknown
      // name is rejected rather than quietly dropped — silently leaving a rep
      // unassigned is exactly the kind of "it didn't save" this app has form for.
      let teamId: string | undefined;
      if (teamRaw) {
        const team = teamByName.get(teamRaw.toLowerCase().trim());
        if (!team) {
          errors.push(
            `Row ${rowNo}: unknown Team "${teamRaw}" — create it on the Teams page first`
          );
          continue;
        }
        teamId = team.id;
      }

      let visitRoleId: string | undefined;
      if (roleRaw) {
        const role = roleByName.get(roleRaw.toLowerCase().trim());
        if (!role) {
          errors.push(
            `Row ${rowNo}: unknown Visit Role "${roleRaw}" — options are ${visitRoles.map((r) => r.name).join(", ")}`
          );
          continue;
        }
        visitRoleId = role.isPrimary ? undefined : role.id;
      }

      const existing = byCode.get(code.toLowerCase().trim());

      if (existing) {
        if (name) existing.name = name;
        if (email) existing.email = email;
        if (cell) existing.cell = cell;
        if (homeAddress) existing.homeAddress = homeAddress;
        if (workingHoursPerDay !== undefined) existing.workingHoursPerDay = workingHoursPerDay;
        // Blank Team clears the assignment — that is how you unassign in bulk.
        if (teamRaw) existing.teamId = teamId!;
        else existing.teamId = "";
        if (roleRaw) existing.visitRoleId = visitRoleId;
        else existing.visitRoleId = undefined;
        updated++;
      } else {
        const rep: Rep = {
          id: crypto.randomUUID(),
          code,
          name: name || code,
          email,
          cell,
          homeAddress,
          homeGpsLat: "",
          homeGpsLng: "",
          teamId: teamId || "",
          ...(workingHoursPerDay !== undefined ? { workingHoursPerDay } : {}),
          ...(visitRoleId ? { visitRoleId } : {}),
        };
        reps.push(rep);
        byCode.set(code.toLowerCase().trim(), rep);
        created++;
      }
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        created,
        updated,
        skipped,
        errors,
        totalRows: rows.length,
      });
    }

    if (created > 0 || updated > 0) {
      await saveReps(reps);
      logActivity({
        action: "Imported reps",
        actor: session.email,
        actorName: session.name || session.email,
        summary: `Imported rep list: ${created} created, ${updated} updated`,
        details: errors.length ? `${errors.length} row(s) rejected` : undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      created,
      updated,
      skipped,
      errors,
      totalRows: rows.length,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (String(err).includes("Forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Reps import error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
