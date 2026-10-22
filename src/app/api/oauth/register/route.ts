import { json, preflight } from "@/lib/mcp/http";
import { registerClient } from "@/lib/mcp/oauth";

// Dynamic client registration (RFC 7591): MCP clients register themselves before the first sign-in.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid_client_metadata", error_description: "Send the client metadata as JSON" }, 400);
  try {
    const c = await registerClient(body);
    return json(
      {
        client_id: c.id,
        client_id_issued_at: Math.floor(Date.parse(c.createdAt) / 1000),
        client_name: c.name,
        redirect_uris: c.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  } catch (e) {
    return json({ error: "invalid_redirect_uri", error_description: e instanceof Error ? e.message : String(e) }, 400);
  }
}

export const OPTIONS = preflight;
