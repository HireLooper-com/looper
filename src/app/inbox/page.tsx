import { connection } from "next/server";
import { InboxView, type AppTodo } from "@/components/inbox-view";
import { activeAccounts, hasComposio } from "@/lib/composio";
import { read } from "@/lib/db";
import { inboxItems } from "@/lib/inbox";
import { requireUser } from "@/lib/session";

// Answering or retrying here starts looper work in the background.
export const maxDuration = 300;

export default async function InboxPage() {
  await connection();
  const user = await requireUser();
  const db = await read(user.ws);
  const items = inboxItems(db);

  // Apps a looper needs that aren't connected yet (one catalog call for all loopers).
  let apps: AppTodo[] = [];
  if (hasComposio() && db.loopers.some((l) => l.apps?.some((a) => a.via === "composio"))) {
    const connected = await activeAccounts(user.ws).catch(() => null);
    // Apps Composio can't connect may be connected through their own MCP server.
    const ownServer = new Set(db.settings.integrations.filter((i) => i.enabled && i.app).map((i) => i.app));
    if (connected)
      apps = db.loopers.flatMap((l) =>
        (l.apps ?? []).filter((a) => a.via === "composio" && !connected.has(a.slug) && !ownServer.has(a.slug)).map((a) => ({ looperId: l.id, slug: a.slug, name: a.name, logo: a.logo })),
      );
  }

  return <InboxView items={items} apps={apps} loopers={db.loopers.map((l) => ({ id: l.id, name: l.name, color: l.color }))} />;
}
