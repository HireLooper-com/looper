import { after, connection } from "next/server";
import { tick, tickUser } from "@/lib/agent";

export const maxDuration = 300;

/**
 * Runs due skills. Hit by Vercel Cron (vercel.json); between cron hits, opening the app catches up.
 * With ?ws= it starts one workspace's due work in the background and answers at once: a project
 * calls this to start its next batch in a function of its own.
 */
export async function GET(request: Request) {
  // Without this the build prerenders the route, i.e. runs every due skill at build time and kills it.
  await connection();
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const ws = new URL(request.url).searchParams.get("ws");
  if (ws) {
    after(() => tickUser(ws).then(() => undefined).catch((e) => console.error("[tick]", e)));
    return Response.json({ started: ws });
  }
  return Response.json(await tick());
}
