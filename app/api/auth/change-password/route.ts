import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers, getReps, getTeams } from "@/lib/data";
import { encodeSession, requireSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { SessionPayload } from "@/lib/types";
import bcrypt from "bcryptjs";

/**
 * The forced password change on first sign-in.
 *
 * 🔴 This route used to take `userId` from the REQUEST BODY and set that user's
 * password, with no session check — and it was reachable unauthenticated,
 * because the middleware matched the public path `/api/auth` with startsWith,
 * which made every child of it public too. Anyone who learned a user id could
 * overwrite that account's password and be handed a signed session cookie for
 * it. Both halves are now fixed: the middleware matches public paths exactly,
 * and the only account this can touch is the caller's own.
 */
export async function POST(request: NextRequest) {
  try {
    // Whoever is signing in already holds a cookie at this point — POST /api/auth
    // sets one on valid credentials even when forcePasswordChange is true.
    const current = await requireSession();
    const { newPassword } = await request.json();
    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const users = await getUsers();
    // Deliberately the SESSION's user, never an id supplied by the caller.
    const idx = users.findIndex((u) => u.id === current.userId);
    if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });

    users[idx].password = await bcrypt.hash(newPassword, 10);
    users[idx].forcePasswordChange = false;
    await saveUsers(users);

    logActivity({ action: "Changed password", actor: users[idx].email, actorName: users[idx].name, summary: `${users[idx].name} changed their password` });

    // Re-issue session cookie without forcePasswordChange
    const session: SessionPayload = {
      userId: users[idx].id,
      email: users[idx].email,
      name: users[idx].name,
      role: users[idx].role,
      forcePasswordChange: false,
      cell: users[idx].cell,
      profilePicUrl: users[idx].profilePicUrl,
    };

    // Enrich session with repCode / teamId based on role
    if (session.role === "rep") {
      const reps = await getReps();
      const rep = reps.find((r) => r.email.toLowerCase() === session.email.toLowerCase());
      if (rep) session.repCode = rep.code;
    } else if (session.role === "teamManager") {
      const teams = await getTeams();
      const team = teams.find((t) => t.managerEmail.toLowerCase() === session.email.toLowerCase());
      if (team) session.teamId = team.id;
    }

    const token = await encodeSession(session);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
