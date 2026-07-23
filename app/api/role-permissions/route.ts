import { NextResponse } from "next/server";
import { requireSuperAdmin, getSession } from "@/lib/auth";
import { getRolePermissions, saveRolePermissions } from "@/lib/data";
import { logActivity } from "@/lib/activityLog";
import { ROLE_DEFINITIONS, ALL_PERMISSIONS, RolePermission, UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_ROLES = ROLE_DEFINITIONS.map((r) => r.role);
const VALID_KEYS = ALL_PERMISSIONS.map((p) => p.key);

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const perms = await getRolePermissions();
  return NextResponse.json(perms);
}

export async function PUT(req: Request) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as RolePermission[];

  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "Expected array" }, { status: 400 });
  }

  // Validate: all 5 roles must be present
  for (const role of VALID_ROLES) {
    if (!body.find((r) => r.role === role)) {
      return NextResponse.json(
        { error: `Missing role "${role}"` },
        { status: 400 }
      );
    }
  }

  // Validate: only known permission keys
  for (const rp of body) {
    if (!VALID_ROLES.includes(rp.role as UserRole)) {
      return NextResponse.json(
        { error: `Unknown role "${rp.role}"` },
        { status: 400 }
      );
    }
    for (const key of rp.permissions) {
      if (!VALID_KEYS.includes(key)) {
        return NextResponse.json(
          { error: `Unknown permission key "${key}"` },
          { status: 400 }
        );
      }
    }
  }

  // superAdmin always keeps ALL (enforced server-side in saveRolePermissions)
  await saveRolePermissions(body);

  const session = await getSession();
  logActivity({ action: "Updated role permissions", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: "Updated role permissions matrix" });

  const saved = await getRolePermissions();
  return NextResponse.json(saved);
}
