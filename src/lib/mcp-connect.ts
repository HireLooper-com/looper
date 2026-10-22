import "server-only";
import { randomBytes } from "node:crypto";
import { auth, MCPClientOAuthError, type OAuthClientInformation, type OAuthClientProvider, type OAuthTokens } from "@ai-sdk/mcp";
import { kv } from "./kv";
import type { Integration } from "./types";

// Second rung of the connect ladder: when Composio can't connect an app, find the vendor's own
// MCP server and sign in to it directly. Two sources, both limited to servers on the vendor's
// domain so a person's sign-in or key never goes to a third party:
// 1. the official MCP Registry, where the namespace (com.notion, app.linear) proves the domain;
// 2. the common mcp.<app>.com/mcp address, accepted only when it offers OAuth, so the person
//    sees the vendor's own sign-in page before anything is shared.

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";

export type McpServer =
  | { url: string; auth: "oauth"; scope?: string }
  | { url: string; auth: "key"; header: string; template?: string; hint?: string }
  | { url: string; auth: "none" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const onDomain = (url: string, domain: string) => {
  const h = hostOf(url);
  return h === domain || h.endsWith(`.${domain}`);
};

const getJson = async (url: string) => {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
};

interface RegistryRemote {
  type: string;
  url: string;
  headers?: { name: string; value?: string; description?: string; isRequired?: boolean; isSecret?: boolean }[];
}

/** The vendor's remote server from the registry: namespace is exactly <tld>.<app> and the URL is on that domain. */
async function fromRegistry(app: { slug: string; name: string }): Promise<McpServer | null> {
  const res = await getJson(`${REGISTRY}?search=${encodeURIComponent(app.name)}&version=latest&limit=100`).catch(() => null);
  const servers = ((res?.servers ?? []) as { server: { name: string; remotes?: RegistryRemote[] } }[]).map((s) => s.server);
  const names = new Set([norm(app.slug), norm(app.name)]);
  for (const s of servers) {
    const labels = s.name.split("/")[0].split(".");
    if (labels.length !== 2 || !names.has(norm(labels[1]))) continue;
    const domain = `${labels[1]}.${labels[0]}`.toLowerCase();
    const remote = s.remotes?.find((r) => r.type === "streamable-http" && onDomain(r.url, domain));
    if (!remote) continue;
    const secret = remote.headers?.find((h) => h.isSecret || h.isRequired);
    if (secret) return { url: remote.url, auth: "key", header: secret.name, template: secret.value, hint: secret.description };
    const found = await probe(remote.url);
    if (found) return found;
  }
  return null;
}

/** What an MCP endpoint asks for: OAuth we can register for ourselves, or nothing. Null when it isn't one. */
async function probe(url: string): Promise<McpServer | null> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "looper", version: "1" } } }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!r) return null;
  await r.body?.cancel().catch(() => undefined);
  if (r.ok) return { url, auth: "none" };
  if (r.status !== 401) return null;
  const u = new URL(url);
  const prm =
    (await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`).catch(() => null)) ??
    (await getJson(`${u.origin}/.well-known/oauth-protected-resource`).catch(() => null));
  const issuer = (prm?.authorization_servers as string[] | undefined)?.[0];
  if (!issuer) return null;
  const i = new URL(issuer);
  const as =
    (await getJson(`${i.origin}/.well-known/oauth-authorization-server${i.pathname === "/" ? "" : i.pathname}`).catch(() => null)) ??
    (await getJson(`${i.origin}/.well-known/openid-configuration`).catch(() => null));
  // Without dynamic registration we'd need our own OAuth app per vendor, which this rung avoids.
  if (!as?.registration_endpoint) return null;
  const scopes = [...((prm?.scopes_supported as string[] | undefined) ?? [])];
  if ((as.scopes_supported as string[] | undefined)?.includes("offline_access") && !scopes.includes("offline_access")) scopes.push("offline_access");
  return { url, auth: "oauth", scope: scopes.join(" ") || undefined };
}

const serverKey = (slug: string) => `mcp-server:${norm(slug)}`;

/** The app's own MCP server, if it has one we can connect. Remembered for a day, misses included. */
export async function findMcpServer(app: { slug: string; name: string }): Promise<McpServer | null> {
  const key = serverKey(app.slug);
  const hit = await kv.get<{ server: McpServer | null }>(key).catch(() => undefined);
  if (hit) return hit.server;
  let server = await fromRegistry(app);
  if (!server)
    for (const label of new Set([norm(app.slug), norm(app.name)]))
      for (const url of [`https://mcp.${label}.com/mcp`, `https://mcp.${label}.com/`]) {
        const found = await probe(url).catch(() => null);
        // An unlisted address is only trusted when the vendor's own sign-in page vouches for it.
        if (found?.auth === "oauth") {
          server = found;
          break;
        }
      }
  await kv.set(key, { server }, 24 * 3600).catch(() => undefined);
  return server;
}

