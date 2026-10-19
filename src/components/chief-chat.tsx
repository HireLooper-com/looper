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

export function ChiefChat({ messages, ready, brief, email, inbox }: { messages: ChiefMessage[]; ready: boolean; brief: BriefLine[]; email?: string; inbox: number }) {
  return (
    <ChatPanel
      bot={{ name: "Chief", dark: true, seed: "chief" }}
      messages={messages}
      ready={ready}
      header={<DailyBrief lines={brief} email={email} inbox={inbox} />}
      notReadyHint={
        <Link href="/settings" className="rounded-full bg-blue px-5 py-2.5 text-[0.9375rem] font-medium text-page">
          Connect your plan in Settings
        </Link>
      }
      starters={STARTERS}
      emptyTitle="What should we move?"
      emptyText="Tell Chief a goal. It hires a looper that owns one number, with its own chat, board, calendar, database and retro."
      placeholder="Message Chief"
      send={askChief}
      progressTarget="chief"
      clear={clearChief}
    />
  );
}
