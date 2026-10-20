import { readJobs } from "@/lib/progress";
import { currentUser } from "@/lib/session";

/** What's working in the background right now, and what finished in the last few minutes. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ jobs: [] }, { status: 401 });
  return Response.json({ jobs: await readJobs(user.ws) }, { headers: { "cache-control": "no-store" } });
}
