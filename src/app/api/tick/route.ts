import { connection } from "next/server";
import { tick } from "@/lib/agent";

export const maxDuration = 300;

/** Runs due skills. Hit by Vercel Cron (vercel.json); between cron hits, opening the app catches up. */
export async function GET(request: Request) {
  // Without this the build prerenders the route, i.e. runs every due skill at build time and kills it.
  await connection();
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await tick());
}
