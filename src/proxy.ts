import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate: send visitors without a session cookie to /login.
// Pages and server actions verify the signed session themselves.
const PUBLIC = ["/login", "/auth/", "/api/tick"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (request.cookies.has("cl_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and public files (icons, images) so the login page can load them.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
