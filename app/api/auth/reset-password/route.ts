import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers, getPasswordResets, savePasswordResets } from "@/lib/data";
import { logActivity } from "@/lib/activityLog";
import { findResetRecord, passwordProblem, pruneResets } from "@/lib/passwordReset";
import bcrypt from "bcryptjs";

/**
 * Spending a reset link.
 *
 * Public, and safe to be public, because the only way in is 32 random bytes that
 * were emailed to the address on the account.
 *
 * ⚠️ It deliberately does NOT sign the person in. Handing back a session cookie
 * is what turned the old change-password route into an account-takeover path,
 * and while a single-use token makes it defensible here, there is no need: they
 * land on the sign-in page with their email filled in and use the password they
 * just chose. One extra step, and the credential they have to remember is
 * exercised immediately rather than a week later.
 *
 * GET  ?token=...  checks a link without spending it, so the page can say "this
 *                  link has expired" before the person types a new password
 *                  twice.
 * POST { token, password }  sets the password and retires the link.
 */

/** One message for every failure. Which one it was is the holder's business, not ours. */
const DEAD_LINK =
  "That link is no longer valid. It may have expired, or already been used. Ask for a new one.";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  if (!token) return NextResponse.json({ valid: false, error: DEAD_LINK }, { status: 400 });

  const now = new Date();
  const records = await getPasswordResets();
  const lookup = findResetRecord(records, token, now);
  if (!lookup.ok) {
    return NextResponse.json({ valid: false, error: DEAD_LINK }, { status: 400 });
  }

  const users = await getUsers();
  const user = users.find((u) => u.id === lookup.record.userId);
  if (!user) return NextResponse.json({ valid: false, error: DEAD_LINK }, { status: 400 });

  // The email comes back so the page can greet them and prefill sign-in. It is
  // the address the link was sent to, so this reveals nothing to whoever holds
  // the link that they did not already have.
  return NextResponse.json({ valid: true, email: user.email, name: user.name });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token || "");
    const password = String(body?.password || "");

    if (!token) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const now = new Date();
    const records = await getPasswordResets();
    const lookup = findResetRecord(records, token, now);
    if (!lookup.ok) {
      console.warn(`reset-password rejected a token: ${lookup.reason}`);
      return NextResponse.json({ error: DEAD_LINK }, { status: 400 });
    }

    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === lookup.record.userId);
    if (idx === -1) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

    users[idx].password = await bcrypt.hash(password, 10);
    // They have just chosen their own password, so the forced-change prompt on
    // first sign-in would be asking them to do the same thing twice.
    users[idx].forcePasswordChange = false;
    await saveUsers(users);

    // Spend the link only AFTER the password is safely saved. The other order
    // burns the link on a failed write and strands them.
    const spent = pruneResets(
      records.map((r) =>
        r.tokenHash === lookup.record.tokenHash ? { ...r, usedAt: now.toISOString() } : r
      ),
      now
    );
    await savePasswordResets(spent);

    logActivity({
      action: "Password reset",
      actor: users[idx].email,
      actorName: users[idx].name,
      summary: `${users[idx].name} set a new password using a reset link`,
    });

    return NextResponse.json({ ok: true, email: users[idx].email });
  } catch (err) {
    console.error("reset-password failed:", err);
    return NextResponse.json({ error: "Something went wrong. Ask for a new link." }, { status: 500 });
  }
}
