"use server";

import { emailAllowed } from "@/lib/db";
import { setSession, setWorkspace } from "@/lib/session";
import { verifySupabaseToken } from "@/lib/supabase-auth";
import { upsertUser } from "@/lib/workspace";

/** Turn a fresh Supabase sign-in into our session. Returns an error to show, or null. */
export async function finishSupabaseSignIn(accessToken: string): Promise<{ error: string } | null> {
  try {
    const who = await verifySupabaseToken(accessToken);
    if (!emailAllowed(who.email)) return { error: "This account isn't on the allowed list for this workspace." };
    const user = await upsertUser({ identity: `supabase:${who.id}`, email: who.email, name: who.name, avatar: who.avatar, provider: who.provider });
    await setSession(user.id);
    await setWorkspace(user.id);
    return null;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sign-in didn't complete. Try again." };
  }
}
