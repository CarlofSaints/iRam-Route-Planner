import { NextRequest, NextResponse } from "next/server";
import { requireSession, encodeSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { getUsers, saveUsers, getReps, saveReps, getTeams } from "@/lib/data";
import { resolveManager, findTeamForManager, normaliseEmail } from "@/lib/manager";
import { resolveOwnRep } from "@/lib/ownRep";
import { logActivity } from "@/lib/activityLog";
import { SessionPayload } from "@/lib/types";
import { passwordProblem } from "@/lib/passwordRules";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const session = await requireSession();
    const users = await getUsers();
    const user = users.find((u) => u.id === session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { password: _, ...safe } = user;
    const manager = await resolveManager(session);

    // A rep's phone number lives on their REP record: that is the one the Reps
    // page, the rep export and their manager read. The login record has a cell
    // field of its own, and for most reps it is empty, because the number was
    // captured when the rep was created and never against the login.
    //
    // 🔴 Seeding the form from the login alone showed a blank box to a rep whose
    // number we already had, and saving that blank would have wiped the real one.
    const rep = await resolveOwnRep(session);
    const cell = safe.cell || rep?.cell || "";

    return NextResponse.json({ user: { ...safe, cell }, manager });
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
      const problem = passwordProblem(String(newPassword));
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      users[idx].password = await bcrypt.hash(newPassword, 10);
    }

    await saveUsers(users);

    // ── The number has to reach the REP record, or it changes nothing ───────
    //
    // Writing only the login record made this form look like it worked while the
    // Reps page, the rep export and the manager's view all went on showing the
    // old number. For a rep's phone number the source of truth is the rep
    // record: it is what the business reads.
    //
    // Only for a login that actually resolves to a rep. An admin has no rep
    // record and their cell stays on the user record alone, which is correct.
    if (cell !== undefined) {
      const own = await resolveOwnRep(session);
      if (own && (own.cell || "") !== cell) {
        const reps = await getReps();
        const repIdx = reps.findIndex((r) => r.id === own.id);
        if (repIdx !== -1) {
          reps[repIdx].cell = cell;
          await saveReps(reps);
          logActivity({
            action: "Rep updated own profile",
            actor: session.email,
            actorName: session.name,
            summary: `${reps[repIdx].name} (${reps[repIdx].code}) updated their cell number`,
          });
        }
      }
    }

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
      const rep = reps.find((r) => normaliseEmail(r.email) === normaliseEmail(updatedSession.email));
      if (rep) updatedSession.repCode = rep.code;
    } else if (updatedSession.role === "teamManager") {
      const team = findTeamForManager(await getTeams(), updatedSession.email);
      if (team) updatedSession.teamId = team.id;
    }

    const token = await encodeSession(updatedSession);
    const response = NextResponse.json({ ok: true, user: updatedSession });
    response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
