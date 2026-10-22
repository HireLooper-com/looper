import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { kv } from "../kv";
import { roleIn } from "../workspace";

// Looper as an OAuth 2.1 authorization server for MCP clients (Claude Code, Claude, Cursor, …).
// Clients register themselves (RFC 7591), the person approves one workspace in the browser, and
// the client gets a bearer token for /mcp. Tokens are random and stored by their hash; each one
// belongs to a grant, so disconnecting a client in Settings cuts off all of its tokens at once.

const CODE_TTL = 600;
const ACCESS_TTL = 24 * 3600;
const REFRESH_TTL = 180 * 24 * 3600;

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
}

/** One client's access to one workspace, approved by one person. */
export interface Grant {
  id: string;
  userId: string;
  ws: string;
  clientId: string;
  clientName: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface AuthCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  userId: string;
  ws: string;
}

interface TokenRecord {
  grantId: string;
  kind: "access" | "refresh";
}

const hash = (token: string) => createHash("sha256").update(token).digest("base64url");
const clientKey = (id: string) => `mcp:client:${id}`;
const codeKey = (code: string) => `mcp:code:${hash(code)}`;
const tokenKey = (token: string) => `mcp:token:${hash(token)}`;
const grantsKey = (userId: string) => `mcp:grants:${userId}`;
const grantKey = (id: string) => `mcp:grant:${id}`;

/** Loopback redirects (native apps like Claude Code) may use http; everything else must be https. */
function allowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(input: { client_name?: unknown; redirect_uris?: unknown }): Promise<OAuthClient> {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(allowedRedirect)) throw new Error("redirect_uris must be https, or http on localhost");
  const client: OAuthClient = {
    id: `mcp_${nanoid(16)}`,
    name: (typeof input.client_name === "string" && input.client_name.trim().slice(0, 60)) || "MCP client",
    redirectUris: uris,
    createdAt: new Date().toISOString(),
  };
  await kv.set(clientKey(client.id), client);
  return client;
}

export const getClient = (id: string) => kv.get<OAuthClient>(clientKey(id));

/** Native clients pick a free port each time, so a loopback redirect matches on everything but the port (RFC 8252). */
export function redirectMatches(client: OAuthClient, uri: string) {
  return client.redirectUris.some((r) => {
    if (r === uri) return true;
    try {
      const a = new URL(r);
      const b = new URL(uri);
      return a.protocol === "http:" && a.hostname === b.hostname && a.pathname === b.pathname && b.protocol === "http:" && allowedRedirect(uri);
    } catch {
      return false;
    }
  });
}

export async function issueCode(input: AuthCode) {
  const code = randomBytes(32).toString("base64url");
  await kv.set(codeKey(code), input, CODE_TTL);
  return code;
}

export interface Tokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
}

async function mint(grantId: string): Promise<Tokens> {
  const access = `lpa_${randomBytes(32).toString("base64url")}`;
  const refresh = `lpr_${randomBytes(32).toString("base64url")}`;
  await Promise.all([
    kv.set(tokenKey(access), { grantId, kind: "access" } satisfies TokenRecord, ACCESS_TTL),
    kv.set(tokenKey(refresh), { grantId, kind: "refresh" } satisfies TokenRecord, REFRESH_TTL),
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh };
}

/** Swap a code for tokens. Codes work once, and only with the PKCE verifier their challenge came from. */
export async function redeemCode(code: string, clientId: string, redirectUri: string, verifier: string): Promise<Tokens> {
  const key = codeKey(code);
  const c = await kv.get<AuthCode>(key);
  await kv.delete(key);
  if (!c || c.clientId !== clientId || c.redirectUri !== redirectUri) throw new Error("invalid_grant");
  if (createHash("sha256").update(verifier).digest("base64url") !== c.challenge) throw new Error("invalid_grant");
  const client = await getClient(clientId);
  const grant: Grant = { id: nanoid(12), userId: c.userId, ws: c.ws, clientId, clientName: client?.name ?? "MCP client", createdAt: new Date().toISOString() };
  await kv.set(grantKey(grant.id), grant);
  await kv.update<string[], void>(grantsKey(c.userId), () => [], (ids) => void ids.push(grant.id));
  return mint(grant.id);
}

/** Refresh tokens rotate: the old one stops working when a new pair is issued. */
export async function refresh(token: string, clientId: string): Promise<Tokens> {
  const rec = await kv.get<TokenRecord>(tokenKey(token));
  const grant = rec?.kind === "refresh" ? await kv.get<Grant>(grantKey(rec.grantId)) : undefined;
  if (!grant || grant.clientId !== clientId) throw new Error("invalid_grant");
  await kv.delete(tokenKey(token));
  return mint(grant.id);
}

/** The person and workspace behind a bearer token, while they're still a member of it. */
export async function authenticate(token: string): Promise<{ userId: string; ws: string; grant: Grant } | null> {
  const rec = await kv.get<TokenRecord>(tokenKey(token));
  if (rec?.kind !== "access") return null;
  const grant = await kv.get<Grant>(grantKey(rec.grantId));
  if (!grant) return null;
  if (grant.ws !== grant.userId && !(await roleIn(grant.ws, grant.userId))) return null;
  // Settings shows when each client was last used; once an hour is enough.
  if (!grant.lastUsedAt || Date.now() - Date.parse(grant.lastUsedAt) > 3600_000)
    await kv.set(grantKey(grant.id), { ...grant, lastUsedAt: new Date().toISOString() }).catch(() => undefined);
  return { userId: grant.userId, ws: grant.ws, grant };
}

export async function grantsOf(userId: string): Promise<Grant[]> {
  const ids = (await kv.get<string[]>(grantsKey(userId))) ?? [];
  const grants = await Promise.all(ids.map((id) => kv.get<Grant>(grantKey(id))));
  return grants.filter((g): g is Grant => !!g).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Disconnect a client: its tokens die with the grant. */
export async function revokeGrant(userId: string, grantId: string) {
  const grant = await kv.get<Grant>(grantKey(grantId));
  if (!grant || grant.userId !== userId) return;
  await kv.delete(grantKey(grantId));
  await kv.update<string[], void>(grantsKey(userId), () => [], (ids) => void ids.splice(0, ids.length, ...ids.filter((id) => id !== grantId)));
}
