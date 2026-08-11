import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/data";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { sendWelcomeEmail } from "@/lib/welcomeEmail";
import bcrypt from "bcryptjs";

/**
 * RE-SEND a welcome email. This RESETS the target's password to a fresh temp
 * one — it is not a "resend the same mail" button, and firing it at a live
 * account locks that person out until they read the email.
 *
 * A new user gets their welcome from POST /api/users instead, which mails the
 * password the admin typed and resets nothing.
 */
export async function POST(request: NextRequest) {
  try {
    // Without this, any signed-in account could reset a Super Admin's password
    // and read the new one straight out of the response body.
    const session = await requirePermission("manage_users");

    const { userId } = await request.json();
    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const user = users[idx];

    // Generate a temporary password
    const tempPassword = `iRam${Math.random().toString(36).slice(2, 8)}!`;
    users[idx].password = await bcrypt.hash(tempPassword, 10);
    users[idx].forcePasswordChange = true;
    await saveUsers(users);

    const result = await sendWelcomeEmail({
      name: user.name,
      email: user.email,
      password: tempPassword,
      forcePasswordChange: true,
    });

    logActivity({
      action: "Sent welcome email",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Reset password and ${result.sent ? "emailed" : "FAILED to email"} welcome to ${user.name} (${user.email})${result.sent ? "" : ` — ${result.reason}`}`,
    });

    if (result.sent) {
      return NextResponse.json({ ok: true, sent: true, tempPassword });
    }

    // The password HAS been reset either way, so the caller must always get it
    // back — otherwise a failed send silently locks the user out.
    return NextResponse.json({
      ok: true,
      sent: false,
      tempPassword,
      email: user.email,
      message: `${result.reason} Share credentials manually.`,
    });
  } catch (err) {
    const text = String(err);
    if (text.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (text.includes("Forbidden")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: text }, { status: 500 });
  }
}
