import "server-only";
import { waitUntil } from "@vercel/functions";
import { kv } from "./kv";
import { displayName, getUser, getWorkspace, membersOf } from "./workspace";
import type { User } from "./types";

// Email through Loops (loops.so): every person is a contact, so product updates and onboarding
// loops can reach them; sign-up and plan changes are events those loops start from; "a looper
// needs you" is a transactional email. All of it is off without LOOPS_API_KEY, and a Loops
// outage never breaks the app: calls run in the background and failures are only logged.
//   LOOPS_API_KEY        Loops → Settings → API
//   LOOPS_TX_NEEDS_YOU   transactional email id; data variables: name, looperName, question,
//                        detail, count, url
//   LOOPS_TX_SIGN_IN_CODE  transactional email id for sign-in codes; data variable: code

const API = "https://app.loops.so/api/v1";

export const hasLoops = () => !!process.env.LOOPS_API_KEY;

const appUrl = () =>
  process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

/** Runs in the background; await the result only when the caller needs to know it was accepted. */
function send(path: string, body: unknown): Promise<boolean> {
  if (!hasLoops()) return Promise.resolve(false);
  const p = fetch(`${API}${path}`, {
    method: path.startsWith("/contacts/") ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${process.env.LOOPS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
    .then(async (r) => {
      if (!r.ok) console.error(`[loops] ${path} ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.ok;
    })
    .catch((e) => {
      console.error(`[loops] ${path}`, e instanceof Error ? e.message : e);
      return false;
    });
  waitUntil(p);
  return p;
}

/** Create or update the person in Loops' audience. */
export function loopsContact(user: Pick<User, "id" | "email" | "name">, props: Record<string, string | number | boolean> = {}) {
  if (!user.email) return;
  send("/contacts/update", { email: user.email, userId: user.id, firstName: user.name?.split(" ")[0], source: "Looper app", ...props });
}

/** Something happened that a Loops loop (onboarding, win-back, …) can start from. */
export function loopsEvent(email: string | undefined, eventName: string, eventProperties: Record<string, string | number | boolean> = {}) {
  if (!email) return;
  send("/events/send", { email, eventName, eventProperties });
}

export const hasSignInCodes = () => hasLoops() && !!process.env.LOOPS_TX_SIGN_IN_CODE;

/** Email a 6-digit sign-in code. Resolves to whether Loops accepted it. */
export function sendSignInCode(email: string, code: string) {
  return send("/transactional", { transactionalId: process.env.LOOPS_TX_SIGN_IN_CODE, email, dataVariables: { code } });
}

/** Email the people in a workspace that a looper is waiting on them, at most every 30 minutes each. */
export async function notifyNeedsYou(wsId: string, looperName: string, question: string, detail: string | undefined, openCount: number) {
  const tx = process.env.LOOPS_TX_NEEDS_YOU;
  if (!hasLoops() || !tx) return;
  const ws = await getWorkspace(wsId);
  const people = ws ? await membersOf(ws) : await getUser(wsId).then((u) => (u ? [{ userId: u.id, email: u.email, name: displayName(u) }] : []));
  for (const p of people) {
    if (!p.email) continue;
    const key = `mail:needs-you:${wsId}:${p.userId}`;
    if (await kv.get(key)) continue;
    await kv.set(key, true, 30 * 60);
    send("/transactional", {
      transactionalId: tx,
      email: p.email,
      dataVariables: { name: p.name ?? "", looperName, question, detail: detail?.slice(0, 600) ?? "", count: openCount, url: `${appUrl()}/inbox` },
    });
  }
}
