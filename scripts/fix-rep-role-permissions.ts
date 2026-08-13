/**
 * Strip the stale view permissions off the LIVE `rep` role.
 *
 * Why a script and not a code change: `getRolePermissions()` reads the saved
 * role blob and only backfills roles that are MISSING from it, so editing
 * ROLE_DEFINITIONS changes nothing on a deployment that has already saved its
 * roles. This one has. Every other approach to "change an existing role's
 * defaults" is a no-op in production.
 *
 * Nothing depends on this for safety — the middleware refuses a rep every path
 * outside their own profile regardless of what the permission grid says. This
 * exists so the Roles page stops advertising view_dashboard / view_map /
 * view_routes for a role that cannot reach any of them.
 *
 *   npx tsx --env-file=.env.local scripts/fix-rep-role-permissions.ts          (dry run)
 *   npx tsx --env-file=.env.local scripts/fix-rep-role-permissions.ts --apply  (writes)
 *
 * ⚠️ Reads and writes the LIVE Blob store. There is no local copy.
 */

import { getRolePermissions, saveRolePermissions } from "../lib/data";

const apply = process.argv.includes("--apply");

async function main() {
  const perms = await getRolePermissions();
  const rep = perms.find((p) => p.role === "rep");

  if (!rep) {
    console.log("No `rep` role in the saved grid — nothing to do.");
    return;
  }

  console.log(`Current rep permissions: ${rep.permissions.length ? rep.permissions.join(", ") : "(none)"}`);

  if (rep.permissions.length === 0) {
    console.log("Already empty — nothing to do.");
    return;
  }

  if (!apply) {
    console.log(`\nDRY RUN. Would remove all ${rep.permissions.length} permissions from the rep role.`);
    console.log("Re-run with --apply to write it.");
    return;
  }

  rep.permissions = [];
  rep.description = "Maintain their own profile and home address. No access to routes, stores or reports.";
  await saveRolePermissions(perms);

  // Read back rather than trusting the write — a stale read here is a known
  // failure mode of this blob store, so an inconclusive result is not a pass.
  const after = (await getRolePermissions()).find((p) => p.role === "rep");
  console.log(`\nWritten. Rep permissions now: ${after?.permissions.length ? after.permissions.join(", ") : "(none)"}`);
  if (after?.permissions.length) {
    console.error("⚠️ The read-back still shows permissions. Re-run to confirm before assuming it failed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
