/**
 * The Channels spreadsheet's per-role columns.
 *
 * Visit roles never reached the Channels export, so a role created on the Visit
 * Roles page was invisible in the file and could only ever be set one cell at a
 * time in the browser. The export now writes three columns per non-primary role
 * and the importer reads them back.
 *
 * The rule this file exists to protect: the export fills EVERY role cell in,
 * including the ones a channel is only inheriting. Re-importing an unedited
 * file must therefore leave those channels still inheriting — if it pinned them
 * to today's numbers, editing a role on the Visit Roles page would silently
 * stop reaching any channel that had ever been through a round trip.
 *
 * Run: npx tsx scripts/check-channel-role-columns.ts
 */
import { resolveRoleDefault, roleCallsOnChannel, roleDefaultFor, withRoleEnabled } from "../lib/repStores";
import { Channel, VisitRole, roleColumns } from "../lib/types";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
  }
}

const SALES: VisitRole = { id: "sales", name: "Sales Rep", frequency: "monthly", duration: 30, isPrimary: true, checkOutliers: true };
const QC: VisitRole = { id: "qc", name: "QC", frequency: "quarterly", duration: 60, isPrimary: false, checkOutliers: false };
const MERCH: VisitRole = { id: "merch", name: "Merchandiser", frequency: "daily", duration: 480, isPrimary: false, checkOutliers: false };
const ROLES = [SALES, QC, MERCH];
const EXTRA = ROLES.filter((r) => !r.isPrimary);

console.log("Channels spreadsheet: per-role columns\n");

// ---- column naming is one definition, shared both ways ----
check("a role's three column names", roleColumns(QC), {
  calls: "QC Calls",
  frequency: "QC Frequency",
  duration: "QC Duration (min)",
});
check("renaming the role renames its columns", roleColumns({ ...QC, name: "Quality Check" }).frequency, "Quality Check Frequency");

// ---- the export/import round trip ----

/** What the export writes for one channel — every cell filled in. */
const exportRow = (ch: Channel) => {
  const row: Record<string, string | number> = {
    "Channel Name": ch.name,
    Frequency: ch.frequency,
    "Duration (min)": ch.duration,
  };
  for (const role of EXTRA) {
    const c = roleColumns(role);
    const eff = resolveRoleDefault(ch, role);
    row[c.calls] = roleCallsOnChannel(ch, role) ? "Yes" : "No";
    row[c.frequency] = eff.frequency;
    row[c.duration] = eff.duration;
  }
  return row;
};

/** The importer's rule, applied to one row. Mirrors app/api/channels/import. */
const importRow = (ch: Channel, row: Record<string, string | number>): Channel => {
  const next: Channel = { ...ch, roleDefaults: { ...(ch.roleDefaults ?? {}) } };
  for (const role of EXTRA) {
    const c = roleColumns(role);
    const effective = resolveRoleDefault(next, role);
    const freq = row[c.frequency] ? String(row[c.frequency]) : effective.frequency;
    const dur = row[c.duration] !== undefined && row[c.duration] !== "" ? Number(row[c.duration]) : effective.duration;
    const calls = row[c.calls] === undefined || row[c.calls] === ""
      ? roleCallsOnChannel(next, role)
      : String(row[c.calls]).toLowerCase() !== "no";
    const entry = roleDefaultFor(role, freq as Channel["frequency"], dur, calls);
    if (entry) next.roleDefaults![role.id] = entry;
    else delete next.roleDefaults![role.id];
  }
  return next;
};

const INHERITING: Channel = { id: "mica", name: "Mica", frequency: "monthly", duration: 45 };
const OVERRIDDEN: Channel = {
  id: "makro",
  name: "Makro",
  frequency: "daily",
  duration: 480,
  roleDefaults: { qc: { frequency: "monthly", duration: 240 } },
};
const SWITCHED_OFF: Channel = {
  id: "forecourt",
  name: "Forecourt",
  frequency: "monthly",
  duration: 20,
  roleDefaults: { merch: { frequency: "daily", duration: 480, enabled: false } },
};

// THE regression guard.
check(
  "an inheriting channel round-trips unedited and is STILL inheriting",
  importRow(INHERITING, exportRow(INHERITING)).roleDefaults,
  {}
);
check(
  "an overridden channel round-trips unedited with its override intact",
  importRow(OVERRIDDEN, exportRow(OVERRIDDEN)).roleDefaults,
  { qc: { frequency: "monthly", duration: 240 } }
);
check(
  "a switched-off role round-trips unedited and stays off",
  importRow(SWITCHED_OFF, exportRow(SWITCHED_OFF)).roleDefaults,
  { merch: { frequency: "daily", duration: 480, enabled: false } }
);

// ---- edits in the file actually land ----
const editedFreq = { ...exportRow(INHERITING), "QC Frequency": "monthly" };
check(
  "changing a frequency cell pins that channel",
  importRow(INHERITING, editedFreq).roleDefaults,
  { qc: { frequency: "monthly", duration: 60 } }
);

const switchedOffInFile = { ...exportRow(INHERITING), "Merchandiser Calls": "No" };
check(
  "typing No in a Calls cell switches the role off",
  importRow(INHERITING, switchedOffInFile).roleDefaults,
  { merch: { frequency: "daily", duration: 480, enabled: false } }
);

const switchedBackOn = { ...exportRow(SWITCHED_OFF), "Merchandiser Calls": "Yes" };
check(
  "typing Yes switches it back on, and back to inheriting",
  importRow(SWITCHED_OFF, switchedBackOn).roleDefaults,
  {}
);

// A sheet from before this change carries no role columns at all. It must not
// touch what is already there.
const oldFile = { "Channel Name": "Makro", Frequency: "daily", "Duration (min)": 480 };
check(
  "an older file with no role columns leaves roleDefaults alone",
  importRow(OVERRIDDEN, oldFile).roleDefaults,
  { qc: { frequency: "monthly", duration: 240 } }
);

// ---- the grid's switch writes the same shape the importer does ----
check(
  "switching off from the grid matches switching off from the file",
  withRoleEnabled(INHERITING.roleDefaults, MERCH, false),
  { merch: { frequency: "daily", duration: 480, enabled: false } }
);
check(
  "switching back on from the grid returns to inheriting, not a pinned copy",
  withRoleEnabled(SWITCHED_OFF.roleDefaults, MERCH, true),
  {}
);
check(
  "switching on a role that had real overrides keeps them",
  withRoleEnabled({ qc: { frequency: "weekly", duration: 15, enabled: false } }, QC, true),
  { qc: { frequency: "weekly", duration: 15 } }
);
check(
  "switching one role off leaves the others untouched",
  withRoleEnabled(OVERRIDDEN.roleDefaults, MERCH, false),
  {
    qc: { frequency: "monthly", duration: 240 },
    merch: { frequency: "daily", duration: 480, enabled: false },
  }
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
