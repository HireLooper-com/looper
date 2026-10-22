import { json, preflight } from "@/lib/mcp/http";
import { redeemCode, refresh } from "@/lib/mcp/oauth";

// Token endpoint for MCP clients: a code (with its PKCE verifier) or a refresh token in, a bearer token out.
export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  const raw = type.includes("application/json") ? await request.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await request.text()));
  const p = raw as Record<string, string | undefined>;
  try {
    if (p.grant_type === "authorization_code") {
      if (!p.code || !p.client_id || !p.redirect_uri || !p.code_verifier) return json({ error: "invalid_request", error_description: "code, client_id, redirect_uri and code_verifier are required" }, 400);
      return json(await redeemCode(p.code, p.client_id, p.redirect_uri, p.code_verifier));
    }
    if (p.grant_type === "refresh_token") {
      if (!p.refresh_token || !p.client_id) return json({ error: "invalid_request", error_description: "refresh_token and client_id are required" }, 400);
      return json(await refresh(p.refresh_token, p.client_id));
    }
    return json({ error: "unsupported_grant_type" }, 400);
  } catch {
    return json({ error: "invalid_grant" }, 400);
  }
}

export const OPTIONS = preflight;
