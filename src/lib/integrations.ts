import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { mutate } from "./db";
import { kv } from "./kv";
import { oauthProvider } from "./mcp-connect";
import type { Integration, Looper, Settings } from "./types";

type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

export interface ConnectedTools {
  tools: ToolSet;
  connected: string[];
  failed: { name: string; error: string }[];
  close: () => Promise<void>;
}

export function integrationsFor(looper: Looper | null, settings: Settings): Integration[] {
  const enabled = settings.integrations.filter((i) => i.enabled);
  if (!looper || looper.integrationIds === "all") return enabled;
  const ids = looper.integrationIds;
  // An app's own server (Buffer, bunq) belongs to every looper that needs the app.
  const apps = new Set((looper.apps ?? []).map((a) => a.slug));
  return enabled.filter((i) => ids.includes(i.id) || (i.app && apps.has(i.app)));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "mcp";

/**
 * Connect to every MCP hub the looper may use. The agent keeps these tools inactive until the
 * model finds them with `find_tools`, which keeps thousands of integrations affordable per run.
 */
export async function connectTools(integrations: Integration[], uid?: string): Promise<ConnectedTools> {
  const clients: MCPClient[] = [];
  const tools: ToolSet = {};
  const connected: string[] = [];
  const failed: ConnectedTools["failed"] = [];

  await Promise.all(
    integrations.map(async (integration) => {
      try {
        const client = await createMCPClient({
          transport: { type: "http", url: integration.url, headers: integration.headers, redirect: "follow", authProvider: signIn(integration, uid) },
        });
        clients.push(client);
        const set = await client.tools();
        const prefix = slug(integration.name);
        const denied = new Set(integration.deniedTools ?? []);
        for (const [name, t] of Object.entries(set)) {
          if (denied.has(name)) continue;
          const key = integrations.length > 1 ? `${prefix}__${name}` : name;
          tools[key] = t;
        }
        connected.push(`${integration.name} (${Object.keys(set).length} tools)`);
      } catch (error) {
        failed.push({ name: integration.name, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );

  return {
    tools,
    connected,
    failed,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}

/** OAuth for servers signed in to directly; refreshed tokens are saved back so the next run reuses them. */
function signIn(integration: Integration, uid?: string) {
  if (!integration.oauth) return undefined;
  const { redirectUrl, client, tokens } = integration.oauth;
  return oauthProvider({ redirectUrl, client, tokens }, async (fresh) => {
    if (!uid) return;
    await mutate(uid, (db) => {
      const i = db.settings.integrations.find((x) => x.id === integration.id);
      if (i?.oauth) i.oauth.tokens = fresh;
    });
  }).provider;
}

export async function testIntegration(integration: Integration, uid?: string) {
  const result = await connectTools([integration], uid);
  const names = Object.keys(result.tools);
  await result.close();
  if (result.failed.length) return { ok: false as const, error: result.failed[0].error };
  return { ok: true as const, count: names.length, sample: names.slice(0, 12) };
}

/** Save an app's own MCP server as its one connection (replacing an older one), and let Composio retry later. */
export async function saveAppServer(uid: string, integration: Integration) {
  await mutate(uid, (db) => {
    db.settings.integrations = db.settings.integrations.filter((i) => i.app !== integration.app);
    db.settings.integrations.push(integration);
  });
  await kv.delete(`composio-broken:${integration.app}`).catch(() => undefined);
}
