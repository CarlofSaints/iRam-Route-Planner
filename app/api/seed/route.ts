import { NextRequest, NextResponse } from "next/server";
import { saveUsers, getUsers } from "@/lib/data";
import { User } from "@/lib/types";
import { requireAdmin, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const DEFAULT_SEED_EMAIL = "carl@outerjoin.co.za";
const DEFAULT_SEED_NAME = "Carl Dos Santos";

/**
 * First-run seed: creates the super admin only. Channels, reps and stores all
 * come from the Store Upload (Control Centre → Store Upload); visits come from
 * the Perigee API (Control Centre → Perigee API).
 *
 * This route used to be unauthenticated AND destructive — it called saveUsers()
 * with a one-element array, so any anonymous POST wiped every user and reset the
 * admin to a password hardcoded in this file. Three things now stop that:
 *
 *   1. It is no longer in the middleware PUBLIC_PATHS.
 *   2. It requires the CRON_SECRET bearer (for bootstrapping a fresh deploy,
 *      where by definition no admin session can exist yet) or an admin session.
 *   3. It refuses outright once any user exists, so it can never overwrite the
 *      user table even if the auth above were somehow bypassed.
 *
 * The password is never hardcoded: pass one in the body, or get a generated one
 * back in the response. It is shown exactly once and only stored hashed.
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const isSecretAuth =
      !!cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`;
    if (!isSecretAuth) {
      try {
        await requireAdmin();
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Never destructive. Seeding is a bootstrap, not a reset — restoring a lost
    // admin is a job for the Users page, not for wiping the table.
    const existing = await getUsers();
    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: `Already seeded — ${existing.length === 1 ? "1 user exists" : `${existing.length} users exist`}. Manage users in /admin/users.`,
        },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : DEFAULT_SEED_EMAIL;
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : DEFAULT_SEED_NAME;

    // A supplied password is used as-is; otherwise generate one strong enough
    // that leaving it unchanged is not a vulnerability on its own.
    const supplied = typeof body.password === "string" && body.password.length >= 8 ? body.password : null;
    const password = supplied ?? crypto.randomBytes(18).toString("base64url");

    const users: User[] = [
      {
        id: crypto.randomUUID(),
        name,
        email,
        password: await bcrypt.hash(password, 10),
        role: "superAdmin",
        // Whoever signs in with this must replace it immediately.
        forcePasswordChange: true,
      },
    ];
    await saveUsers(users);

    const session = await getSession();
    logActivity({
      action: "Seeded super admin",
      actor: session?.email || "cron-secret",
      actorName: session?.name || "Bootstrap",
      summary: `Seeded super admin ${email}`,
    });

    return NextResponse.json({
      ok: true,
      seeded: { users: 1, email },
      // Returned once, never retrievable again — only the hash is stored.
      ...(supplied ? {} : { generatedPassword: password }),
      note: "Sign in with this password and change it immediately.",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
