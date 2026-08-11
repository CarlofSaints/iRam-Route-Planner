import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/data";
import { User, UserRole } from "@/lib/types";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { sendWelcomeEmail } from "@/lib/welcomeEmail";
import bcrypt from "bcryptjs";

const SUPER_ADMIN_FORBIDDEN = { error: "Only Super Admins can add, edit, or remove Super Admin users" };

/** Map the errors thrown by requirePermission onto real status codes. */
function authFailure(err: unknown): NextResponse | null {
  const text = String(err);
  if (text.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (text.includes("Forbidden")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    await requirePermission("manage_users");
    const users = await getUsers();
    const safe = users.map(({ password: _, ...u }) => u);
    return NextResponse.json(safe);
  } catch (err) {
    return authFailure(err) || NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Creating a user is an escalation path — without this, any signed-in
    // account could mint an admin for itself.
    const session = await requirePermission("manage_users");
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

    const forcePasswordChange = body.forcePasswordChange ?? false;
    const hashed = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: crypto.randomUUID(),
      name,
      email,
      password: hashed,
      role: (role as UserRole) || "viewer",
      forcePasswordChange,
    };
    users.push(newUser);
    await saveUsers(users);

    // Deliberately AFTER the save: a mail failure must not cost us the user.
    // The password sent is the one the admin typed — creating an account does
    // not reset anything, unlike the re-send in /api/users/send-welcome.
    const emailResult = body.sendWelcomeEmail
      ? await sendWelcomeEmail({ name, email, password, forcePasswordChange })
      : null;

    const emailSummary = !emailResult
      ? "no welcome email requested"
      : emailResult.sent
        ? "welcome email sent"
        : `welcome email FAILED — ${emailResult.reason}`;

    logActivity({ action: "Created user", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created user ${name} (${email}) with role ${role || "viewer"} (${emailSummary})` });

    const { password: _, ...safe } = newUser;
    return NextResponse.json(
      {
        ...safe,
        emailRequested: !!body.sendWelcomeEmail,
        emailSent: emailResult?.sent ?? false,
        emailError: emailResult && !emailResult.sent ? emailResult.reason : undefined,
      },
      { status: 201 }
    );
  } catch (err) {
    return authFailure(err) || NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // This route can set any user's password outright, so it is a takeover path
    // for anyone who can reach it. Self-service lives on /api/account instead.
    const session = await requirePermission("manage_users");
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
    return authFailure(err) || NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requirePermission("manage_users");
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
    return authFailure(err) || NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
