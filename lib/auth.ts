import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getUsers } from "./data";
import { SessionPayload } from "./types";

const SESSION_COOKIE = "iram_session";

export function encodeSession(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodeSession(token: string): SessionPayload | null {
  try {
    return JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decodeSession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
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
