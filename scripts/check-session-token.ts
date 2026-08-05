/**
 * The session cookie was plain base64(JSON) with httpOnly false — a forged
 * payload was accepted as a real login. These assertions are what stop that
 * coming back.
 *
 * Run: npx tsx scripts/check-session-token.ts
 */
import { signToken, verifyToken } from "../lib/sessionToken";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  cond ? pass++ : fail++;
}

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "test-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

(async () => {
  const payload = { userId: "u1", email: "carl@outerjoin.co.za", name: "Carl", role: "superAdmin" };

  // ── Round trip ──
  const token = await signToken(payload, SECRET);
  const back = await verifyToken<typeof payload>(token, SECRET);
  check("round trips", JSON.stringify(back) === JSON.stringify(payload), JSON.stringify(back));
  check("token has two parts", token.split(".").length === 2);

  // ── The actual attack: hand-written base64 JSON, no signature ──
  const forged = Buffer.from(JSON.stringify({ ...payload, role: "superAdmin" })).toString("base64");
  check("unsigned base64 payload is rejected", (await verifyToken(forged, SECRET)) === null);

  // ── Tampering with the payload while keeping the signature ──
  const [body, sig] = token.split(".");
  const eviljson = JSON.stringify({ ...payload, role: "superAdmin", userId: "someone-else" });
  const evilBody = Buffer.from(eviljson).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  check("swapped payload with a valid signature is rejected", (await verifyToken(`${evilBody}.${sig}`, SECRET)) === null);

  // ── Signature from a different secret ──
  const otherToken = await signToken(payload, OTHER);
  check("token signed with another secret is rejected", (await verifyToken(otherToken, SECRET)) === null);

  // ── Flipped bits in the signature ──
  const flipped = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
  check("mutated signature is rejected", (await verifyToken(`${body}.${flipped}`, SECRET)) === null);

  // ── Junk ──
  for (const junk of ["", ".", "abc", "abc.", ".abc", "not-a-token", "a.b.c.d"]) {
    check(`junk ${JSON.stringify(junk)} is rejected`, (await verifyToken(junk, SECRET)) === null);
  }

  // ── Non-ASCII names must survive (Buffer/btoa mismatch would corrupt them) ──
  const accented = { userId: "u2", email: "jose@iram.co.za", name: "José Müller-Größe", role: "admin" };
  const accentedBack = await verifyToken<typeof accented>(await signToken(accented, SECRET), SECRET);
  check("non-ASCII name round trips", accentedBack?.name === accented.name, accentedBack?.name);

  console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} passed)`);
  process.exit(fail === 0 ? 0 : 1);
})();
