import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers, getReps, getTeams } from "@/lib/data";
import { encodeSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { SessionPayload } from "@/lib/types";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    const { userId, newPassword } = await request.json();
    if (!userId || !newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === userId);
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

    const token = encodeSession(session);
    const response = NextResponse.json({ ok: true });
    response.cookies.set("iram_session", token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
