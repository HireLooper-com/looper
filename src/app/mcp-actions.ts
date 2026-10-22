"use server";

import { revalidatePath } from "next/cache";
import { revokeGrant } from "@/lib/mcp/oauth";
import { requireSessionUser } from "@/lib/session";

/** Disconnect an MCP client (Claude Code, Cursor…): its tokens stop working at once. */
export async function disconnectMcpClient(grantId: string) {
  const user = await requireSessionUser();
  await revokeGrant(user.id, grantId);
  revalidatePath("/settings");
  return true;
}
