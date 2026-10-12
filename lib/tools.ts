import { sql } from "./db";
import { enabledToolkits, execute, hasComposio, listTools, proxy, TOOLKITS, type Tool } from "./composio";
import type { Gh } from "./publish";
import { connectorsOf, customTools, executeCustom, isCustom, PREFIX } from "./connectors";
import { composioUserOf } from "./workspace";
import { KINDS } from "./roles";

// One place for "which tools does this workspace have": Composio toolkits plus the
// workspace's custom connectors. The engine only talks to these functions.

type Ws = { id: number; composio_user: string | null };

export async function wsById(id: number): Promise<Ws> {
  const [ws] = await sql<Ws>`select id, composio_user from workspaces where id = ${id}`;
  return ws;
}

export async function isConnected(workspaceId: number, toolkit: string) {
  if (!toolkit) return false;
  if (isCustom(toolkit)) {
    const [c] = await sql`select 1 from connectors where workspace_id = ${workspaceId} and slug = ${toolkit.slice(PREFIX.length)}`;
    return Boolean(c);
  }
  if (!hasComposio()) return false;
  const [c] = await sql`select 1 from ws_connections where workspace_id = ${workspaceId} and toolkit = ${toolkit} and status = 'ACTIVE'`;
  return Boolean(c);
}

/** Toolkits the workspace is signed in to. */
export async function connectedSet(workspaceId: number) {
  const rows = await sql<{ toolkit: string }>`select toolkit from ws_connections where workspace_id = ${workspaceId} and status = 'ACTIVE'`;
  return new Set(rows.map((r) => r.toolkit));
}

export type Alt = { slug: string; name: string; connected: boolean };

/** What can fill a kind in this workspace: its tools that are connected or can be, then every custom connector. Connected first. */
export async function altsOf(workspaceId: number, kind: string, connected: Set<string>): Promise<Alt[]> {
  const can = await connectableNames(workspaceId);
  const own = KINDS[kind].tools.filter((t) => can[t] || connected.has(t)).map((t) => ({ slug: t, name: can[t] ?? TOOLKITS[t] ?? t, connected: connected.has(t) }));
  const custom = Object.entries(can).filter(([s]) => isCustom(s)).map(([slug, name]) => ({ slug, name, connected: true }));
  return [...own, ...custom].sort((a, b) => Number(b.connected) - Number(a.connected));
}

/** A tool may fill this kind: one of its tools a founder can connect, or a custom connector. */
export async function fills(workspaceId: number, kind: string, slug: string) {
  const can = await connectableNames(workspaceId);
  return Boolean(can[slug] && (isCustom(slug) || KINDS[kind].tools.includes(slug)));
}

export async function toolsFor(workspaceId: number, toolkit: string, limit = 25): Promise<Tool[]> {
  return isCustom(toolkit) ? customTools(workspaceId, toolkit) : listTools(toolkit, limit);
}

export async function runTool(ws: Ws, slug: string, args: Record<string, unknown>) {
  if (slug.startsWith("X_")) return executeCustom(ws.id, slug, args);
  // Tool slugs start with their toolkit (SEMRUSH_KEYWORD_DIFFICULTY); the longest match wins.
  const [c] = await sql<{ account_id: string }>`
    select account_id from ws_connections
    where workspace_id = ${ws.id} and status = 'ACTIVE' and upper(${slug}) like upper(toolkit) || '\\_%'
    order by length(toolkit) desc limit 1`;
  return execute(composioUserOf(ws), slug, args, c?.account_id);
}

/** GitHub REST on the workspace's connected GitHub account, for pull requests (lib/publish.ts). */
export async function githubFor(ws: Ws): Promise<Gh> {
  const [c] = await sql<{ account_id: string }>`
    select account_id from ws_connections where workspace_id = ${ws.id} and toolkit = 'github' and status = 'ACTIVE'`;
  if (!c) throw new Error("Connect GitHub first");
  return (method, path, body) =>
    proxy(c.account_id, method, path, body).catch((e: Error) => {
      throw new Error(`GitHub ${e.message}`);
    });
}

/** A tool error that a fresh sign-in or API key fixes, not a retry. */
export function isAuthError(message: string | null) {
  return Boolean(
    message &&
      /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ](api[_ ])?(key|token|credentials)|expired[_ ]token|empty key|wrong key|api disabled|api units balance is zero/i.test(
        message,
      ),
  );
}

/** Display names for every toolkit the workspace can use. */
export async function toolkitNames(workspaceId: number): Promise<Record<string, string>> {
  const custom = await connectorsOf(workspaceId);
  return { ...TOOLKITS, ...Object.fromEntries(custom.map((c) => [PREFIX + c.slug, c.name])) };
}

/** Toolkits a founder can connect now: Composio toolkits with an enabled auth config, plus custom connectors.
 * Without an answer from Composio every toolkit is listed, so local setups keep working. */
export async function connectableNames(workspaceId: number): Promise<Record<string, string>> {
  const [names, on] = await Promise.all([toolkitNames(workspaceId), enabledToolkits()]);
  if (!on) return names;
  return Object.fromEntries(Object.entries(names).filter(([s]) => isCustom(s) || on.has(s)));
}

/** `back` with `tool_error` added before any #hash, so a failed connect lands on the page it came from. */
export function withToolError(back: string, message: string) {
  const [path, hash] = back.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}tool_error=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}
