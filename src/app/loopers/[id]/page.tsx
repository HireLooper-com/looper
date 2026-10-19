import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getState } from "../../actions";
import { LooperView } from "@/components/looper-view";
import { readDatabase } from "@/lib/database";
import { requireUser } from "@/lib/session";

// Server actions on this page can run a looper (model calls + tools), so allow the full 5 minutes.
export const maxDuration = 300;

export default async function LooperPage({ params, searchParams }: PageProps<"/loopers/[id]">) {
  await connection();
  const { id } = await params;
  const { tab } = await searchParams;
  const user = await requireUser();
  const state = await getState();
  const looper = state.loopers.find((l) => l.id === id);
  if (!looper) notFound();
  const table = await readDatabase(user.id, id);

  return (
    <LooperView
      looper={looper}
      cards={state.cards.filter((c) => c.looperId === id)}
      runs={state.runs.filter((r) => r.looperId === id)}
      retros={state.retros.filter((r) => r.looperId === id)}
      asks={state.asks.filter((a) => a.looperId === id)}
      integrations={state.settings.integrations}
      database={table && { name: table.name, rows: table.rows.length, rowNoun: table.rowNoun }}
      chat={state.chats?.[id] ?? []}
      ready={(() => {
        const s = state.settings;
        const mode = s.authMode[s.provider] ?? (s.subscriptions[s.provider] ? "oauth" : "key");
        return mode === "oauth" ? !!s.subscriptions[s.provider] : s.keysSet[s.provider];
      })()}
      tab={typeof tab === "string" ? tab : "chat"}
    />
  );
}
