"use server";

import { revalidatePath } from "next/cache";
import { claimLaunch, launchSlug } from "@/lib/launch";
import { requireSessionUser } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

/** Set up a launch's public scoreboard before it goes live, so the link can be shared early. */
export async function setUpLaunch(slug: string, input: { name: string; tagline?: string; launchDay?: string }): Promise<Result> {
  try {
    const user = await requireSessionUser();
    const s = launchSlug(slug);
    if (!input.name.trim()) throw new Error("Add the product's name.");
    await claimLaunch(user.ws, s, input);
    revalidatePath(`/launch/${s}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
