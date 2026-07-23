import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, encodeSession } from "@/lib/auth";
import { getReps, getTeams, getUsers } from "@/lib/data";
import { logActivity } from "@/lib/activityLog";

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

    const token = encodeSession(session);
    const response = NextResponse.json({ ok: true, user: session });
    response.cookies.set("iram_session", token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("iram_session", "", {
    httpOnly: false,
    path: "/",
    maxAge: 0,
  });
  return response;
}
