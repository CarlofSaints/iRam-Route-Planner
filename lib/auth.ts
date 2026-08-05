import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getUsers, getRolePermissions } from "./data";
import { SessionPayload } from "./types";
import { signToken, verifyToken, sessionSecret } from "./sessionToken";

export const SESSION_COOKIE = "iram_session";

/** Cookie options every session write must use. httpOnly keeps it out of
 *  document.cookie — the client gets its session from GET /api/auth instead. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 days
};

export async function encodeSession(payload: SessionPayload): Promise<string> {
  return signToken(payload, sessionSecret());
}

export async function decodeSession(token: string): Promise<SessionPayload | null> {
  return verifyToken<SessionPayload>(token, sessionSecret());
}

/**
 * Resolve the caller's session, with the role read from the LIVE user record
 * rather than from the cookie.
 *
 * The cookie is a snapshot taken at login and it lives for 30 days. Promoting
 * someone in /admin/users changed users.json and nothing else, so they kept
 * whatever role they had when they last signed in — which is why Grant, a
 * Super Admin in the user table, had no "Generate Routes" button while Carl
 * did. Anything derived from the role has to come from the user record.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // Mis-signed or tampered tokens are rejected here before the user lookup.
  const decoded = await decodeSession(token);
  if (!decoded) return null;

  const users = await getUsers();
  const user =
    users.find((u) => u.id === decoded.userId) ??
    users.find((u) => u.email.toLowerCase() === (decoded.email || "").toLowerCase());

  // Deleted user: the cookie should stop working immediately, not in 30 days.
  if (!user) return null;

  return {
    ...decoded,
    email: user.email,
    name: user.name,
    role: user.role,
    forcePasswordChange: user.forcePasswordChange ?? false,
    cell: user.cell,
    profilePicUrl: user.profilePicUrl,
  };
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

/**
 * True when the caller's role grants `permission`, read from the live role
 * grid. Hiding a button is not authorisation — the matching API route has to
 * check this too.
 */
export async function sessionHasPermission(
  session: SessionPayload | null,
  permission: string
): Promise<boolean> {
  if (!session) return false;
  const perms = await getRolePermissions();
  return !!perms.find((p) => p.role === session.role)?.permissions.includes(permission);
}

export async function requirePermission(permission: string): Promise<SessionPayload> {
  const session = await requireSession();
  if (!(await sessionHasPermission(session, permission))) {
    throw new Error("Forbidden");
  }
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "superAdmin" && session.role !== "admin") {
    throw new Error("Forbidden");
  }
  return session;
}

export async function requireSuperAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "superAdmin") {
    throw new Error("Forbidden");
  }
  return session;
}

export async function validateCredentials(
  email: string,
  password: string
): Promise<SessionPayload | null> {
  const users = await getUsers();
  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    forcePasswordChange: user.forcePasswordChange ?? false,
    cell: user.cell,
    profilePicUrl: user.profilePicUrl,
  };
}
