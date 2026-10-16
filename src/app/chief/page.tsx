// Server actions on this page can run a looper (model calls + tools), so allow the full 5 minutes.
export const maxDuration = 300;

import { connection } from "next/server";
import { getState } from "../actions";
import { ChiefChat } from "@/components/chief-chat";
import { TeamList } from "@/components/team-list";
import { PROVIDERS } from "@/lib/types";

export default async function ChiefPage() {
  await connection();
  const state = await getState();
  const s = state.settings;
  const mode = s.authMode[s.provider] ?? (s.subscriptions[s.provider] ? "oauth" : "key");
  const ready = mode === "oauth" ? !!s.subscriptions[s.provider] : s.keysSet[s.provider];
  const plan = PROVIDERS.find((p) => p.id === s.provider)?.plan ?? "";

  return (
    <div className="grid grid-cols-1 gap-5 pt-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <ChiefChat messages={state.chief} ready={ready} source={mode === "oauth" ? `${plan} plan` : `${plan} API key`} model={s.models[s.provider]} />
      <TeamList state={state} />
    </div>
  );
}
