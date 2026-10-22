import { nanoid } from "nanoid";
import { NextResponse, type NextRequest } from "next/server";
import { saveAppServer, testIntegration } from "@/lib/integrations";
import { finishOAuth } from "@/lib/mcp-connect";
import { currentUser } from "@/lib/session";

// An app's own MCP server sends the browser back here after its sign-in page, with code and state.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const user = await currentUser();
  const back = (looper: string, flow: string | undefined, result: string) =>
    NextResponse.redirect(
      new URL(flow === "hire" || flow === "welcome" ? `/${flow}?looper=${encodeURIComponent(looper)}&${result}` : `/loopers/${encodeURIComponent(looper)}?tab=apps&${result}`, request.url),
    );

  const state = q.get("state") ?? "";
  const code = q.get("code");
  // The state names a flow we started; it must also be this user's.
  const done = state && code && user ? await finishOAuth(state, code, q.get("iss") ?? undefined).catch(() => null) : null;
  if (!done || done.pending.uid !== user?.ws) return NextResponse.redirect(new URL("/?connect_error=sign-in", request.url));
  const { pending, oauth } = done;
  const integration = { id: nanoid(8), name: pending.name, kind: "custom" as const, url: pending.url, headers: {}, enabled: true, app: pending.slug, oauth };
  const test = await testIntegration(integration, pending.uid);
  if (!test.ok) return back(pending.looperId, pending.returnTo, `connect_error=${encodeURIComponent(pending.slug)}`);
  await saveAppServer(pending.uid, integration);
  return back(pending.looperId, pending.returnTo, `connected=${encodeURIComponent(pending.slug)}`);
}
