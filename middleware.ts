import { NextRequest, NextResponse } from "next/server";
import { verifyToken, sessionSecret } from "@/lib/sessionToken";
import { isRepAllowedPath } from "@/lib/repAccess";
import type { SessionPayload } from "@/lib/types";

// /sso/callback is public by necessity: it is the route that CREATES the session,
// so it can't require one. It authenticates via the Hub-signed IRAM_SSO_SECRET token.
//
// /api/seed is deliberately NOT here. It was, and because it called saveUsers()
// with a single-element array, any anonymous POST wiped the user table and reset
// the admin to a password hardcoded in the repo.
//
// ⚠️ EXACT matches, not prefixes. These were matched with startsWith, which made
// every child of /api/auth public too — including /api/auth/change-password,
// which took a userId from the request body, set that user's password and
// returned a signed session cookie for them. A public path must be the ONE route
// that is public, not everything filed beneath it.
const PUBLIC_EXACT = ["/login", "/api/auth", "/sso/callback"];

// /api/cron is a prefix because Vercel's scheduler hits several routes under it
// without a session cookie. Each one authenticates via CRON_SECRET itself.
const PUBLIC_PREFIXES = ["/api/cron"];

// Bootstrapping a brand-new deploy is a chicken-and-egg problem: /api/seed
// creates the first admin, so there is no session cookie to present yet. Rather
// than make the route blanket-public again, the CRON_SECRET bearer gets it past
// the middleware — and the route verifies the same bearer itself, so this is a
// second gate rather than the only one.
const BEARER_PATHS = ["/api/seed"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(jpg|png|svg|ico|css|js)$/)
  ) {
    return NextResponse.next();
  }

  const cronSecret = process.env.CRON_SECRET;
  if (
    BEARER_PATHS.some((p) => pathname.startsWith(p)) &&
    !!cronSecret &&
    request.headers.get("authorization") === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next();
  }

  // Verify the SIGNATURE, not just that a cookie is present. Plenty of read
  // routes (GET /api/teams, /api/reps, /api/stores…) never call getSession(),
  // so this is the only thing standing in front of them — a presence check
  // would let a hand-written cookie read the whole database.
  const token = request.cookies.get("iram_session")?.value;
  const session = token
    ? await verifyToken<SessionPayload>(token, sessionSecret())
    : null;
  if (!session) {
    // API callers get a 401 they can actually read; page loads get the login
    // screen. Redirecting an API POST to /login returns HTML with a 200 and
    // reads like a success to anything parsing the response.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // A rep may reach their own profile and nothing else. Filtering by repCode in
  // the page (which is what /map, /routes and /capacity do) is decorative — the
  // APIs behind them hand back every rep, store and route to any valid session.
  // Denying the route outright is the only thing that actually holds.
  //
  // The role here comes from the cookie, so a role CHANGE only takes effect on
  // the user's next sign-in — promoting someone out of `rep` does not widen
  // their access until then. Accounts are created as reps and stay reps, so
  // that lag is a nuisance rather than a hole, but it is why a promoted rep
  // must be told to sign out and back in.
  if (session.role === "rep" && !isRepAllowedPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Reps may only view and update their own profile." },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL("/account", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
