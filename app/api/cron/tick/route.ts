import { instanceSecret } from "@/lib/crypto";
import { tick } from "@/lib/scheduler";

export const maxDuration = 300;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` every 15 minutes (vercel.json, needs Vercel Pro);
// the enterprise scheduler container and the GitHub tick workflow send the same header. A self-hosted
// install without CRON_SECRET uses the derived one shown in Settings. The log goes to the function logs too.
export async function GET(req: Request) {
  const secret = instanceSecret("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const log = await tick();
    console.log(`[tick] ${Math.round((Date.now() - started) / 1000)}s\n${log.join("\n") || "nothing due"}`);
    return Response.json({ ok: true, log });
  } catch (e) {
    console.error("[tick] failed", e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
