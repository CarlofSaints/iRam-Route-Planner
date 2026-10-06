import { getReps, getUsers } from "./data";
import type { Rep, SessionPayload } from "./types";

/**
 * Which Rep record belongs to this login.
 *
 * By id when the account was created from a rep (which is what the Create
 * Account button does), falling back to the email match the session already
 * uses. The fallback is what keeps any account made before `repId` existed — or
 * made by hand in User Admin — working.
 *
 * ⚠️ The rep record id is never read from a request body. A body-supplied id is
 * exactly how `/api/auth/change-password` became an account-takeover path.
 *
 * Lives here, on its own, because TWO routes need it: the profile card writes
 * the home address, and the account form writes the cell number. It was defined
 * inside one of them, so the other could not see it and the second copy would
 * have drifted the first time either changed.
 *
 * Not in `lib/repAccess.ts`, which the middleware imports: that module must stay
 * free of anything that touches blob storage.
 */
export async function resolveOwnRep(session: SessionPayload): Promise<Rep | null> {
  const reps = await getReps();
  const users = await getUsers();
  const user = users.find((u) => u.id === session.userId);

  if (user?.repId) {
    const byId = reps.find((r) => r.id === user.repId);
    if (byId) return byId;
  }
  if (session.repCode) {
    const byCode = reps.find((r) => r.code === session.repCode);
    if (byCode) return byCode;
  }
  const email = (session.email || "").toLowerCase().trim();
  if (!email) return null;
  return reps.find((r) => (r.email || "").toLowerCase().trim() === email) ?? null;
}
