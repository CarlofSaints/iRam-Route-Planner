import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifySSOToken } from "@/lib/sso";
import { encodeSession } from "@/lib/auth";
import { getUsers, saveUsers, getReps, getTeams } from "@/lib/data";
import { logActivity } from "@/lib/activityLog";
import { SessionPayload, User } from "@/lib/types";

// The slug this module is registered under in the iRam Hub's /admin/modules.
// It must match exactly — the Hub puts the user's allowed slugs in the token.
const MODULE_SLUG = "rep-router";

const HUB_URL = process.env.NEXT_PUBLIC_IRAM_HUB_URL || "https://iram-hub.vercel.app";

function errorPage(message: string, status: number) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SSO sign-in failed</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f5f5;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
<div style="max-width:380px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.08);padding:32px;text-align:center">
<h1 style="margin:0 0 8px;font-size:18px;color:#32373C">Sign-in failed</h1>
<p style="margin:0 0 24px;font-size:14px;color:#828282">${message}</p>
<a href="${HUB_URL}" style="display:inline-block;background:#7CC042;color:#fff;font-weight:600;font-size:14px;padding:10px 24px;border-radius:8px;text-decoration:none">Back to iRam Hub</a>
</div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return errorPage("No sign-in token was supplied.", 400);

  const secret = process.env.IRAM_SSO_SECRET;
  if (!secret) {
    return errorPage(
      "This app is missing its IRAM_SSO_SECRET setting. Please tell an administrator.",
      500
    );
  }

  const payload = verifySSOToken(token, secret);
  if (!payload) {
    return errorPage("That sign-in link is invalid or has expired. Open the tile again.", 401);
  }

  if (!payload.modules.includes(MODULE_SLUG)) {
    return errorPage("You do not have access to the Route Planner.", 403);
  }

  const users = await getUsers();
  let user = users.find((u) => u.email.toLowerCase() === payload.email.toLowerCase());

  if (!user) {
    // First sign-in via the Hub — provision a local user. Hub super-admins come
    // through as superAdmin; everyone else starts read-only and gets promoted in
    // /admin/users. Password is a random unusable value: SSO users never log in
    // with a password, and an empty string would make bcrypt.compare throw.
    user = {
      id: crypto.randomUUID(),
      name: [payload.name, payload.surname].filter(Boolean).join(" ").trim() || payload.email,
      email: payload.email,
      password: crypto.randomBytes(32).toString("hex"),
      role: payload.hubRole === "super-admin" ? "superAdmin" : "viewer",
      forcePasswordChange: false,
    } satisfies User;

    users.push(user);
    await saveUsers(users);

    logActivity({
      action: "User provisioned via SSO",
      actor: user.email,
      actorName: user.name,
      summary: `${user.name} signed in from the iRam Hub for the first time (role: ${user.role})`,
    });
  }

  const session: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    forcePasswordChange: false, // SSO users have no password to change
    cell: user.cell,
    profilePicUrl: user.profilePicUrl,
  };

  // Same enrichment the password login does — reps and team managers are matched by email
  if (session.role === "rep") {
    const reps = await getReps();
    const rep = reps.find((r) => r.email.toLowerCase() === session.email.toLowerCase());
    if (rep) session.repCode = rep.code;
  } else if (session.role === "teamManager") {
    const teams = await getTeams();
    const team = teams.find((t) => t.managerEmail.toLowerCase() === session.email.toLowerCase());
    if (team) session.teamId = team.id;
  }

  logActivity({
    action: "User logged in",
    actor: session.email,
    actorName: session.name,
    summary: `${session.name} logged in via iRam Hub SSO`,
  });

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set("iram_session", encodeSession(session), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days, matches /api/auth
  });
  return response;
}
