import { NextRequest, NextResponse } from "next/server";

// /api/cron is listed here so Vercel's scheduler can reach it without a session
// cookie — the route itself authenticates via CRON_SECRET or an admin session.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/seed", "/api/debug", "/api/cron"];

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

  const session = request.cookies.get("iram_session")?.value;
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
