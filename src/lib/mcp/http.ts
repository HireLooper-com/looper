import "server-only";

// MCP clients that run in a browser (the MCP Inspector, web IDEs) call these endpoints cross-origin.
// They carry a bearer token, never cookies, so any origin may call them.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, "cache-control": "no-store", ...headers } });

export const empty = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers: { ...CORS, ...headers } });

export const preflight = () => empty(204);

/** Where clients find out how to sign in: the resource this server protects and who issues its tokens. */
export const resourceMetadata = (origin: string) => ({
  resource: `${origin}/mcp`,
  authorization_servers: [origin],
  bearer_methods_supported: ["header"],
  resource_name: "Looper",
});

export const serverMetadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/api/oauth/token`,
  registration_endpoint: `${origin}/api/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
});
