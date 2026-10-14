import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "./db";

export const SESSION_COOKIE = "cl_session";
const MAX_AGE = 30 * 24 * 3600;

let secret: Buffer | undefined;
async function getSecret() {
  if (secret) return secret;
  if (process.env.SESSION_SECRET) return (secret = Buffer.from(process.env.SESSION_SECRET));
  // Local installs: generate once and keep it next to the data.
  const file = path.join(process.env.GROKLOOPER_DATA_DIR ?? path.join(process.cwd(), "data"), ".session-secret");
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
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user, or null. */
export async function currentUser() {
  const uid = await verifyToken((await cookies()).get(SESSION_COOKIE)?.value);
  return uid ? ((await getUser(uid)) ?? null) : null;
}

/** For pages: the signed-in user, or a redirect to /login. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions: the signed-in user's id, or an error. */
export async function requireUid() {
  const user = await currentUser();
  if (!user) throw new Error("Your session ended. Sign in again.");
  return user.id;
}
