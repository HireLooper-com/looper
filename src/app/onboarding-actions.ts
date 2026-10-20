"use server";

import { revalidatePath } from "next/cache";
import { profileBusiness } from "@/lib/agent";
import { mutate } from "@/lib/db";
import { requireSessionUser, requireUid } from "@/lib/session";
import type { BusinessProfile } from "@/lib/types";
import { getWorkspace, renameWorkspace } from "@/lib/workspace";

// Onboarding for a new workspace: read the business, pick one metric, hire and start.
// Hiring itself reuses draftHire / confirmHire / startSkill from team-actions.

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Step 1: Chief reads the website, then the profile is saved for every later draft and reply. */
export async function readBusiness(url: string, workspaceName?: string) {
  return attempt(async () => {
    const user = await requireSessionUser();
    if (!url.trim()) throw new Error("Add your website address.");
    const profile = await profileBusiness(user.ws, url);
    await mutate(user.ws, (db) => void (db.profile = profile));
    // A team still called "Team" takes the business's name unless the owner typed one.
    const ws = await getWorkspace(user.ws);
    const name = workspaceName?.trim() || (ws?.name === "Team" ? profile.name : "");
    if (name && ws?.kind === "team" && ws.ownerId === user.id) await renameWorkspace(user.ws, name);
    revalidatePath("/", "layout");
    return profile;
  });
}

/** The owner's corrections to Chief's read of the business. */
export async function updateProfile(patch: Pick<BusinessProfile, "summary" | "customers">) {
  return attempt(async () => {
    const uid = await requireUid();
    await mutate(uid, (db) => {
      if (!db.profile) return;
      db.profile.summary = patch.summary.slice(0, 600);
      db.profile.customers = patch.customers.slice(0, 200);
    });
    return true as const;
  });
}

/** Done or skipped: Chief stops sending this workspace to onboarding. */
export async function finishOnboarding() {
  return attempt(async () => {
    const uid = await requireUid();
    await mutate(uid, (db) => void (db.onboarded ??= new Date().toISOString()));
    revalidatePath("/", "layout");
    return true as const;
  });
}
