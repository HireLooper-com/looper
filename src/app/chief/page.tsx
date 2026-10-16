import { connection } from "next/server";
import { getState } from "../actions";
import { ChiefChat } from "@/components/chief-chat";
import { Bot } from "@/components/ui";
import { PROVIDERS } from "@/lib/types";

// Server actions on this page can run a looper (model calls + tools), so allow the full 5 minutes.
export const maxDuration = 300;

export default async function ChiefPage() {
  await connection();
  const state = await getState();
  const s = state.settings;
  const mode = s.authMode[s.provider] ?? (s.subscriptions[s.provider] ? "oauth" : "key");
  const ready = mode === "oauth" ? !!s.subscriptions[s.provider] : s.keysSet[s.provider];
  const plan = PROVIDERS.find((p) => p.id === s.provider)?.plan ?? "";

  return (
    <div className="flex h-[calc(100dvh-58px)] flex-col lg:h-dvh">
      <header className="flex items-center justify-center gap-2 border-b border-black/[0.05] py-3">
        <Bot dark seed="chief" size={26} />
        <span className="text-[0.9375rem] font-semibold">Chief</span>
        <span className="text-[0.8125rem] text-mute">· {ready ? `${plan} ${mode === "oauth" ? "plan" : "API key"} · ${s.models[s.provider]}` : "not connected"}</span>
      </header>
      <div className="min-h-0 flex-1">
        <ChiefChat messages={state.chief} ready={ready} />
      </div>
    </div>
  );
}
