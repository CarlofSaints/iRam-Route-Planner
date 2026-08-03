import { NextRequest, NextResponse } from "next/server";

// /api/cron is listed here so Vercel's scheduler can reach it without a session
// cookie — the route itself authenticates via CRON_SECRET or an admin session.
// /sso/callback is public by necessity: it is the route that CREATES the session,
// so it can't require one. It authenticates via the Hub-signed IRAM_SSO_SECRET token.
//
// /api/seed is deliberately NOT here. It was, and because it called saveUsers()
// with a single-element array, any anonymous POST wiped the user table and reset
// the admin to a password hardcoded in the repo.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/cron", "/sso/callback"];

// Bootstrapping a brand-new deploy is a chicken-and-egg problem: /api/seed
// creates the first admin, so there is no session cookie to present yet. Rather
// than make the route blanket-public again, the CRON_SECRET bearer gets it past
// the middleware — and the route verifies the same bearer itself, so this is a
// second gate rather than the only one.
const BEARER_PATHS = ["/api/seed"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
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

  const session = request.cookies.get("iram_session")?.value;
  if (!session) {
    // API callers get a 401 they can actually read; page loads get the login
    // screen. Redirecting an API POST to /login returns HTML with a 200 and
    // reads like a success to anything parsing the response.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
