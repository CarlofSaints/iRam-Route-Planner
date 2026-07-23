import { NextRequest, NextResponse } from "next/server";
import { requireSession, encodeSession } from "@/lib/auth";
import { getUsers, saveUsers, getReps, getTeams } from "@/lib/data";
import { resolveManager } from "@/lib/manager";
import { SessionPayload } from "@/lib/types";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const session = await requireSession();
    const users = await getUsers();
    const user = users.find((u) => u.id === session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { password: _, ...safe } = user;
    const manager = await resolveManager(session);

    return NextResponse.json({ user: safe, manager });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const { name, cell, currentPassword, newPassword } = body;

    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === session.userId);
    if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Update basic fields
    if (name) users[idx].name = name;
    if (cell !== undefined) users[idx].cell = cell;

    // Password change (optional)
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password required" }, { status: 400 });
      }
      const valid = await bcrypt.compare(currentPassword, users[idx].password);
      if (!valid) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      }
      if (newPassword.length < 6) {
        return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
      }
      users[idx].password = await bcrypt.hash(newPassword, 10);
    }

    await saveUsers(users);

    // Re-issue session cookie with updated fields
    const updatedSession: SessionPayload = {
      userId: users[idx].id,
      email: users[idx].email,
      name: users[idx].name,
      role: users[idx].role,
      forcePasswordChange: false,
      cell: users[idx].cell,
      profilePicUrl: users[idx].profilePicUrl,
    };

    // Enrich with repCode / teamId
    if (updatedSession.role === "rep") {
      const reps = await getReps();
      const rep = reps.find((r) => r.email.toLowerCase() === updatedSession.email.toLowerCase());
      if (rep) updatedSession.repCode = rep.code;
    } else if (updatedSession.role === "teamManager") {
      const teams = await getTeams();
      const team = teams.find((t) => t.managerEmail.toLowerCase() === updatedSession.email.toLowerCase());
      if (team) updatedSession.teamId = team.id;
    }

    const token = encodeSession(updatedSession);
    const response = NextResponse.json({ ok: true, user: updatedSession });
    response.cookies.set("iram_session", token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
