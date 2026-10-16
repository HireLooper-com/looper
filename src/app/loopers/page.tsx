import Link from "next/link";
import { connection } from "next/server";
import { getState } from "../actions";
import { progress } from "@/components/team-list";
import { Avatar, Pill, Sparkline, accentHex, fmt, timeAgo } from "@/components/ui";
import { describeSchedule } from "@/lib/schedule";

export default async function LoopersPage() {
  await connection();
  const { loopers, runs, cards, retros } = await getState();

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-16 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2.5rem] sm:text-[3rem]">Loopers</h1>
          <p className="mt-1 text-[1rem] text-mute">One looper, one metric.</p>
        </div>
        <Link href="/loopers/new" className="inline-flex h-10 items-center rounded-full bg-blue px-5 text-[0.9375rem] font-medium text-white hover:bg-blue-hover">
          New looper
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loopers.map((l) => {
          const { current, pct } = progress(l);
          const lastRetro = retros.filter((r) => r.looperId === l.id).at(-1);
          const lastRun = runs.filter((r) => r.looperId === l.id).at(-1);
          return (
            <Link key={l.id} href={`/loopers/${l.id}`} className="tile group flex flex-col gap-5 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar seed={l.id} color={l.color} size={44} />
                  <div>
                    <div className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{l.name}</div>
                    <div className="text-[0.8125rem] text-mute">{lastRun ? `Last run ${timeAgo(lastRun.startedAt)}` : "Not run yet"}</div>
                  </div>
                </div>
                {l.status === "paused" ? <Pill>Paused</Pill> : <Pill tone="green">Active</Pill>}
              </div>
              <p className="line-clamp-2 min-h-[2.6em] text-[0.875rem] leading-snug text-ink-2">{l.mission}</p>
              <div className="rounded-[14px] bg-well p-4">
                <div className="eyebrow">{l.metric.name}</div>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <div>
                    <span className="text-[2rem] font-semibold tabular-nums tracking-[-0.03em]">{fmt(current)}</span>
                    <span className="ml-1.5 text-[0.8125rem] text-mute">/ {fmt(l.metric.target)} {l.metric.unit}</span>
                  </div>
                  <Sparkline values={l.metric.history.map((p) => p.value)} color={accentHex[l.color]} width={90} height={32} />
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e3e3e8]">
                  <div className="h-full rounded-full bg-blue" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[0.75rem] text-mute">
                <Pill>{cards.filter((c) => c.looperId === l.id && c.column !== "done").length} open cards</Pill>
                <Pill>{l.skills.length} skills</Pill>
                {lastRetro && <Pill tone="lavender">Retro {lastRetro.effectiveness}/5</Pill>}
              </div>
              <div className="truncate text-[0.75rem] text-faint">{l.skills.map((s) => `${s.name} · ${describeSchedule(s.schedule)}`).join("  ·  ")}</div>
            </Link>
          );
        })}
        <Link href="/loopers/new" className="tile flex min-h-64 flex-col items-center justify-center gap-3 text-blue">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue/10 text-[1.75rem] leading-none">+</span>
          <span className="text-[0.875rem]">Hire a looper</span>
        </Link>
      </div>
    </div>
  );
}
