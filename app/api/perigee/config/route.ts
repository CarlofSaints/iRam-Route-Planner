import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getSession } from "@/lib/auth";
import { getPerigeeConfig, savePerigeeConfig } from "@/lib/perigeeData";
import { buildPerigeeBody, fetchAllPerigeeVisits, PerigeeFetchError } from "@/lib/perigeeApi";
import { logActivity } from "@/lib/activityLog";

export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

// GET — return config with the token masked
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getPerigeeConfig();
  return NextResponse.json(
    {
      ...config,
      apiKey: config.apiKey ? `****${config.apiKey.slice(-4)}` : "",
      hasApiKey: !!config.apiKey,
    },
    { headers: NO_CACHE }
  );
}

// PUT — save config, optionally testing the connection first
export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { apiKey, endpoint, customer, requestBody, enabled, test } = body;

  const config = await getPerigeeConfig();

  // Only overwrite fields that were actually supplied (the UI never sends back
  // the masked token).
  if (apiKey !== undefined && apiKey !== "" && !apiKey.startsWith("****")) config.apiKey = apiKey;
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (customer !== undefined) config.customer = customer;
  if (requestBody !== undefined) config.requestBody = requestBody;
  if (enabled !== undefined) config.enabled = enabled;

  if (!config.endpoint) {
    return NextResponse.json({ error: "Endpoint is required" }, { status: 400, headers: NO_CACHE });
  }
  if (config.requestBody) {
    try {
      JSON.parse(config.requestBody);
    } catch {
      return NextResponse.json(
        { error: "Extra request body is not valid JSON" },
        { status: 400, headers: NO_CACHE }
      );
    }
  }

  if (test) {
    if (!config.apiKey) {
      return NextResponse.json({ tested: true, connected: false, error: "No API token saved" }, { headers: NO_CACHE });
    }
    const today = new Date().toISOString().slice(0, 10);
    try {
      const probe = buildPerigeeBody(today, today, config.customer, config.requestBody);
      const result = await fetchAllPerigeeVisits(config.endpoint, config.apiKey, probe, { maxPages: 1 });
      await savePerigeeConfig(config);
      return NextResponse.json(
        {
          tested: true,
          connected: true,
          rowsToday: result.rows.length,
          topLevelKeys: result.rawTopLevelKeys,
          pagination: result.firstPageMeta,
        },
        { headers: NO_CACHE }
      );
    } catch (err) {
      const msg =
        err instanceof PerigeeFetchError
          ? `HTTP ${err.status}${err.detail ? ` — ${err.detail.slice(0, 200)}` : ""}`
          : err instanceof Error
            ? err.message
            : "Connection failed";
      return NextResponse.json({ tested: true, connected: false, error: msg }, { headers: NO_CACHE });
    }
  }

  await savePerigeeConfig(config);

  const session = await getSession();
  logActivity({
    action: "Updated Perigee config",
    actor: session?.email || "unknown",
    actorName: session?.name || "Unknown",
    summary: "Updated Perigee API configuration",
  });

  return NextResponse.json({ ok: true }, { headers: NO_CACHE });
}
