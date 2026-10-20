import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getState } from "../../actions";
import { LooperView } from "@/components/looper-view";
import { readCanvas } from "@/lib/canvas";
import { computerSummary, hasComputer } from "@/lib/computer";
import { readDatabase } from "@/lib/database";
import { requireUser } from "@/lib/session";
import { modelReady } from "@/lib/types";

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
  const [table, canvas, computer] = await Promise.all([
    readDatabase(user.ws, id),
    readCanvas(user.ws, id).catch(() => null),
    hasComputer() ? computerSummary(user.ws, id).catch(() => null) : null,
  ]);

  return (
    <LooperView
      looper={looper}
      cards={state.cards.filter((c) => c.looperId === id)}
      runs={state.runs.filter((r) => r.looperId === id)}
      retros={state.retros.filter((r) => r.looperId === id)}
      asks={state.asks.filter((a) => a.looperId === id)}
      integrations={state.settings.integrations}
      database={table && { name: table.name, rows: table.rows.length, rowNoun: table.rowNoun }}
      computer={computer}
      canvasItems={canvas?.items.filter((i) => i.kind !== "arrow").length ?? 0}
      chat={state.chats?.[id] ?? []}
      ready={modelReady(state.settings)}
      tab={typeof tab === "string" ? tab : "chat"}
    />
  );
}
