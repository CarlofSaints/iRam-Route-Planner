import { NextResponse } from "next/server";
import { getReps, getStores, getRoutes, getVisitRoles, getChannels, getStoreOverrides } from "@/lib/data";
import { routableStores } from "@/lib/routable";
import { computeCapacity } from "@/lib/capacity";
import { requireSession } from "@/lib/auth";

export async function GET() {
  try {
    await requireSession();

    const [reps, stores, doc, visitRoles, channels, overrides] = await Promise.all([
      getReps(),
      getStores(),
      getRoutes(),
      getVisitRoles(),
      getChannels(),
      getStoreOverrides(),
    ]);

    return NextResponse.json(
      computeCapacity(
        reps,
        // Closed stores and channels nobody calls on carry no workload. The same
        // rule route generation applies, so capacity matches the plan.
        routableStores({ stores, channels, overrides }),
        doc,
        visitRoles,
        channels
      )
    );
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Rep capacity error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
