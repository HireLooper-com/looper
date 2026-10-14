import { NextResponse, type NextRequest } from "next/server";
import { redeemHandoff } from "@/lib/oauth/chatgpt";
import { cookieOptions, SESSION_COOKIE, sessionToken } from "@/lib/session";

// Second hop of ChatGPT sign-in: back on the origin the user browses, turn the one-time code into a session.
export async function GET(request: NextRequest) {
  const uid = redeemHandoff(request.nextUrl.searchParams.get("code") ?? "");
  const to = request.nextUrl.searchParams.get("to") === "settings" ? "/settings" : "/";
  const status = request.nextUrl.searchParams.get("chatgpt") ?? "connected";
  if (!uid) return NextResponse.redirect(new URL("/login?chatgpt=expired", request.url));
  const res = NextResponse.redirect(new URL(`${to}?chatgpt=${encodeURIComponent(status)}`, request.url));
  const secure = request.nextUrl.protocol === "https:";
  res.cookies.set(SESSION_COOKIE, await sessionToken(uid), cookieOptions(secure));
  res.cookies.set("cl_hint", uid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86400, secure });
  return res;
}
