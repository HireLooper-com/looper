import { createHash, randomBytes, randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { billingOff } from "./billing";
import { sql } from "./db";

const COOKIE = "lp_session";
const DAYS = 30;

export type User = {
  id: number;
  email: string;
  tz: string;
  plan: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  website: string;
  notify: boolean;
  weekly: boolean;
  stripe_subscription_id: string | null;
  billing: string;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const CODE_MINUTES = 10;
const CODE_TRIES = 5;

/** A fresh 6-digit code for this email. Returns null if one went out in the last 30 seconds. */
export async function issueCode(email: string, tz: string | null) {
  const code = String(randomInt(0, 1e6)).padStart(6, "0");
  const expires = new Date(Date.now() + CODE_MINUTES * 6e4);
  const rows = await sql`
    insert into login_codes (email, code_hash, tz, expires_at) values (${email}, ${sha(email + code)}, ${tz}, ${expires})
    on conflict (email) do update set code_hash = excluded.code_hash, tz = excluded.tz, attempts = 0,
      sent_at = now(), expires_at = excluded.expires_at
    where login_codes.sent_at < now() - interval '30 seconds'
    returning email`;
  return rows.length ? code : null;
}

/** Spends the code. Returns the time zone captured at send time, or null if the code is wrong or used up. */
export async function redeemCode(email: string, code: string) {
  const [row] = await sql<{ code_hash: string; tz: string | null }>`
    update login_codes set attempts = attempts + 1
    where email = ${email} and expires_at > now() and attempts < ${CODE_TRIES}
    returning code_hash, tz`;
  if (!row || row.code_hash !== sha(email + code)) return null;
  await sql`delete from login_codes where email = ${email}`;
  return { tz: row.tz };
}

export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + DAYS * 864e5);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${sha(token)}, ${userId}, ${expires})`;
  const h = await headers();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(h.get("host") ?? "");
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: !local,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sql`delete from sessions where token_hash = ${sha(token)}`;
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [u] = await sql<User>`
    select u.id, u.email, u.tz, u.plan, u.subscription_status, u.stripe_customer_id, u.website, u.notify, u.weekly, u.stripe_subscription_id, u.billing
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha(token)} and s.expires_at > now()`;
  return u ?? null;
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

// The user's own subscription, or no billing at all (lib/billing.ts). Workspaces use wsPaid (lib/workspace.ts).
export function isPaid(u: User) {
  return billingOff() || ["active", "trialing"].includes(u.subscription_status);
}
