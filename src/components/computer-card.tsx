import Link from "next/link";
import { Panel, timeAgo } from "./ui";

/** On the Tools tab: the looper's own computer, next to its apps. Watching happens under Tasks. */
export function ComputerCard({ looperId, looperName, summary }: { looperId: string; looperName: string; summary: { sessions: number; lastAt?: string; live: boolean } }) {
  return (
    <Panel className="flex flex-wrap items-center gap-4 p-6">
      <div className="min-w-0 flex-1">
        <div className="text-[1.25rem] font-semibold tracking-[-0.01em]">Computer</div>
        <p className="mt-1 max-w-[56ch] text-[0.875rem] text-mute">
          {looperName} has a private Linux machine with Chrome for websites no app covers. It remembers logins and sleeps between runs.
          {summary.live ? " Working on it now." : summary.lastAt ? ` Last used ${timeAgo(summary.lastAt)}.` : ""}
        </p>
      </div>
      <Link href={`/loopers/${looperId}?tab=computer`} className="rounded-full bg-ink/[0.06] px-4 py-2 text-[0.875rem] font-medium hover:bg-ink/[0.1]">
        {summary.live ? "Watch live" : summary.sessions ? "Watch sessions" : "Open computer"}
      </Link>
    </Panel>
  );
}
