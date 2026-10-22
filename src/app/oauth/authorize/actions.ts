"use server";

import { redirect } from "next/navigation";
import { getClient, issueCode, redirectMatches } from "@/lib/mcp/oauth";
import { requireSessionUser } from "@/lib/session";
import { roleIn } from "@/lib/workspace";

/** The person allowed (or refused) an MCP client: send its browser back with a code or an error. */
export async function decide(form: FormData) {
  const user = await requireSessionUser();
  const get = (k: string) => String(form.get(k) ?? "");
  const client = await getClient(get("client_id"));
  const redirectUri = get("redirect_uri");
  // Never redirect to an address the client didn't register.
  if (!client || !redirectMatches(client, redirectUri)) throw new Error("Unknown app or return address. Start the connection again from your app.");
  const back = new URL(redirectUri);
  if (get("state")) back.searchParams.set("state", get("state"));

  const ws = get("ws");
  if (get("allow") !== "1" || !(await roleIn(ws, user.id))) {
    back.searchParams.set("error", "access_denied");
    redirect(back.toString());
  }
  const code = await issueCode({ clientId: client.id, redirectUri, challenge: get("code_challenge"), userId: user.id, ws });
  back.searchParams.set("code", code);
  redirect(back.toString());
}
