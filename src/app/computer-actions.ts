"use server";

import { wipeComputer } from "@/lib/computer";
import { read } from "@/lib/db";
import { requireUid } from "@/lib/session";

export async function resetComputer(looperId: string) {
  const uid = await requireUid();
  if (!(await read(uid)).loopers.some((l) => l.id === looperId)) throw new Error("Looper not found");
  await wipeComputer(uid, looperId);
  return { ok: true };
}