/** Header value for a pasted key: the registry's template ("Bearer {token}") or the key itself. */
export const keyHeader = (server: Extract<McpServer, { auth: "key" }>, key: string) => ({
  [server.header]: server.template && /\{[^}]+\}/.test(server.template) ? server.template.replace(/\{[^}]+\}/, key) : key,
});

// — OAuth —

export type McpOAuth = NonNullable<Integration["oauth"]>;

/** An OAuth client for one server. `state` holds what the flow saves; `onTokens` persists refreshed tokens. */
export function oauthProvider(state: Partial<McpOAuth> & { redirectUrl: string; verifier?: string; nonce?: string }, onTokens?: (tokens: OAuthTokens) => Promise<void>) {
  let authorizationUrl: URL | undefined;
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return state.redirectUrl;
    },
    get clientMetadata() {
      return { client_name: "Looper", redirect_uris: [state.redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
    },
    clientInformation: () => state.client as OAuthClientInformation | undefined,
    saveClientInformation: (client) => void (state.client = client),
    isClientInformationDynamicallyRegistered: () => true,
    tokens: () => state.tokens as OAuthTokens | undefined,
    saveTokens: async (tokens) => {
      state.tokens = tokens;
      await onTokens?.(tokens);
    },
    redirectToAuthorization: (url) => void (authorizationUrl = url),
    saveCodeVerifier: (v) => void (state.verifier = v),
    codeVerifier: () => state.verifier ?? "",
    state: () => (state.nonce ??= randomBytes(16).toString("base64url")),
    storedState: () => state.nonce,
    invalidateCredentials: (scope) => {
      if (scope === "all" || scope === "tokens") state.tokens = undefined;
      if (scope === "all" || scope === "client") state.client = undefined;
    },
  };
  return { provider, state, authorizationUrl: () => authorizationUrl };
}

export interface PendingOAuth {
  uid: string;
  looperId: string;
  slug: string;
  name: string;
  url: string;
  returnTo?: string;
  redirectUrl: string;
  client?: Record<string, unknown>;
  verifier?: string;
  nonce: string;
}

/** Register Looper with the server's sign-in and return the page to send the browser to. */
export async function startOAuth(input: Omit<PendingOAuth, "nonce" | "client" | "verifier">, scope?: string) {
  const flow = oauthProvider({ redirectUrl: input.redirectUrl });
  const result = await auth(flow.provider, { serverUrl: input.url, scope }).catch(async (e) => {
    if (!MCPClientOAuthError.isInstance(e)) throw e;
    // Some vendors (Buffer) only register clients they know. Their servers take a personal API key
    // as a bearer token instead, so ask for one from now on.
    const server: McpServer = { url: input.url, auth: "key", header: "Authorization", template: "Bearer {key}" };
    await kv.set(serverKey(input.slug), { server }, 7 * 24 * 3600);
    throw new Error(`${input.name} doesn't let Looper sign in directly yet. Paste a ${input.name} API key instead (find it in ${input.name}'s settings, under API).`);
  });
  const to = flow.authorizationUrl();
  if (result !== "REDIRECT" || !to || !flow.state.nonce) throw new Error(`${input.name} didn't start a sign-in.`);
  const pending: PendingOAuth = { ...input, client: flow.state.client, verifier: flow.state.verifier, nonce: flow.state.nonce };
  await kv.set(`mcp-oauth:${pending.nonce}`, pending, 3600);
  return to.toString();
}

/** Trade the callback's code for tokens. Returns the pending flow and the saved OAuth state. */
export async function finishOAuth(nonce: string, code: string, issuer?: string) {
  const pending = await kv.get<PendingOAuth>(`mcp-oauth:${nonce}`);
  if (!pending) return null;
  await kv.delete(`mcp-oauth:${nonce}`);
  const flow = oauthProvider({ redirectUrl: pending.redirectUrl, client: pending.client, verifier: pending.verifier, nonce });
  await auth(flow.provider, { serverUrl: pending.url, authorizationCode: code, callbackState: nonce, callbackIssuer: issuer });
  if (!flow.state.tokens) throw new Error(`${pending.name} sent no access token.`);
  const oauth: McpOAuth = { redirectUrl: pending.redirectUrl, client: flow.state.client ?? {}, tokens: flow.state.tokens };
  return { pending, oauth };
}
