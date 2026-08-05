import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, encodeSession, getSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { getReps, getTeams, getUsers, getRolePermissions } from "@/lib/data";
import { logActivity } from "@/lib/activityLog";

export const dynamic = "force-dynamic";

/**
 * The current session as the SERVER sees it, with the live role and the
 * permission list for that role. The client used to decode the cookie itself,
 * so a promoted user kept their old role in the UI until the cookie expired.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ session: null, permissions: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const perms = await getRolePermissions();
  const permissions = perms.find((p) => p.role === session.role)?.permissions ?? [];
  return NextResponse.json({ session, permissions }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const session = await validateCredentials(email, password);
    if (!session) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

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

    logActivity({ action: "User logged in", actor: session.email, actorName: session.name, summary: `${session.name} logged in` });

    const token = await encodeSession(session);
    const response = NextResponse.json({ ok: true, user: session });
    response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
