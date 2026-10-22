import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getUser } from "./db";
import { kv, usingPostgres } from "./kv";
import type { User } from "./types";
import { roleIn, type Role } from "./workspace";

export const SESSION_COOKIE = "cl_session";
/** Which workspace you have open; checked against your memberships on every request. */
export const WORKSPACE_COOKIE = "cl_ws";
const MAX_AGE = 30 * 24 * 3600;

let secret: Buffer | undefined;
async function getSecret() {
  if (secret) return secret;
  if (process.env.SESSION_SECRET) return (secret = Buffer.from(process.env.SESSION_SECRET));
  // Hosted without SESSION_SECRET (e.g. a one-click deploy): make one once and keep it in the database.
  if (usingPostgres()) {
    const stored = await kv.update<string, string>("app:session-secret", () => randomBytes(32).toString("base64url"), (v) => v);
    return (secret = Buffer.from(stored));
  }
  // Local installs: generate once and keep it next to the data.
  const file = path.join(process.env.LOOPER_DATA_DIR ?? process.env.GROKLOOPER_DATA_DIR ?? path.join(process.cwd(), "data"), ".session-secret");
  try {
    secret = await fs.readFile(file);
  } catch {
    secret = randomBytes(32);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, secret, { mode: 0o600 });
  }
  return secret;
}

const sign = async (payload: string) => createHmac("sha256", await getSecret()).update(payload).digest("base64url");

export async function sessionToken(uid: string) {
  const payload = `${uid}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${payload}.${await sign(payload)}`;
}

/** A signed, short-lived message from this app to itself, e.g. the next round of a collect job. */
export async function sealJson(data: unknown, ttlSec = 600) {
  const body = Buffer.from(JSON.stringify({ data, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString("base64url");
  return `${body}.${await sign(body)}`;
}

export async function openJson<T>(token?: string): Promise<T | null> {
  const i = token?.lastIndexOf(".") ?? -1;
  if (!token || i < 0) return null;
  const body = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(await sign(body));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  const { data, exp } = JSON.parse(Buffer.from(body, "base64url").toString()) as { data: T; exp: number };
  return exp * 1000 < Date.now() ? null : data;
}

export async function verifyToken(token?: string): Promise<string | null> {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(await sign(payload));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  const [uid, exp] = payload.split(".");
  if (!uid || Number(exp) * 1000 < Date.now()) return null;
  return uid;
}

export const cookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: MAX_AGE });

export async function setSession(uid: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sessionToken(uid), cookieOptions(!!process.env.VERCEL));
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(WORKSPACE_COOKIE);
}

/** Open another workspace (membership is checked when it's read). */
export async function setWorkspace(wsId: string) {
  (await cookies()).set(WORKSPACE_COOKIE, wsId, cookieOptions(!!process.env.VERCEL));
}

/** A signed-in user with the workspace they have open: `ws` is the id all data is read and written under. */
export type SessionUser = User & { ws: string; role: Role };

/** The signed-in user, or null. Always request-time: sessions expire, so this reads the clock. */
export async function currentUser(): Promise<SessionUser | null> {
  await connection();
  const jar = await cookies();
  const uid = await verifyToken(jar.get(SESSION_COOKIE)?.value);
  const user = uid ? await getUser(uid) : undefined;
  if (!user) return null;
  const want = jar.get(WORKSPACE_COOKIE)?.value;
  const role = want && want !== user.id ? await roleIn(want, user.id) : null;
  return role ? { ...user, ws: want!, role } : { ...user, ws: user.id, role: "owner" };
}

/** For pages: the signed-in user, or a redirect to /login. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions: the id of the open workspace (what all data is keyed by), or an error. */
export async function requireUid() {
  const user = await currentUser();
  if (!user) throw new Error("Your session ended. Sign in again.");
  return user.ws;
}

/** For server actions that need the person too (authorship, invites, billing). */
export async function requireSessionUser() {
  const user = await currentUser();
  if (!user) throw new Error("Your session ended. Sign in again.");
  return user;
}
