import { NextResponse } from "next/server";
import { saveUsers, getUsers } from "@/lib/data";
import { User } from "@/lib/types";
import bcrypt from "bcryptjs";

// First-run seed: creates the super admin only. Channels, reps and stores all
// come from the Store Upload (Control Centre → Store Upload); visits come from
// the Perigee API (Control Centre → Perigee API).
export async function POST() {
  try {
    const defaultPw = await bcrypt.hash("iram2026", 10);
    const users: User[] = [
      {
        id: crypto.randomUUID(),
        name: "Carl Dos Santos",
        email: "carl@outerjoin.co.za",
        password: defaultPw,
        role: "superAdmin",
        forcePasswordChange: false,
      },
    ];
    await saveUsers(users);
    const savedUsers = await getUsers();

    return NextResponse.json({ ok: true, seeded: { users: savedUsers.length } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
