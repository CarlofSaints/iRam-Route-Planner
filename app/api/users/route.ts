import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/data";
import { User, UserRole } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import bcrypt from "bcryptjs";

const SUPER_ADMIN_FORBIDDEN = { error: "Only Super Admins can add, edit, or remove Super Admin users" };

export async function GET() {
  try {
    const users = await getUsers();
    const safe = users.map(({ password: _, ...u }) => u);
    return NextResponse.json(safe);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    const body = await request.json();
    const { name, email, password, role } = body;

    // Only superAdmins can create superAdmin users
    if (role === "superAdmin" && session?.role !== "superAdmin") {
      return NextResponse.json(SUPER_ADMIN_FORBIDDEN, { status: 403 });
    }

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email and password required" }, { status: 400 });
    }

    const users = await getUsers();
    if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: crypto.randomUUID(),
      name,
      email,
      password: hashed,
      role: (role as UserRole) || "viewer",
      forcePasswordChange: body.forcePasswordChange ?? false,
    };
    users.push(newUser);
    await saveUsers(users);

    logActivity({ action: "Created user", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created user ${name} (${email}) with role ${role || "viewer"}` });

    const { password: _, ...safe } = newUser;
    return NextResponse.json(safe, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    const body = await request.json();
    const { id, name, email, role, password, forcePasswordChange, cell } = body;

    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const targetUser = users[idx];

    // Only superAdmins can edit superAdmin users or promote someone to superAdmin
    if ((targetUser.role === "superAdmin" || role === "superAdmin") && session?.role !== "superAdmin") {
      return NextResponse.json(SUPER_ADMIN_FORBIDDEN, { status: 403 });
    }

    if (name) users[idx].name = name;
    if (email) users[idx].email = email;
    if (role) users[idx].role = role as UserRole;
    if (password) users[idx].password = await bcrypt.hash(password, 10);
    if (forcePasswordChange !== undefined) users[idx].forcePasswordChange = forcePasswordChange;
    if (cell !== undefined) users[idx].cell = cell;

    await saveUsers(users);

    logActivity({ action: "Updated user", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated user ${users[idx].name} (${users[idx].email})` });

    const { password: _, ...safe } = users[idx];
    return NextResponse.json(safe);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    const { id } = await request.json();
    const users = await getUsers();
    const target = users.find((u) => u.id === id);

    // Only superAdmins can delete superAdmin users
    if (target?.role === "superAdmin" && session?.role !== "superAdmin") {
      return NextResponse.json(SUPER_ADMIN_FORBIDDEN, { status: 403 });
    }

    const filtered = users.filter((u) => u.id !== id);
    await saveUsers(filtered);

    logActivity({ action: "Deleted user", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Deleted user ${target?.name || id} (${target?.email || ""})` });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
