import { sql } from "./db";
import { decrypt } from "./crypto";
import { isPublic } from "./net";
import type { Tool } from "./composio";

// Custom connectors: an internal or niche REST API the founder describes as a list of
// endpoints. Each endpoint becomes a tool the looper can read from or put on a card,
// exactly like a Composio tool. Toolkit slug `x_<slug>`, tool slug `X_<SLUG>_<METHOD>_<NAME>`,
// so GET endpoints count as read tools in a routine run.
//
// Hosted, the base URL must be a public host. On-prem installs set
// LOOPER_ALLOW_PRIVATE_HOSTS=1 so connectors can reach services inside the network.

export type Endpoint = {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // "/orders/{id}"; {id} is filled from the arguments
  description: string;
  params?: Record<string, { type: string; description?: string }>;
};

export type Connector = {
  id: number;
  workspace_id: number;
  slug: string;
  name: string;
  base_url: string;
  auth_header: string;
  auth_enc: string | null;
  endpoints: Endpoint[];
};

export const PREFIX = "x_";
export const isCustom = (toolkit: string) => toolkit.startsWith(PREFIX);
const toolSlug = (c: { slug: string }, e: Endpoint) => `X_${c.slug}_${e.method}_${e.name}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");

/** Parse and check the endpoint list a founder pastes. Throws a readable error. */
export function parseEndpoints(raw: string): Endpoint[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error("Endpoints must be JSON: a list of { name, method, path, description, params }.");
  }
  if (!Array.isArray(list) || !list.length) throw new Error("Add at least 1 endpoint.");
  if (list.length > 40) throw new Error("At most 40 endpoints per connector.");
  return list.map((e, i) => {
    const x = e as Partial<Endpoint>;
    const method = String(x.method ?? "GET").toUpperCase() as Endpoint["method"];
    if (!x.name || !/^[a-z0-9_]{2,40}$/i.test(x.name)) throw new Error(`Endpoint ${i + 1}: name is 2 to 40 letters, digits or _.`);
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error(`Endpoint ${x.name}: method is GET, POST, PUT, PATCH or DELETE.`);
    if (!x.path || !x.path.startsWith("/")) throw new Error(`Endpoint ${x.name}: path starts with /.`);
    const params: Endpoint["params"] = {};
    for (const [k, v] of Object.entries(x.params ?? {})) {
      const t = typeof v === "string" ? v : String((v as { type?: string })?.type ?? "string");
      params[k] = { type: ["string", "number", "integer", "boolean"].includes(t) ? t : "string", description: (v as { description?: string })?.description };
    }
    return { name: x.name, method, path: x.path, description: String(x.description ?? "").slice(0, 500), params };
  });
}

export async function connectorsOf(workspaceId: number) {
  return sql<Connector>`select * from connectors where workspace_id = ${workspaceId} order by id`;
}

async function bySlug(workspaceId: number, toolkit: string) {
  const [c] = await sql<Connector>`select * from connectors where workspace_id = ${workspaceId} and slug = ${toolkit.slice(PREFIX.length)}`;
  return c ?? null;
}

/** The connector's endpoints in the same shape as Composio tools. */
export function connectorTools(c: Connector): Tool[] {
  return c.endpoints.map((e) => {
    const params = { ...(e.params ?? {}) };
    for (const m of e.path.matchAll(/\{(\w+)\}/g)) params[m[1]] ??= { type: "string", description: "Path parameter" };
    return {
      slug: toolSlug(c, e),
      name: `${c.name}: ${e.name}`,
      description: `${e.method} ${e.path}. ${e.description}`.trim(),
      input_parameters: {
        type: "object",
        properties: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { type: v.type, description: v.description ?? "" }])),
      },
    };
  });
}

export async function customTools(workspaceId: number, toolkit: string) {
  const c = await bySlug(workspaceId, toolkit);
  return c ? connectorTools(c) : [];
}

/** Call one endpoint. Path params fill {name}, the rest go in the query (GET, DELETE) or a JSON body. */
export async function executeCustom(workspaceId: number, slug: string, args: Record<string, unknown>) {
  const all = await connectorsOf(workspaceId);
  for (const c of all) {
    const e = c.endpoints.find((x) => toolSlug(c, x) === slug);
    if (!e) continue;
    const rest = { ...args };
    const path = e.path.replace(/\{(\w+)\}/g, (_, k) => {
      const v = rest[k];
      delete rest[k];
      return encodeURIComponent(String(v ?? ""));
    });
    const url = new URL(c.base_url.replace(/\/$/, "") + path);
    const bodyless = e.method === "GET" || e.method === "DELETE";
    if (bodyless) for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    if (process.env.LOOPER_ALLOW_PRIVATE_HOSTS !== "1" && !(await isPublic(url))) throw new Error(`${c.name}: ${url.hostname} is not a public host`);
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "Looper/1.0 (+https://hirelooper.com)" };
    if (c.auth_enc) headers[c.auth_header] = decrypt(c.auth_enc);
    if (!bodyless) headers["content-type"] = "application/json";
    const r = await fetch(url, {
      method: e.method,
      headers,
      body: bodyless ? undefined : JSON.stringify(rest),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const text = (await r.text()).slice(0, 20_000);
    if (!r.ok) throw new Error(`${c.name} ${r.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  throw new Error(`Unknown tool ${slug}`);
}
