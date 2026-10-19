import { readProgress } from "@/lib/progress";
import { currentUser } from "@/lib/session";

/** Live progress of a reply or run: GET ?target=chief | chat:<looperId> | run:<runId> | design:<looperId>. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json(null, { status: 401 });
  const target = new URL(request.url).searchParams.get("target") ?? "";
  if (!/^(chief|(chat|run|design):[\w-]+)$/.test(target)) return Response.json(null, { status: 400 });
  return Response.json(await readProgress(user.id, target), { headers: { "cache-control": "no-store" } });
}
