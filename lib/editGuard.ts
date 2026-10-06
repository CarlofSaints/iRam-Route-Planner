import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { canEdit, editRefusal, type EditArea } from "./roles";

/**
 * The first line of every write endpoint in an EditArea.
 *
 * Returns the response to send when the caller may not change this area, or
 * null when they may. These routes used to ask only for a session, so any
 * signed-in login could edit channels, teams or settings; the pages merely
 * hid the buttons. See lib/roles.ts for who may change what.
 */
export async function refuseEdit(area: EditArea): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEdit(session.role, area)) {
    return NextResponse.json({ error: editRefusal(area) }, { status: 403 });
  }
  return null;
}
