"use server";

import { hasComputer, readComputer, wipeComputer, type ComputerState } from "@/lib/computer";
import { read } from "@/lib/db";
import { requireUid } from "@/lib/session";

async function owned(looperId: string) {
  const uid = await requireUid();
  if (!(await read(uid)).loopers.some((l) => l.id === looperId)) throw new Error("Looper not found");
  return uid;
}

export async function computerStatus(looperId: string): Promise<{ available: boolean; state: ComputerState | null }> {
  const uid = await owned(looperId);
  return { available: hasComputer(), state: (await readComputer(uid, looperId)) ?? null };
}

export async function resetComputer(looperId: string) {
  const uid = await owned(looperId);
  await wipeComputer(uid, looperId);
  return { ok: true };
}
