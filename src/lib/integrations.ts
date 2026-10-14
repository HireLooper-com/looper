import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
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
  return enabled.filter((i) => ids.includes(i.id));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "mcp";

/**
 * Connect to every MCP hub the looper may use. The agent keeps these tools inactive until the
 * model finds them with `find_tools`, which keeps thousands of integrations affordable per run.
 */
export async function connectTools(integrations: Integration[]): Promise<ConnectedTools> {
  const clients: MCPClient[] = [];
  const tools: ToolSet = {};
  const connected: string[] = [];
  const failed: ConnectedTools["failed"] = [];

  await Promise.all(
    integrations.map(async (integration) => {
      try {
        const client = await createMCPClient({
          transport: { type: "http", url: integration.url, headers: integration.headers, redirect: "follow" },
        });
        clients.push(client);
        const set = await client.tools();
        const prefix = slug(integration.name);
        for (const [name, t] of Object.entries(set)) {
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

export async function testIntegration(integration: Integration) {
  const result = await connectTools([integration]);
  const names = Object.keys(result.tools);
  await result.close();
  if (result.failed.length) return { ok: false as const, error: result.failed[0].error };
  return { ok: true as const, count: names.length, sample: names.slice(0, 12) };
}
