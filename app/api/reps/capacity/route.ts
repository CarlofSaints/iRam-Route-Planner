import { NextResponse } from "next/server";
import { getReps, getStores, getRoutes, getVisitRoles } from "@/lib/data";
import { computeCapacity } from "@/lib/capacity";
import { requireSession } from "@/lib/auth";

export async function GET() {
  try {
    await requireSession();

    const [reps, stores, doc, visitRoles] = await Promise.all([
      getReps(),
      getStores(),
      getRoutes(),
      getVisitRoles(),
    ]);

    return NextResponse.json(computeCapacity(reps, stores, doc, visitRoles));
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Rep capacity error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
