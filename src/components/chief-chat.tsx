"use client";

import Link from "next/link";
import { askChief, clearChief } from "@/app/actions";
import type { BriefLine } from "@/lib/inbox";
import type { ChiefMessage } from "@/lib/types";
import { DailyBrief } from "./daily-brief";
import { ChatPanel } from "./chat-panel";

const STARTERS = [
  "Hire a looper to grow LinkedIn impressions to 50k/month",
  "Hire a looper to prepare my quarterly VAT return",
  "I want weekly qualified demo calls to go from 4 to 10",
  "How is the team doing this week?",
  "What should I focus on today?",
];

export function ChiefChat({ messages, ready, brief, email, inbox, starters, invite }: { messages: ChiefMessage[]; ready: boolean; brief: BriefLine[]; email?: string; inbox: number; starters?: string[]; invite?: boolean }) {
  return (
    <ChatPanel
      bot={{ name: "Chief", dark: true, seed: "chief" }}
      messages={messages}
      ready={ready}
      header={
        <>
          {invite && (
            <Link href="/workspace" className="tile fade-up flex items-center justify-between gap-3 px-5 py-4 hover:bg-ink/[0.02]">
              <span>
                <span className="block text-[0.9375rem] font-medium">Your first looper has results. Bring in your team.</span>
                <span className="block text-[0.8125rem] text-mute">Everyone you invite works with the same loopers, boards and approvals.</span>
              </span>
              <span className="shrink-0 text-[0.875rem] font-medium">Invite →</span>
            </Link>
          )}
          <DailyBrief lines={brief} email={email} inbox={inbox} />
        </>
      }
      notReadyHint={
        <Link href="/settings" className="rounded-full bg-blue px-5 py-2.5 text-[0.9375rem] font-medium text-page">
          Connect your plan in Settings
        </Link>
      }
      starters={starters ?? STARTERS}
      emptyTitle="What should we move?"
      emptyText="Tell Chief a goal. It hires a looper that owns one business metric, with its own chat, board, calendar, database and retro."
      placeholder="Message Chief"
      send={askChief}
      progressTarget="chief"
      clear={clearChief}
    />
  );
}
