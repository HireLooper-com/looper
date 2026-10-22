import type { NextRequest } from "next/server";
import { hasAccess } from "@/lib/billing";
import { empty, json, preflight } from "@/lib/mcp/http";
import { authenticate } from "@/lib/mcp/oauth";
import { respond } from "@/lib/mcp/server";
import { getUser, getWorkspace } from "@/lib/workspace";

// Looper's MCP endpoint (Streamable HTTP, stateless). Add it to Claude Code with
//   claude mcp add --transport http looper https://hirelooper.com/mcp
// and the first call opens the browser to approve a workspace.

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const auth = token ? await authenticate(token) : null;
  if (!auth) {
    const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"${token ? ', error="invalid_token"' : ""}`;
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in to Looper first" } }, 401, { "www-authenticate": challenge });
  }
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);

  // Hosted workspaces without a plan can look but not work, as in the app.
  const ws = await getWorkspace(auth.ws);
  const owner = ws && ws.ownerId !== auth.userId ? await getUser(ws.ownerId) : await getUser(auth.userId);
  const paywall = hasAccess(ws, owner?.email) ? undefined : `This workspace has no active plan. Choose one at ${origin}/billing, then try again.`;

  const out = await respond({ ws: auth.ws, userId: auth.userId, origin, paywall }, body);
  return out ? json(out) : empty(202);
}

// No server-to-client stream: everything is a reply to a POST.
export const GET = () => empty(405, { allow: "POST" });
export const DELETE = () => empty(405, { allow: "POST" });
export const OPTIONS = preflight;
