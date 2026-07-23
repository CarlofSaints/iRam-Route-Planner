import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/data";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    const users = await getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Generate a temporary password
    const tempPassword = `iRam${Math.random().toString(36).slice(2, 8)}!`;
    const idx = users.findIndex((u) => u.id === userId);
    users[idx].password = await bcrypt.hash(tempPassword, 10);
    users[idx].forcePasswordChange = true;
    await saveUsers(users);

    // Send welcome email via Resend if configured
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const emailBody = `
Hi ${user.name},

Welcome to iRam Route Planner!

Your login credentials:
- URL: ${process.env.NEXT_PUBLIC_APP_URL || "https://iram-route-planner.vercel.app"}
- Email: ${user.email}
- Temporary Password: ${tempPassword}

You will be asked to change your password on first login.

Regards,
iRam Team
      `.trim();

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || "iRam <onboarding@resend.dev>",
          to: user.email,
          subject: "Welcome to iRam Route Planner",
          text: emailBody,
        }),
      });

      if (!emailRes.ok) {
        const errData = await emailRes.json().catch(() => ({}));
        console.error("Resend API error:", emailRes.status, errData);
        return NextResponse.json({
          ok: true,
          sent: false,
          tempPassword,
          email: user.email,
          message: `Email failed (${emailRes.status}): ${errData?.message || errData?.error || "Unknown error"}. Share credentials manually.`,
        });
      }

      return NextResponse.json({ ok: true, sent: true, tempPassword });
    }

    // No Resend key — return temp password for manual sharing
    return NextResponse.json({
      ok: true,
      sent: false,
      message: "No RESEND_API_KEY configured. Share credentials manually.",
      tempPassword,
      email: user.email,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
