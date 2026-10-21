import "server-only";
import { displayName, getUser, getWorkspace, readInvite } from "@/lib/workspace";

/** The invite behind a link, with what a preview or the page shows about it. Undefined once it expired. */
export async function inviteDetails(token: string) {
  const invite = await readInvite(token);
  const ws = invite ? await getWorkspace(invite.workspaceId) : undefined;
  if (!invite || !ws) return undefined;
  const by = await getUser(invite.by);
  return { invite, ws, inviter: by ? displayName(by) : undefined };
}
