import { connection } from "next/server";
import { getState } from "../actions";
import { ChiefChat } from "@/components/chief-chat";
import { dailyBrief, inboxItems } from "@/lib/inbox";

// Server actions on this page can run a looper (model calls + tools), so allow the full 5 minutes.
export const maxDuration = 300;

export default async function ChiefPage() {
  await connection();
  const state = await getState();
  const s = state.settings;
  const mode = s.authMode[s.provider] ?? (s.subscriptions[s.provider] ? "oauth" : "key");
  const ready = mode === "oauth" ? !!s.subscriptions[s.provider] : s.keysSet[s.provider];

  return (
    <div className="flex h-[calc(100dvh-58px)] flex-col lg:h-dvh">
      <div className="min-h-0 flex-1">
        <ChiefChat messages={state.chief} ready={ready} brief={dailyBrief(state)} email={state.user.email} inbox={inboxItems(state).length} />
      </div>
    </div>
  );
}
