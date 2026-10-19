import { NextResponse, type NextRequest } from "next/server";
import { getAccount } from "@/lib/composio";
import { kv } from "@/lib/kv";
import { currentUser } from "@/lib/session";

// Composio sends the browser back here after its hosted connect page, appending status and connected_account_id.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const accountId = q.get("connected_account_id") ?? "";
  const looper = q.get("looper") ?? "";
  const app = q.get("app") ?? "";
  // Connections started while hiring go back to the hiring flow's connect step.
  const back = (result: string) =>
    NextResponse.redirect(
      new URL(q.get("return") === "hire" ? `/hire?looper=${encodeURIComponent(looper)}&${result}` : `/loopers/${encodeURIComponent(looper)}?tab=apps&${result}`, request.url),
    );

  const user = await currentUser();
  const pending = accountId ? await kv.get<{ uid: string; looperId: string; slug: string }>(`composio-link:${accountId}`) : undefined;
  // Query parameters alone aren't proof: the account must be one we started for this user, and active.
  if (!user || !pending || pending.uid !== user.id || pending.slug !== app) return back(`connect_error=${encodeURIComponent(app)}`);
  await kv.delete(`composio-link:${accountId}`);
  if (q.get("status") !== "success") return back(`connect_error=${encodeURIComponent(app)}`);
  const account = await getAccount(accountId).catch(() => null);
  return back(account?.status === "ACTIVE" ? `connected=${encodeURIComponent(app)}` : `connect_error=${encodeURIComponent(app)}`);
}
