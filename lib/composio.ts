// Composio REST v3.1. One Composio user per workspace (lib/workspace.ts composioUserOf).
const BASE = "https://backend.composio.dev/api/v3.1";

export const TOOLKITS: Record<string, string> = {
  googleads: "Google Ads",
  metaads: "Meta",
  google_analytics: "GA4",
  google_search_console: "Search Console",
  ahrefs: "Ahrefs",
  semrush: "Semrush",
  posthog: "PostHog",
  mixpanel: "Mixpanel",
  linkedin: "LinkedIn",
  twitter: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  reddit: "Reddit",
  webflow: "Webflow",
  wordpress: "WordPress",
  mailchimp: "Mailchimp",
  kit: "Kit",
  brevo: "Brevo",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  apollo: "Apollo",
  zoho: "Zoho",
  pipedrive: "Pipedrive",
  attio: "Attio",
  close: "Close",
  calendly: "Calendly",
  stripe: "Stripe",
  shopify: "Shopify",
  quickbooks: "QuickBooks",
  xero: "Xero",
  freshbooks: "FreshBooks",
  zoho_books: "Zoho Books",
  plaid_mcp: "Plaid",
  intercom: "Intercom",
  zendesk: "Zendesk",
  crisp: "Crisp",
  freshdesk: "Freshdesk",
  help_scout: "Help Scout",
  front: "Front",
  gorgias: "Gorgias",
  zoho_desk: "Zoho Desk",
  gmail: "Gmail",
  outlook: "Outlook",
  slack: "Slack",
  googlesheets: "Google Sheets",
  googledrive: "Google Drive",
  googlecalendar: "Google Calendar",
  notion: "Notion",
  airtable: "Airtable",
  asana: "Asana",
  jira: "Jira",
  linear: "Linear",
  github: "GitHub",
  sentry: "Sentry",
  perplexityai: "Perplexity",
  openrouter: "OpenRouter",
};

export function hasComposio() {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY is not set");
  const r = await fetch(BASE + path, {
    method,
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`Composio ${r.status}: ${data?.error?.message ?? text.slice(0, 200)}`);
  return data as T;
}

// Auth config per toolkit: COMPOSIO_AUTH_CONFIGS='{"googleads":"ac_..."}' wins,
// otherwise the first enabled config in the Composio project for that toolkit.
async function authConfigFor(toolkit: string) {
  try {
    const map = JSON.parse(process.env.COMPOSIO_AUTH_CONFIGS || "{}");
    if (map[toolkit]) return String(map[toolkit]);
  } catch {}
  const res = await call<{ items: { id: string; status?: string }[] }>(
    "GET",
    `/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}&limit=5`,
  );
  const ac = res.items.find((i) => i.status !== "DISABLED") ?? res.items[0];
  if (!ac) throw new Error(`No Composio auth config for ${toolkit}. Create one in the Composio dashboard.`);
  return ac.id;
}

let enabled: { at: number; slugs: Set<string> } | null = null;

/** Toolkits with an enabled auth config in the Composio project, so only those show as connectable.
 * Cached for 5 minutes; null when Composio is not configured or does not answer. */
export async function enabledToolkits(): Promise<Set<string> | null> {
  if (!hasComposio()) return null;
  if (enabled && Date.now() - enabled.at < 5 * 60_000) return enabled.slugs;
  try {
    const slugs = new Set<string>();
    try {
      for (const k of Object.keys(JSON.parse(process.env.COMPOSIO_AUTH_CONFIGS || "{}"))) slugs.add(k);
    } catch {}
    let cursor = "";
    for (let page = 0; page < 10; page++) {
      const res = await call<{ items: { status?: string; toolkit?: { slug?: string } }[]; next_cursor?: string | null }>(
        "GET",
        `/auth_configs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      for (const i of res.items) if (i.status !== "DISABLED" && i.toolkit?.slug) slugs.add(i.toolkit.slug.toLowerCase());
      if (!res.next_cursor) break;
      cursor = res.next_cursor;
    }
    enabled = { at: Date.now(), slugs };
    return slugs;
  } catch (e) {
    console.error("enabledToolkits:", e instanceof Error ? e.message : e);
    return enabled?.slugs ?? null;
  }
}

export async function linkAccount(user: string, toolkit: string, callbackUrl: string) {
  const res = await call<{ redirect_url: string; connected_account_id: string }>("POST", "/connected_accounts/link", {
    auth_config_id: await authConfigFor(toolkit),
    user_id: user,
    callback_url: callbackUrl,
  });
  return res;
}

export type Account = { id: string; status: string; toolkit: { slug: string }; created_at?: string };

export async function listAccounts(user: string) {
  const res = await call<{ items: Account[] }>(
    "GET",
    `/connected_accounts?user_ids=${encodeURIComponent(user)}&limit=50`,
  );
  return res.items;
}

export type Tool = {
  slug: string;
  name: string;
  description: string;
  input_parameters: Record<string, unknown>;
};

/** Important tools first, then the rest of the toolkit, no duplicates, at most `limit`. */
export function mergeTools(important: Tool[], rest: Tool[], limit: number) {
  const seen = new Set<string>();
  return [...important, ...rest].filter((t) => !seen.has(t.slug) && seen.add(t.slug)).slice(0, limit);
}

// Composio's important subset can leave out the read a metric needs: for Search Console it
// holds only get site and add site, not the search analytics query. Fill up with the rest.
export async function listTools(toolkit: string, limit = 25) {
  const q = `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=${limit}`;
  const [important, rest] = await Promise.all([
    call<{ items: Tool[] }>("GET", q + "&important=true"),
    call<{ items: Tool[] }>("GET", q).catch(() => ({ items: [] as Tool[] })),
  ]);
  return mergeTools(important.items, rest.items, limit);
}

/** `account` pins the connected account, so a reconnected tool never runs on the old, broken one. */
export async function execute(user: string, toolSlug: string, args: Record<string, unknown>, account?: string | null) {
  const res = await call<{ data: unknown; successful: boolean; error: string | null }>(
    "POST",
    `/tools/execute/${encodeURIComponent(toolSlug)}`,
    { user_id: user, arguments: args, ...(account ? { connected_account_id: account } : {}) },
  );
  if (!res.successful) throw new Error(res.error || `${toolSlug} failed`);
  return res.data;
}

/**
 * A raw request to the toolkit's own API on a connected account (proxy execute). Composio adds the
 * credentials; `endpoint` is a path on the toolkit's base URL. Throws on an upstream error status.
 */
export async function proxy(account: string, method: string, endpoint: string, body?: unknown) {
  const res = await call<{ status: number; data: any }>("POST", "/tools/execute/proxy", {
    endpoint,
    method,
    connected_account_id: account,
    ...(body === undefined ? {} : { body }),
  });
  const status = Number(res.status ?? 200);
  if (status >= 400) throw new Error(`${status}: ${res.data?.message ?? JSON.stringify(res.data ?? {}).slice(0, 200)}`);
  return res.data;
}
