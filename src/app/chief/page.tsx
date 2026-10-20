import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getState } from "../actions";
import { ChiefChat } from "@/components/chief-chat";
import { requireUser } from "@/lib/session";
import { modelReady } from "@/lib/types";
import { dailyBrief, inboxItems } from "@/lib/inbox";
import { getWorkspace } from "@/lib/workspace";

// Server actions on this page can run a looper (model calls + tools), so allow the full 5 minutes.
export const maxDuration = 300;

export default async function ChiefPage() {
  await connection();
  const [user, state] = await Promise.all([requireUser(), getState()]);
  // A brand-new workspace starts with onboarding instead of an empty chat.
  if (!state.onboarded && state.loopers.length === 0 && state.chief.length === 0) redirect("/welcome");
  const s = state.settings;
  const ready = modelReady(s);
  const ws = await getWorkspace(user.ws);
  // Invite the team once there's something to show: a team of one with a looper that has finished a run.
  const invite = ws?.kind === "team" && ws.members.length === 1 && ws.ownerId === user.id && state.runs.some((r) => r.status === "success");
  const starters = state.profile?.suggestions.length
    ? [...state.profile.suggestions.map((x) => `Hire a looper to ${x.goal}`), "How is the team doing this week?", "What should I focus on today?"]
    : undefined;

  return (
    <div className="flex h-[calc(100dvh-58px)] flex-col lg:h-dvh">
      <div className="min-h-0 flex-1">
        <ChiefChat messages={state.chief} ready={ready} brief={dailyBrief(state)} email={state.user.email} inbox={inboxItems(state).length} starters={starters} invite={invite} />
      </div>
    </div>
  );
}
