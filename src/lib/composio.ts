import "server-only";
import { jsonSchema, tool, type ToolSet } from "ai";

// Composio REST v3.1. One Composio user per Chieflooper user (user_id = our uid).
// Docs: https://docs.composio.dev/reference
const BASE = "https://backend.composio.dev/api/v3.1";

export const hasComposio = () => Boolean(process.env.COMPOSIO_API_KEY);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY is not set on the server.");
  const r = await fetch(BASE + path, {
    method,
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`Composio ${r.status}: ${data?.error?.message ?? text.slice(0, 200)}`);
  return data as T;
}

interface Toolkit {
  slug: string;
  name: string;
  meta?: { logo?: string; description?: string };
  auth_schemes?: string[];
  composio_managed_auth_schemes?: string[];
  no_auth?: boolean;
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function searchToolkits(q: string, limit = 12) {
  return cached(`search:${q.toLowerCase()}`, 10 * 60_000, async () => {
    const res = await call<{ items: Toolkit[] }>("GET", `/toolkits?search=${encodeURIComponent(q)}&sort_by=usage&limit=${limit}`);
    return res.items.map((t) => ({ slug: t.slug, name: t.name, logo: t.meta?.logo }));
  });
}

export function getToolkit(slug: string) {
  return cached(`toolkit:${slug}`, 60 * 60_000, () => call<Toolkit>("GET", `/toolkits/${encodeURIComponent(slug)}`));
}

/** The project's auth config for a toolkit, creating one when missing: Composio-managed OAuth when
 * available, otherwise a custom config with empty credentials so the Connect page asks the user. */
async function authConfigFor(slug: string): Promise<string> {
  const existing = await call<{ items: { id: string; status?: string }[] }>("GET", `/auth_configs?toolkit_slug=${encodeURIComponent(slug)}&limit=10`);
  const enabled = existing.items.find((i) => i.status !== "DISABLED");
  if (enabled) return enabled.id;

  const tk = await getToolkit(slug);
  if (tk.no_auth) throw new Error(`${tk.name} needs no connection.`);
  const managed = (tk.composio_managed_auth_schemes ?? []).length > 0;
  const scheme = tk.auth_schemes?.[0] ?? "API_KEY";
  const body = managed
    ? { toolkit: { slug }, auth_config: { type: "use_composio_managed_auth", name: tk.name } }
    : { toolkit: { slug }, auth_config: { type: "use_custom_auth", authScheme: scheme, name: tk.name, credentials: {} } };
  const created = await call<{ auth_config: { id: string } }>("POST", "/auth_configs", body);
  return created.auth_config.id;
}

/** Start a hosted Connect flow; returns where to send the browser and the account being created. */
export async function linkAccount(uid: string, slug: string, callbackUrl: string) {
  return call<{ redirect_url: string; connected_account_id: string; expires_at?: string }>("POST", "/connected_accounts/link", {
    auth_config_id: await authConfigFor(slug),
    user_id: uid,
    callback_url: callbackUrl,
  });
}

export interface Account {
  id: string;
  status: "INITIALIZING" | "INITIATED" | "ACTIVE" | "FAILED" | "EXPIRED" | "INACTIVE" | "REVOKED";
  toolkit: { slug: string };
  is_disabled?: boolean;
  state?: { val?: { displayName?: string } };
  updated_at?: string;
}

export async function listAccounts(uid: string): Promise<Account[]> {
  const res = await call<{ items: Account[] }>("GET", `/connected_accounts?user_ids=${encodeURIComponent(uid)}&limit=100&order_by=updated_at`);
  return res.items;
}

export function getAccount(id: string) {
  return call<Account & { user_id?: string }>("GET", `/connected_accounts/${encodeURIComponent(id)}`);
}

/** Newest usable account per toolkit. */
export async function activeAccounts(uid: string) {
  const map = new Map<string, Account>();
  for (const a of await listAccounts(uid)) if (a.status === "ACTIVE" && !a.is_disabled && !map.has(a.toolkit.slug)) map.set(a.toolkit.slug, a);
  return map;
}

interface ComposioTool {
  slug: string;
  name: string;
  description: string;
  input_parameters: Record<string, unknown>;
}

/** Important tools first, then the rest of the toolkit, at most `limit`. */
function listTools(slug: string, limit = 40) {
  return cached(`tools:${slug}`, 30 * 60_000, async () => {
    const q = `/tools?toolkit_slug=${encodeURIComponent(slug)}&limit=${limit}`;
    const [important, rest] = await Promise.all([
      call<{ items: ComposioTool[] }>("GET", `${q}&important=true`),
      call<{ items: ComposioTool[] }>("GET", q).catch(() => ({ items: [] as ComposioTool[] })),
    ]);
    const seen = new Set<string>();
    return [...important.items, ...rest.items].filter((t) => !seen.has(t.slug) && seen.add(t.slug)).slice(0, limit);
  });
}

async function execute(uid: string, toolSlug: string, args: Record<string, unknown>, account: string) {
  const res = await call<{ data: unknown; successful: boolean; error: string | null }>("POST", `/tools/execute/${encodeURIComponent(toolSlug)}`, {
    user_id: uid,
    connected_account_id: account,
    arguments: args,
  });
  // Tool failures come back as HTTP 200 with successful:false.
  if (!res.successful) throw new Error(res.error || `${toolSlug} failed`);
  return res.data;
}

/** AI SDK tools for the given toolkits, bound to the user's connected accounts. */
export async function composioTools(uid: string, slugs: string[]): Promise<{ tools: ToolSet; connected: string[]; missing: string[] }> {
  if (!hasComposio() || slugs.length === 0) return { tools: {}, connected: [], missing: slugs };
  const accounts = await activeAccounts(uid);
  const tools: ToolSet = {};
  const connected: string[] = [];
  const missing: string[] = [];
  await Promise.all(
    slugs.map(async (slug) => {
      const account = accounts.get(slug);
      if (!account) return void missing.push(slug);
      const list = await listTools(slug).catch(() => []);
      for (const t of list)
        tools[t.slug] = tool({
          description: `${t.name}: ${t.description}`.slice(0, 1000),
          inputSchema: jsonSchema(t.input_parameters as Parameters<typeof jsonSchema>[0]),
          execute: async (args) => {
            const data = await execute(uid, t.slug, args as Record<string, unknown>, account.id);
            const text = JSON.stringify(data);
            return text.length > 20_000 ? `${text.slice(0, 20_000)}… (truncated)` : data;
          },
        });
      connected.push(`${slug} (${list.length} tools)`);
    }),
  );
  return { tools, connected, missing };
}
