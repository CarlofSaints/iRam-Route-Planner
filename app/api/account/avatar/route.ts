import { NextRequest, NextResponse } from "next/server";
import { put, list, del } from "@vercel/blob";
import { requireSession, encodeSession } from "@/lib/auth";
import { getUsers, saveUsers, getReps, getTeams } from "@/lib/data";
import { SessionPayload } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG, or WebP allowed" }, { status: 400 });
    }

    // Max 2MB
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 2MB" }, { status: 400 });
    }

    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const blobKey = `avatars/${session.userId}.${ext}`;

    // Delete old avatar(s)
    try {
      const { blobs } = await list({ prefix: `avatars/${session.userId}` });
      for (const b of blobs) await del(b.url);
    } catch { /* ignore */ }

    // Upload new avatar
    const blob = await put(blobKey, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: false,
    });

    // Save URL to user record
    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === session.userId);
    if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });

    users[idx].profilePicUrl = blob.url;
    await saveUsers(users);

    // Re-issue session with updated profilePicUrl
    const updatedSession: SessionPayload = {
      userId: users[idx].id,
      email: users[idx].email,
      name: users[idx].name,
      role: users[idx].role,
      forcePasswordChange: false,
      cell: users[idx].cell,
      profilePicUrl: users[idx].profilePicUrl,
    };

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
    const response = NextResponse.json({ ok: true, url: blob.url });
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
