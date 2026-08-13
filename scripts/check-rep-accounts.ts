/**
 * Assertions for rep logins and the gate around them.
 *
 * Run: npx tsx scripts/check-rep-accounts.ts
 *
 * The path allow-list is the part worth testing hardest. It is the only thing
 * standing between a rep session and every store, route and rep record in the
 * business — the pages that "filter by repCode" do so in the browser, over an
 * API that hands back everything.
 */

import { isRepAllowedPath } from "../lib/repAccess";
import { generateTempPassword } from "../lib/tempPassword";
import { buildWelcomeEmail } from "../lib/welcomeEmail";
import { ROLE_DEFINITIONS, ALL_PERMISSIONS } from "../lib/types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

// ---------- the allow-list ----------

assert(isRepAllowedPath("/account"), "a rep may open their profile");
assert(isRepAllowedPath("/api/account"), "a rep may read their profile");
assert(isRepAllowedPath("/api/account/rep-profile"), "a rep may save their home address");
assert(isRepAllowedPath("/api/account/avatar"), "a rep may change their photo");
assert(isRepAllowedPath("/api/auth"), "a rep may sign out");
assert(isRepAllowedPath("/api/auth/change-password"), "a rep may set their password on first sign-in");
assert(isRepAllowedPath("/login"), "a rep may reach the login page");

assert(!isRepAllowedPath("/"), "a rep may NOT open the dashboard");
assert(!isRepAllowedPath("/reps"), "a rep may NOT open the rep list");
assert(!isRepAllowedPath("/stores"), "a rep may NOT open the store list");
assert(!isRepAllowedPath("/routes"), "a rep may NOT open routes");
assert(!isRepAllowedPath("/map"), "a rep may NOT open the map");
assert(!isRepAllowedPath("/capacity"), "a rep may NOT open capacity");
assert(!isRepAllowedPath("/admin"), "a rep may NOT open user admin");
assert(!isRepAllowedPath("/api/reps"), "a rep may NOT read every rep");
assert(!isRepAllowedPath("/api/stores"), "a rep may NOT read every store");
assert(!isRepAllowedPath("/api/routes"), "a rep may NOT read every route");
assert(!isRepAllowedPath("/api/users"), "a rep may NOT read the user table");
assert(!isRepAllowedPath("/api/reps/create-account"), "a rep may NOT mint logins");
assert(!isRepAllowedPath("/api/reps/geocode"), "a rep may NOT run the bulk geocoder");

// Prefix matching must respect path segments. A plain startsWith would let all
// three of these through on the strength of the "/account" entry.
assert(!isRepAllowedPath("/accounts"), "a rep may NOT reach /accounts");
assert(!isRepAllowedPath("/account-admin"), "a rep may NOT reach /account-admin");
assert(!isRepAllowedPath("/api/accounts-payable"), "a rep may NOT reach a route merely prefixed with /api/account");

// ---------- role definition ----------

const repRole = ROLE_DEFINITIONS.find((r) => r.role === "rep");
assert(!!repRole, "the rep role still exists");
assert(repRole?.permissions.length === 0, "the rep role grants no permissions");

const permKeys = ALL_PERMISSIONS.map((p) => p.key);
assert(permKeys.includes("create_rep_accounts"), "create_rep_accounts is a real permission key");

// It has to be grantable to Admins — the whole point is that creating rep
// logins does not require manage_users, which only superAdmins hold.
const adminRole = ROLE_DEFINITIONS.find((r) => r.role === "admin");
assert(!!adminRole?.permissions.includes("create_rep_accounts"), "Admins may create rep logins");
assert(!adminRole?.permissions.includes("manage_users"), "Admins still may NOT manage users generally");

// ---------- temporary passwords ----------

const passwords = Array.from({ length: 500 }, () => generateTempPassword());
assert(new Set(passwords).size === 500, "500 generated passwords are all distinct");
assert(passwords.every((p) => p.startsWith("iRam-")), "every password is recognisably ours");
assert(passwords.every((p) => p.length === 14), "every password is a consistent length");
assert(
  passwords.every((p) => !/[0O1lI]/.test(p.slice(5))),
  "no password contains characters people mistype (0 O 1 l I)"
);

// ---------- the welcome email ----------

const repMail = buildWelcomeEmail({
  name: "Thabo Nkosi",
  email: "thabo@iram.co.za",
  password: "iRam-K7fQ-mX3T",
  forcePasswordChange: true,
  audience: "rep",
});

assert(repMail.subject.includes("home address"), "a rep's subject line says what it wants from them");
assert(repMail.html.includes("Use my current location"), "the rep email names the button that pins their home");
assert(repMail.text.includes("Use my current location"), "the plain-text alternative says it too");
assert(repMail.html.includes("/account"), "the rep email links straight to their profile");
assert(repMail.html.includes("iRam-K7fQ-mX3T"), "the rep email carries the password");
assert(repMail.text.includes("iRam-K7fQ-mX3T"), "the plain-text alternative carries the password");

const adminMail = buildWelcomeEmail({
  name: "Grant Berridge",
  email: "grant@iram.co.za",
  password: "iRam-K7fQ-mX3T",
  forcePasswordChange: true,
});

// The original wording has to survive untouched for everyone who is not a rep.
assert(adminMail.subject === "Welcome to iRam Route Planner", "the admin subject line is unchanged");
assert(!adminMail.html.includes("Use my current location"), "the admin email has no rep instructions");
assert(
  adminMail.html.includes("where call cycles, rep journeys and store allocations are planned"),
  "the admin email keeps its original description"
);

// A name carrying markup must not be able to break out of the HTML.
const hostile = buildWelcomeEmail({
  name: '<script>alert("x")</script>',
  email: "x@y.co.za",
  password: "iRam-K7fQ-mX3T",
  forcePasswordChange: true,
  audience: "rep",
});
assert(!hostile.html.includes("<script>"), "a name containing markup is escaped");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
