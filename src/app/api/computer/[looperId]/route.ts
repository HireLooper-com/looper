import { hasComputer, readComputerLog, readTakeover } from "@/lib/computer";
import { currentUser } from "@/lib/session";

/** A looper's computer sessions, polled by the Computer view. Keys include the user id. */
export async function GET(_request: Request, ctx: RouteContext<"/api/computer/[looperId]">) {
  const user = await currentUser();
  if (!user) return Response.json({ sessions: [] }, { status: 401 });
  const { looperId } = await ctx.params;
  const [log, takeover] = await Promise.all([readComputerLog(user.ws, looperId), readTakeover(user.ws, looperId)]);
  return Response.json({ available: hasComputer(), now: Date.now(), takeover: !!takeover, ...log }, { headers: { "cache-control": "no-store" } });
}
