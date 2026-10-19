"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Accent } from "@/lib/types";
import { useActivity, useActivityState, type ActiveJob } from "./live";
import { Bot, cx } from "./ui";

type LooperRef = { id: string; color: Accent };
const looperOf = (href: string) => href.match(/^\/loopers\/([\w-]+)/)?.[1];

function JobBot({ job, loopers, size }: { job: ActiveJob; loopers: LooperRef[]; size: number }) {
  const id = looperOf(job.href);
  const l = loopers.find((x) => x.id === id);
  return l ? <Bot size={size} color={l.color} seed={l.id} className={cx(!job.finishedAt && "looping")} /> : <Bot size={size} dark seed="chief" className={cx(!job.finishedAt && "looping")} />;
}

const elapsed = (since: number, now: number) => {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** Ticks once a second while something is shown, for the elapsed timers. */
function useTicker(on: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [on]);
  return now;
}

/** The rail's "Working" list: everything running in the background, with its current step. */
export function WorkingTray({ loopers }: { loopers: LooperRef[] }) {
  const active = useActivity().filter((j) => !j.finishedAt);
  const now = useTicker(active.length > 0);
  if (!active.length) return null;
  return (
    <div className="fade-up mt-1">
      <div className="eyebrow px-3 pb-1 pt-3">Working</div>
      {active.map((j) => (
        <Link key={j.target} href={j.href} className="flex items-center gap-3 rounded-[14px] px-2.5 py-1.5 hover:bg-ink/[0.03]">
          <span className="flex w-11 justify-center">
            <JobBot job={j} loopers={loopers} size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[0.8125rem] font-medium">{j.label}</span>
              {now > 0 && <span className="ml-auto shrink-0 text-[0.6875rem] tabular-nums text-faint">{elapsed(j.since, now)}</span>}
            </span>
            <span className="block truncate text-[0.75rem] text-mute">{j.step ?? "Starting…"}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Small notices when background work finishes, so you can go elsewhere and come back. */
export function Notices({ loopers }: { loopers: LooperRef[] }) {
  const router = useRouter();
  const { jobs, loaded } = useActivityState();
  const seen = useRef<Set<string> | null>(null);
  const activeCount = useRef(0);
  const [shown, setShown] = useState<ActiveJob[]>([]);

  useEffect(() => {
    const key = (j: ActiveJob) => `${j.target}@${j.finishedAt}`;
    const finished = jobs.filter((j) => j.finishedAt);
    const running = jobs.length - finished.length;
    if (!loaded) return;
    // Anything that already finished before this page loaded isn't news.
    if (seen.current === null) {
      seen.current = new Set(finished.map(key));
      activeCount.current = running;
      return;
    }
    const fresh = finished.filter((j) => !seen.current!.has(key(j)));
    fresh.forEach((j) => seen.current!.add(key(j)));
    // Something started or finished: refresh what's on screen (rail, boards, chat).
    if (fresh.length || running !== activeCount.current) router.refresh();
    activeCount.current = running;
    if (!fresh.length) return;
    const t = setTimeout(() => {
      setShown((s) => [...s.filter((x) => !fresh.some((f) => f.target === x.target)), ...fresh].slice(-3));
    }, 0);
    return () => clearTimeout(t);
  }, [jobs, loaded, router]);

  useEffect(() => {
    if (!shown.length) return;
    const t = setTimeout(() => setShown((s) => s.slice(1)), 9000);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[55] flex w-[min(360px,calc(100vw-40px))] flex-col gap-2">
      {shown.map((j) => (
        <div key={`${j.target}@${j.finishedAt}`} className="pop-in pointer-events-auto flex items-start gap-3 rounded-[16px] bg-panel p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
          <JobBot job={j} loopers={loopers} size={28} />
          <div className="min-w-0 flex-1">
            <div className="text-[0.875rem] font-medium">
              {j.ok === false ? <span className="mr-1 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-red" /> : null}
              {j.label} {j.ok === false ? (j.failed ?? "didn't finish") : (j.done ?? "is done")}
            </div>
            {j.note && <div className="mt-0.5 line-clamp-2 text-[0.8125rem] text-mute">{j.note}</div>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Link href={j.href} onClick={() => setShown((s) => s.filter((x) => x !== j))} className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-[0.75rem] font-medium hover:bg-ink/[0.1]">
              View
            </Link>
            <button onClick={() => setShown((s) => s.filter((x) => x !== j))} className="text-[0.6875rem] text-faint hover:text-ink">
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
