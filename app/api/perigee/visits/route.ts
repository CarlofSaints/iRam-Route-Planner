import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { getPerigeeVisits, savePerigeeVisits } from "@/lib/perigeeData";

export const dynamic = "force-dynamic";

// GET — return stored visits, optionally filtered by date range and rep
// Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), repCode
export async function GET(request: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const repCode = searchParams.get("repCode");

  let visits = await getPerigeeVisits();

  if (from) visits = visits.filter((v) => v.date >= from);
  if (to) visits = visits.filter((v) => v.date <= to);
  if (repCode) visits = visits.filter((v) => v.repCode === repCode);

  return NextResponse.json(visits);
}

// DELETE — clear all stored visits (admin only, used when re-baselining)
export async function DELETE() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await savePerigeeVisits([]);
  return NextResponse.json({ ok: true });
}
