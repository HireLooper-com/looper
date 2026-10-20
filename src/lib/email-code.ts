import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { kv } from "./kv";
import { hasSignInCodes, sendSignInCode } from "./loops";

// Sign-in by a 6-digit email code: the code's hash waits in the database for 10 minutes, Loops
// delivers it, five wrong tries burn it, and one new code a minute per address.

const TTL_S = 10 * 60;
const RESEND_S = 60;
const TRIES = 5;

export const hasEmailCodes = hasSignInCodes;
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const codeKey = (email: string) => `signin:code:${email}`;
const waitKey = (email: string) => `signin:wait:${email}`;
const hash = (email: string, code: string) => createHash("sha256").update(`${email}:${code}`).digest();

interface Pending {
  hash: string;
  tries: number;
  expiresAt: number;
}

/** Email a fresh code. Returns an error to show, or null. */
export async function emailCode(email: string): Promise<string | null> {
  if (!hasEmailCodes()) return "Email sign-in isn't set up on this server.";
  if (!validEmail(email)) return "Enter a valid email address.";
  if (await kv.get(waitKey(email))) return "A code is on its way. You can ask for a new one in a minute.";
  await kv.set(waitKey(email), true, RESEND_S);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await kv.set(codeKey(email), { hash: hash(email, code).toString("hex"), tries: 0, expiresAt: Date.now() + TTL_S * 1000 } satisfies Pending, TTL_S);
  if (await sendSignInCode(email, code)) return null;
  await kv.delete(waitKey(email));
  return "We couldn't send the email. Try again in a moment.";
}

/** Whether this is the code we sent to this address; a right code works once. */
export async function checkCode(email: string, code: string): Promise<boolean> {
  const p = await kv.get<Pending>(codeKey(email));
  if (!p || !/^\d{6}$/.test(code)) return false;
  if (timingSafeEqual(Buffer.from(p.hash, "hex"), hash(email, code))) {
    await kv.delete(codeKey(email));
    return true;
  }
  const left = Math.ceil((p.expiresAt - Date.now()) / 1000);
  if (p.tries + 1 >= TRIES || left <= 0) await kv.delete(codeKey(email));
  else await kv.set(codeKey(email), { ...p, tries: p.tries + 1 }, left);
  return false;
}
