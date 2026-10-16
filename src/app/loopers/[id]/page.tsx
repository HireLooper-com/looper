// Server actions on this page can run a looper (model calls + tools), so allow the full 5 minutes.
export const maxDuration = 300;

import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getState } from "../../actions";
import { LooperView } from "@/components/looper-view";

export default async function LooperPage({ params, searchParams }: PageProps<"/loopers/[id]">) {
  await connection();
  const { id } = await params;
  const { tab } = await searchParams;
  const state = await getState();
  const looper = state.loopers.find((l) => l.id === id);
  if (!looper) notFound();

  return (
    <LooperView
      looper={looper}
      cards={state.cards.filter((c) => c.looperId === id)}
      runs={state.runs.filter((r) => r.looperId === id)}
      retros={state.retros.filter((r) => r.looperId === id)}
      integrations={state.settings.integrations}
      tab={typeof tab === "string" ? tab : "board"}
    />
  );
}
