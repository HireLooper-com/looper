import { after } from "next/server";
import { collect, type CollectRound } from "@/lib/agent";
import { read } from "@/lib/db";
import { openJson } from "@/lib/session";

export const maxDuration = 300;

/** The next round of a collect job, started by the round before it so it gets a fresh 5 minutes. */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const next = await openJson<CollectRound & { uid: string; looperId: string }>(token);
  if (!next) return new Response("Unauthorized", { status: 401 });
  const { uid, looperId, ...at } = next;
  // Paused or removed since the last round: stop here.
  const looper = (await read(uid)).loopers.find((l) => l.id === looperId);
  if (!looper || looper.status !== "active") return Response.json({ started: false });
  after(() => collect(uid, looperId, at.job, "chief", at).done.then(() => undefined).catch((e) => console.error("[collect]", e)));
  return Response.json({ started: true }, { status: 202 });
}
