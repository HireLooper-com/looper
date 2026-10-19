"use client";

import Link from "next/link";
import type { BriefLine } from "@/lib/inbox";
import { Bot, cx, fmt } from "./ui";
import { useNow } from "./use-now";

const greeting = (h: number) => (h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
const firstName = (email?: string) => {
  const local = (email ?? "").split("@")[0].split(/[._-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : "";
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** Chief's morning card: what moved in the last day, what's waiting on you, what's next today. */
export function DailyBrief({ lines, email, inbox }: { lines: BriefLine[]; email?: string; inbox: number }) {
  const now = useNow();
  if (!lines.length) return null;
  const worked = lines.filter((l) => l.done + l.failed > 0).length;
  const name = firstName(email);
  return (
    <div className="tile fade-up mb-4 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-2 px-5 pb-3 pt-5">
        <div>
          <div className="text-[1.375rem] font-semibold tracking-[-0.02em]">
            {now ? greeting(new Date(now).getHours()) : "Hello"}
            {name && `, ${name}`}
          </div>
          <div className="mt-0.5 text-[0.875rem] text-mute">
            {worked ? `${worked} of ${lines.length} looper${lines.length === 1 ? "" : "s"} worked in the last day` : "A quiet day so far"}
            {inbox > 0 && (
              <>
                {" · "}
                <Link href="/inbox" className="font-medium text-ink hover:underline">
                  {inbox} thing{inbox === 1 ? "" : "s"} need{inbox === 1 ? "s" : ""} you
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="text-[0.8125rem] text-faint">{now ? new Date(now).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }) : ""}</div>
      </div>
      <div className="divide-y divide-line border-t border-line">
        {lines.map((l) => {
          const did = [l.done && `${l.done} run${l.done === 1 ? "" : "s"}`, l.rows && `${l.rows} rows`, l.cardsDone && `${l.cardsDone} done`, l.failed && `${l.failed} didn't finish`].filter(Boolean);
          return (
            <Link key={l.looper.id} href={`/loopers/${l.looper.id}`} className="flex gap-3 px-5 py-3 transition-colors hover:bg-ink/[0.025]">
              <Bot size={32} color={l.looper.color} seed={l.looper.id} className={cx(l.looper.status === "paused" && "opacity-40 grayscale")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[0.9375rem] font-medium">{l.looper.name}</span>
                  <span className="text-[0.875rem]">
                    {l.metric.value === undefined ? (
                      <span className="text-mute">{l.metric.name}: no reading yet</span>
                    ) : (
                      <>
                        <span className="font-semibold tabular-nums">{fmt(l.metric.value)}</span> <span className="text-mute">{l.metric.name}</span>
                      </>
                    )}
                  </span>
                  {l.metric.trend && <span className={cx("text-[0.75rem] tabular-nums", l.metric.good ? "text-ink" : "text-mute")}>{l.metric.trend} today</span>}
                  {l.needsYou > 0 && <span className="ml-auto rounded-full bg-ink/[0.07] px-2 text-[0.6875rem] font-medium leading-[18px]">{l.needsYou} for you</span>}
                </div>
                {l.latest && <div className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-ink-2">{l.latest}</div>}
                <div className="mt-1 text-[0.75rem] text-mute">
                  {l.looper.status === "paused" ? "Paused" : did.length ? did.join(" · ") : "No runs in the last day"}
                  {l.next && ` · next ${l.next.skill} at ${hhmm(l.next.at)}`}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
