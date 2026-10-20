import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate: send visitors without a session cookie to /login.
// Pages and server actions verify the signed session themselves.
const PUBLIC = ["/login", "/auth/", "/api/tick", "/api/stripe/webhook"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (request.cookies.has("cl_session")) {
    // Pages read the path to decide what an unpaid workspace may open.
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  // Come back here after signing in (e.g. an invite link).
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and public files (icons, images) so the login page can load them.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
