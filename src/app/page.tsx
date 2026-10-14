import { connection } from "next/server";
import { getState } from "./actions";
import { ChiefChat } from "@/components/chief-chat";
import { TeamList } from "@/components/team-list";

export default async function Home() {
  await connection();
  const state = await getState();
  const ready = state.settings.keysSet[state.settings.provider];

  return (
    <div className="flex flex-col gap-4 pt-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ChiefChat messages={state.chief} ready={ready} provider={state.settings.provider} model={state.settings.models[state.settings.provider]} />
        <TeamList state={state} />
      </div>
    </div>
  );
}
