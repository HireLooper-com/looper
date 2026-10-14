import { tick } from "@/lib/agent";

export const maxDuration = 300;

/** Runs due skills. Hit it from a cron (e.g. Vercel Cron every few minutes) when not running the local ticker. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await tick());
}
