import { redirect, unstable_rethrow } from "next/navigation";
import { withToolError } from "@/lib/tools";
import { syncConnections } from "../../../actions";

// Composio sends the founder back here after the tool's sign-in. We re-read
// the workspace's connected accounts instead of trusting query parameters.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("back") || "/app/settings#tools";
  const back = raw.startsWith("/app") ? raw : "/app/settings#tools";
  let failed = false;
  try {
    await syncConnections(Number(q.get("ws")) || undefined);
  } catch (e) {
    unstable_rethrow(e); // the sign-in redirect from requireUser
    console.error("connect callback:", e instanceof Error ? e.message : e);
    failed = true;
  }
  redirect(failed ? withToolError(back, "Could not read your connected tools from Composio. Reload in a minute.") : back);
}
