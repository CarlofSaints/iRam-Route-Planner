import { NextRequest, NextResponse } from "next/server";
import { getReps, getUsers, saveUsers } from "@/lib/data";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { sendWelcomeEmail } from "@/lib/welcomeEmail";
import { generateTempPassword } from "@/lib/tempPassword";
import { User } from "@/lib/types";
import bcrypt from "bcryptjs";

/**
 * Turn a rep into a login.
 *
 * Deliberately NOT a wrapper around POST /api/users. That route can mint any
 * role and is therefore gated on `manage_users`, which only superAdmins hold.
 * This one is gated on `create_rep_accounts` — which Admins can hold — precisely
 * because it cannot be used to make anything except a `rep` attached to a rep
 * record that already exists, using that rep's own email. The role is hardcoded
 * below and is never read from the request body; that is the entire reason the
 * weaker permission is safe.
 *
 * Body: { repIds: string[] }.
 */

// bcrypt at cost 10 plus a paced email per rep. The cap keeps a batch inside
// the function's time budget and inside Resend's send rate.
const MAX_PER_REQUEST = 20;
const EMAIL_PACING_MS = 550;

export const maxDuration = 60;

export interface CreateAccountOutcome {
  repId: string;
  code: string;
  name: string;
  email: string;
  /**
   * created — account made and the welcome email sent.
   * created_no_email — account made, the mail failed; the password is returned so it can be shared by hand.
   * exists — a login already uses this email. Nothing was changed.
   * skipped — no email address on the rep, so there is nothing to send to.
   * failed — the rep could not be found.
   */
  status: "created" | "created_no_email" | "exists" | "skipped" | "failed";
  detail: string;
  /** Only ever populated for created_no_email, so the admin can pass it on. */
  tempPassword?: string;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Which reps already have a login.
 *
 * A separate, deliberately thin endpoint because GET /api/users needs
 * `manage_users`, which only superAdmins hold — an Admin has to be able to see
 * who still needs an account without being able to read the user table. It
 * returns rep ids and nothing about the users themselves.
 */
export async function GET() {
  try {
    await requirePermission("create_rep_accounts");

    const [reps, users] = await Promise.all([getReps(), getUsers()]);
    const emails = new Set(users.map((u) => u.email.toLowerCase().trim()));
    const linkedRepIds = new Set(users.map((u) => u.repId).filter(Boolean) as string[]);

    // Matched by the stored link OR by email, so accounts made by hand in User
    // Admin before this button existed still register as "has a login".
    const withLogin = reps
      .filter((r) => linkedRepIds.has(r.id) || emails.has((r.email || "").toLowerCase().trim()))
      .map((r) => r.id);

    return NextResponse.json({ repIdsWithLogin: withLogin });
  } catch (err) {
    const text = String(err);
    if (text.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (text.includes("Forbidden")) return NextResponse.json({ repIdsWithLogin: [], forbidden: true }, { status: 403 });
    return NextResponse.json({ error: text }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission("create_rep_accounts");

    const body = await request.json().catch(() => ({}));
    const repIds: string[] = Array.isArray(body?.repIds) ? body.repIds : [];

    if (repIds.length === 0) {
      return NextResponse.json({ error: "No reps selected" }, { status: 400 });
    }
    if (repIds.length > MAX_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `Too many at once — send at most ${MAX_PER_REQUEST} per request so the emails don't outrun the send limit.`,
        },
        { status: 400 }
      );
    }

    const reps = await getReps();
    const users = await getUsers();
    const outcomes: CreateAccountOutcome[] = [];

    // Every created user is pushed onto this one array and saved ONCE at the
    // end. Saving inside the loop would be a read-modify-write per rep against
    // a single blob, which is how a concurrent write silently loses accounts.
    const created: { user: User; password: string; repName: string }[] = [];

    for (const repId of repIds) {
      const rep = reps.find((r) => r.id === repId);
      if (!rep) {
        outcomes.push({
          repId,
          code: "",
          name: "",
          email: "",
          status: "failed",
          detail: "That rep no longer exists. Refresh the page.",
        });
        continue;
      }

      const base = { repId, code: rep.code, name: rep.name, email: (rep.email || "").trim() };
      const email = base.email;

      if (!email || !looksLikeEmail(email)) {
        outcomes.push({
          ...base,
          status: "skipped",
          detail: email
            ? `"${email}" isn't a usable email address. Fix it on the rep first.`
            : "No email address on this rep, so there is nowhere to send a login.",
        });
        continue;
      }

      // An existing login is left completely alone. Minting a new password here
      // would lock out whoever is already using that account, and there would be
      // no way to tell from the button that it had happened.
      const clash = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (clash) {
        outcomes.push({
          ...base,
          status: "exists",
          detail: `${email} already has a login (${clash.role}). Nothing was changed — use User Admin to resend their details.`,
        });
        continue;
      }

      const tempPassword = generateTempPassword();
      const user: User = {
        id: crypto.randomUUID(),
        name: rep.name || email,
        email,
        password: await bcrypt.hash(tempPassword, 10),
        // Hardcoded. This route exists to create reps and nothing else.
        role: "rep",
        forcePasswordChange: true,
        cell: rep.cell || undefined,
        // The durable link to the rep record, so editing the rep's email later
        // doesn't quietly detach their login from their profile.
        repId: rep.id,
      };

      users.push(user);
      created.push({ user, password: tempPassword, repName: rep.name });
    }

    if (created.length > 0) {
      await saveUsers(users);
    }

    // Mail only AFTER the users are safely saved: a send failure must not cost
    // us the account, and an account we failed to save must never be emailed.
    for (let i = 0; i < created.length; i++) {
      const { user, password } = created[i];
      if (i > 0) await delay(EMAIL_PACING_MS);

      const result = await sendWelcomeEmail({
        name: user.name,
        email: user.email,
        password,
        forcePasswordChange: true,
        audience: "rep",
      });

      outcomes.push({
        repId: user.repId || "",
        code: reps.find((r) => r.id === user.repId)?.code || "",
        name: user.name,
        email: user.email,
        status: result.sent ? "created" : "created_no_email",
        detail: result.sent
          ? "Login created and the welcome email sent."
          : `Login created, but the email failed — ${result.reason} Share the password below by hand.`,
        // Withheld on success: the password is in the rep's inbox, and putting
        // it on an admin's screen as well is a copy nobody needs.
        tempPassword: result.sent ? undefined : password,
      });
    }

    const madeCount = outcomes.filter((o) => o.status === "created" || o.status === "created_no_email").length;
    if (madeCount > 0) {
      logActivity({
        action: "Created rep logins",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Created ${madeCount} rep login${madeCount === 1 ? "" : "s"} (${outcomes
          .filter((o) => o.status === "created")
          .length} emailed)`,
      });
    }

    return NextResponse.json({
      requested: repIds.length,
      created: outcomes.filter((o) => o.status === "created").length,
      createdNoEmail: outcomes.filter((o) => o.status === "created_no_email").length,
      alreadyExisted: outcomes.filter((o) => o.status === "exists").length,
      skipped: outcomes.filter((o) => o.status === "skipped").length,
      failed: outcomes.filter((o) => o.status === "failed").length,
      outcomes,
    });
  } catch (err) {
    const text = String(err);
    if (text.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (text.includes("Forbidden")) {
      return NextResponse.json(
        { error: "You do not have permission to create rep logins." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: text }, { status: 500 });
  }
}
