import type { AppRef } from "./types";

/**
 * Apps that need their own MCP server rather than a Composio connection.
 * bunq: community server github.com/WilcoKruijer/bunq-mcp, run on the user's machine.
 */
export const MCP_APPS: Record<string, { name: string; url: string; deniedTools: string[]; setup: string[]; localOnly: boolean; logo?: string }> = {
  bunq: {
    name: "bunq",
    url: "http://localhost:8788/mcp",
    // Read-only for loopers: no payments, drafts or payment requests.
    deniedTools: ["createPayment", "createDraftPayment", "createPaymentRequest"],
    setup: [
      "In the bunq app: your profile → cog → Developers → API Keys → create a key.",
      "In a terminal: npm install -g bunq-mcp && bunq-mcp --generate-keys",
      "Start it: bunq-mcp --mcp --bunq-api-key <your key>   (keep it running)",
    ],
    localOnly: true,
  },
};

/** Best guess at an app reference from a loose name ("Gmail", "bunq bank"). The slug is only a
 * placeholder for Composio apps: callers resolve it against the catalog (resolveApps). */
export function appFromName(name: string): AppRef {
  const slug = name.toLowerCase().replace(/\bbank\b|\baccount\b/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (MCP_APPS[slug]) return { slug, name: MCP_APPS[slug].name, via: "mcp" };
  return { slug, name: name.trim(), via: "composio" };
}
