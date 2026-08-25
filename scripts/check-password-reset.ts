/**
 * Assertions for self-service password reset.
 *
 * Run: npx tsx scripts/check-password-reset.ts
 *
 * These are the properties that make a public, unauthenticated reset route safe
 * to expose. Each one is a way the feature could be built wrong while still
 * appearing to work perfectly in a manual test.
 */

import {
  buildResetRecord,
  findResetRecord,
  generateResetToken,
  hashResetToken,
  invalidateFor,
  isThrottled,
  passwordProblem,
  pruneResets,
  PasswordResetRecord,
  RESET_TTL_MINUTES,
  RESET_THROTTLE_SECONDS,
} from "../lib/passwordReset";
import { isRepAllowedPath } from "../lib/repAccess";
import { isPublicPath, PUBLIC_EXACT } from "../lib/publicPaths";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const NOW = new Date("2026-08-25T12:00:00.000Z");
const later = (mins: number) => new Date(NOW.getTime() + mins * 60_000);

console.log("\n--- the token itself ---\n");

{
  const t = generateResetToken();
  ok("a token is long enough to be unguessable", t.length >= 40, `length ${t.length}`);
  ok("it is url-safe, so it survives being a query parameter", /^[A-Za-z0-9_-]+$/.test(t));
  const many = new Set(Array.from({ length: 500 }, generateResetToken));
  eq("500 tokens are 500 different tokens", many.size, 500);
}

{
  const t = generateResetToken();
  const rec = buildResetRecord("u1", "Rep@Clippasales.com", t, NOW);
  ok("the raw token is NEVER stored", !JSON.stringify(rec).includes(t));
  eq("only its hash is", rec.tokenHash, hashResetToken(t));
  eq("the email is normalised for lookup", rec.email, "rep@clippasales.com");
  eq("expiry is the documented window", rec.expiresAt, later(RESET_TTL_MINUTES).toISOString());
  eq("a fresh record is unused", rec.usedAt, undefined);
}

console.log("\n--- what a link will and will not open ---\n");

{
  const t = generateResetToken();
  const records = [buildResetRecord("u1", "a@b.com", t, NOW)];

  const good = findResetRecord(records, t, later(30));
  ok("a valid token inside the window works", good.ok);

  const wrong = findResetRecord(records, generateResetToken(), later(1));
  eq("an unrelated token is refused", wrong.ok ? "accepted" : wrong.reason, "unknown");

  const expired = findResetRecord(records, t, later(RESET_TTL_MINUTES + 1));
  eq("an expired token is refused", expired.ok ? "accepted" : expired.reason, "expired");

  const onTheDot = findResetRecord(records, t, later(RESET_TTL_MINUTES));
  eq("expiry is not inclusive: exactly at the deadline is refused", onTheDot.ok ? "accepted" : onTheDot.reason, "expired");

  const spent = records.map((r) => ({ ...r, usedAt: later(5).toISOString() }));
  const reused = findResetRecord(spent, t, later(10));
  eq("a token cannot be spent twice", reused.ok ? "accepted" : reused.reason, "used");
}

{
  // The reason a hash is stored rather than the token: reading the store must
  // not be enough to mint a link.
  const t = generateResetToken();
  const rec = buildResetRecord("u1", "a@b.com", t, NOW);
  const fromStoredHash = findResetRecord([rec], rec.tokenHash, later(1));
  ok("presenting the stored HASH as if it were the token does not work", !fromStoredHash.ok);
}

console.log("\n--- one live link per account ---\n");

{
  const t1 = generateResetToken();
  const t2 = generateResetToken();
  let records: PasswordResetRecord[] = [buildResetRecord("u1", "a@b.com", t1, NOW)];
  records = [...invalidateFor(records, "u1", later(2)), buildResetRecord("u1", "a@b.com", t2, later(2))];

  ok("asking again retires the earlier link", !findResetRecord(records, t1, later(3)).ok);
  ok("the newest link works", findResetRecord(records, t2, later(3)).ok);
}

{
  const records = [buildResetRecord("u1", "a@b.com", generateResetToken(), NOW)];
  ok("a second request inside the throttle window is refused", isThrottled(records, "a@b.com", later(0.5)));
  ok("...case-insensitively", isThrottled(records, "A@B.COM", later(0.5)));
  ok(
    "...but allowed once the window passes",
    !isThrottled(records, "a@b.com", new Date(NOW.getTime() + (RESET_THROTTLE_SECONDS + 1) * 1000))
  );
  ok("a different account is not throttled by someone else's request", !isThrottled(records, "other@b.com", later(0.5)));
  const spent = records.map((r) => ({ ...r, usedAt: NOW.toISOString() }));
  ok("a link that was already used does not throttle a new request", !isThrottled(spent, "a@b.com", later(0.5)));
}

console.log("\n--- housekeeping ---\n");

{
  const fresh = buildResetRecord("u1", "a@b.com", generateResetToken(), NOW);
  const old = buildResetRecord("u2", "b@b.com", generateResetToken(), new Date(NOW.getTime() - 48 * 60 * 60_000));
  const kept = pruneResets([fresh, old], NOW);
  eq("stale records are dropped so the store cannot grow forever", kept.length, 1);
  eq("...and the live one survives", kept[0].userId, "u1");
}

{
  const justExpired = buildResetRecord("u1", "a@b.com", generateResetToken(), new Date(NOW.getTime() - 2 * 60 * 60_000));
  eq(
    "a recently expired record is kept a while, so 'expired' can still be reported",
    pruneResets([justExpired], NOW).length,
    1
  );
}

console.log("\n--- the password it will accept ---\n");

eq("a short password is refused", !!passwordProblem("ab1"), true);
eq("letters only is refused", !!passwordProblem("abcdefgh"), true);
eq("digits only is refused", !!passwordProblem("12345678"), true);
eq("an empty password is refused", !!passwordProblem(""), true);
eq("a reasonable password is accepted", passwordProblem("clippa2026"), null);
eq("a long passphrase is accepted", passwordProblem("my dog has 4 legs and a tail"), null);
ok("an absurdly long one is refused", !!passwordProblem("a1".repeat(200)));

console.log("\n--- reachable without a session ---\n");

// Asserted against the list the middleware actually uses, not a copy of it.
for (const path of [
  "/forgot-password",
  "/reset-password",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]) {
  ok(`${path} is reachable with no session`, isPublicPath(path));
}

// The property that matters most, because it was once wrong and cost everything:
// public paths match EXACTLY, never by prefix.
ok(
  "a child of a public path is NOT public",
  !isPublicPath("/api/auth/change-password"),
  "this is the account-takeover bug: startsWith made every child of /api/auth public"
);
ok("...nor is a lookalike path", !isPublicPath("/reset-password-admin"));
ok("...nor is a deeper child of the reset route", !isPublicPath("/api/auth/reset-password/all"));
ok("nothing else has quietly become public", PUBLIC_EXACT.length === 7, `${PUBLIC_EXACT.length} entries`);
ok("the SSO callback is public, because it is what CREATES a session", isPublicPath("/sso/callback"));
ok("...but not everything under /sso", !isPublicPath("/sso/admin"));

// A signed-in rep is redirected to their profile rather than reaching these,
// which is harmless: they can already change their password there.
ok("the reset pages are not on the rep allow-list", !isRepAllowedPath("/forgot-password") && !isRepAllowedPath("/reset-password"));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
