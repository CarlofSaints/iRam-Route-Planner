import { NextResponse } from "next/server";
import { getCallCycleTypes, getRoutesForType } from "@/lib/data";

export async function GET() {
  try {
    const types = await getCallCycleTypes();

    const results = await Promise.all(
      types.map(async (t) => {
        const doc = await getRoutesForType(t.id);
        return {
          id: t.id,
          name: t.name,
          strategy: t.strategy,
          active: t.active,
          hasRoutes: !!doc,
          generatedAt: doc?.generatedAt ?? null,
        };
      })
    );

    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
