import { NextRequest, NextResponse } from "next/server";
import { getUsers, getPasswordResets, savePasswordResets } from "@/lib/data";
import { sendPasswordResetEmail, resolveAppUrl } from "@/lib/welcomeEmail";
import { logActivity } from "@/lib/activityLog";
import {
  buildResetRecord,
  generateResetToken,
  invalidateFor,
  isThrottled,
  pruneResets,
  RESET_TTL_MINUTES,
} from "@/lib/passwordReset";

/**
 * "I forgot my password."
 *
 * Public by necessity: the person who needs it is the person who cannot sign in.
 * It protects itself in three ways.
 *
 * 1. THE ANSWER IS ALWAYS THE SAME. Whether the address belongs to an account,
 *    belongs to nobody, is malformed, or hit the throttle, the caller is told
 *    the same thing. Anything else turns this route into a way to test whether
 *    an address has an account, which is a list worth having if you are about to
 *    try passwords against it.
 * 2. What it emails is a LINK, never a password. It could not email a password
 *    if it wanted to: they are bcrypt hashes and a hash is one way.
 * 3. One link per account per minute, and issuing a new one retires that
 *    account's earlier links.
 */

export const maxDuration = 30;

/** Said to everyone, whatever actually happened. */
const SAME_ANSWER = {
  ok: true,
  message:
    "If that email address has an account, a link to choose a new password is on its way. It works for the next hour.",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();

    // Even a nonsense address gets the same reply, so the shape of the answer
    // never depends on the input.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(SAME_ANSWER);
    }

    const users = await getUsers();
    const user = users.find((u) => (u.email || "").toLowerCase().trim() === email);
    if (!user) {
      return NextResponse.json(SAME_ANSWER);
    }

    const now = new Date();
    const existing = pruneResets(await getPasswordResets(), now);

    if (isThrottled(existing, email, now)) {
      // Deliberately still the same answer: somebody hammering the form learns
      // nothing from being told they are being throttled.
      return NextResponse.json(SAME_ANSWER);
    }

    const token = generateResetToken();
    const record = buildResetRecord(user.id, user.email, token, now);

    // Retire this user's older links BEFORE adding the new one, so exactly one
    // is live at a time.
    const next = [...invalidateFor(existing, user.id, now), record];
    await savePasswordResets(next);

    const resetUrl = `${resolveAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    const result = await sendPasswordResetEmail({
      name: user.name || user.email,
      email: user.email,
      resetUrl,
      expiryMinutes: RESET_TTL_MINUTES,
    });

    // Logged whether or not the mail went, because "they never got it" is the
    // question that gets asked and the log is the only place with an answer.
    logActivity({
      action: "Password reset requested",
      actor: user.email,
      actorName: user.name,
      summary: result.sent
        ? `Reset link emailed to ${user.email}`
        : `Reset link could NOT be emailed to ${user.email}: ${result.reason}`,
    });

    return NextResponse.json(SAME_ANSWER);
  } catch (err) {
    // Even a fault answers the same way. A 500 here would still tell somebody
    // which addresses get further than others.
    console.error("forgot-password failed:", err);
    return NextResponse.json(SAME_ANSWER);
  }
}
