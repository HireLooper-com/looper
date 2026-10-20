"use server";

import { revalidatePath } from "next/cache";
import { logNudge, REASONS, type Reason } from "@/lib/admin";
import { hasNotes, sendNote } from "@/lib/loops";
import { currentUser } from "@/lib/session";
import { isAdmin } from "@/lib/usage";
import { getUser, getWorkspace } from "@/lib/workspace";

// Operators only (ADMIN_EMAILS). Every action is checked here and written to the admin log.

type Result = { ok: true } | { ok: false; error: string };

/** Email a workspace's owner the (edited) nudge through Loops' generic template, and log it. */
export async function sendNudge(wsId: string, reason: Reason, subject: string, body: string): Promise<Result> {
  const me = await currentUser();
  if (!me || !isAdmin(me.email)) return { ok: false, error: "Not found." };
  if (!(reason in REASONS)) return { ok: false, error: "Unknown reason." };
  if (!hasNotes()) return { ok: false, error: "Set LOOPS_API_KEY and LOOPS_GENERIC_TEMPLATE_ID to send emails." };
  if (!subject.trim() || !body.trim()) return { ok: false, error: "Write a subject and a message." };
  const ws = await getWorkspace(wsId);
  const owner = ws && (await getUser(ws.ownerId));
  if (!owner?.email) return { ok: false, error: "This workspace's owner has no email address." };
  if (!(await sendNote(owner.email, subject.trim().slice(0, 140), body.trim().slice(0, 4000)))) return { ok: false, error: "Loops didn't accept the email. Check the server log." };
  await logNudge(wsId, reason, me.email!, owner.email);
  revalidatePath("/admin", "layout");
  return { ok: true };
}
