import Link from "next/link";
import type { Looper, PublicState } from "@/lib/types";
import { Avatar, Panel, Pill, Sparkline, accentHex, fmt, timeAgo } from "./ui";

export function progress(l: Looper) {
  const values = l.metric.history.map((p) => p.value);
  const current = values.at(-1);
  if (current === undefined) return { current, pct: 0, onTrack: false };
  const base = values[0];
  const target = l.metric.target;
  const span = target - base;
  const pct = span === 0 ? 100 : Math.max(0, Math.min(100, ((current - base) / span) * 100));
  const onTrack = l.metric.direction === "up" ? current >= target : current <= target;
  return { current, pct, onTrack };
}

function countRecent(runs: PublicState["runs"], days: number) {
  const since = Date.now() - days * 864e5;
  return runs.filter((r) => Date.parse(r.startedAt) > since).length;
}

export function TeamList({ state }: { state: PublicState }) {
  const { loopers, runs, cards } = state;
  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-6rem)]">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Loopers" value={loopers.length} />
        <Stat label="Runs · 7d" value={countRecent(runs, 7)} />
        <Stat label="Open cards" value={cards.filter((c) => c.column !== "done").length} />
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[0.9375rem] font-semibold">Team</span>
          <Link href="/loopers" className="text-[0.8125rem] text-blue hover:underline">
            Manage
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loopers.length === 0 ? (
            <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue/10 text-[1.5rem] text-blue">◎</span>
              <p className="max-w-[28ch] text-[0.875rem] text-mute">No loopers yet. Ask Chief to hire your first one, or create it by hand.</p>
              <Link href="/loopers/new" className="text-[0.875rem] font-medium text-blue hover:underline">
                Create a looper
              </Link>
            </div>
          ) : (
            loopers.map((l) => {
              const { current, onTrack } = progress(l);
              const lastRun = runs.filter((r) => r.looperId === l.id).at(-1);
              return (
                <Link key={l.id} href={`/loopers/${l.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0 hover:bg-ink/[0.03]">
                  <Avatar seed={l.id} color={l.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{l.name}</span>
                      {l.status === "paused" && <Pill>Paused</Pill>}
                      {lastRun?.status === "running" && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-green" />}
                    </div>
                    <div className="truncate text-[0.8125rem] text-mute">
                      {l.metric.name} · {lastRun ? `ran ${timeAgo(lastRun.startedAt)}` : "hasn't run yet"}
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <Sparkline values={l.metric.history.map((p) => p.value)} color={accentHex[l.color]} width={72} height={26} />
                  </div>
                  <div className="w-28 shrink-0 text-right">
                    <div className="text-[1.0625rem] font-medium tabular-nums tracking-[-0.02em]">{fmt(current)}</div>
                    <div className={onTrack ? "truncate text-[0.6875rem] text-green-deep" : "truncate text-[0.6875rem] text-faint"}>
                      → {fmt(l.metric.target)} {l.metric.unit}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="tile px-4 py-3">
      <div className="text-[1.75rem] font-semibold tabular-nums tracking-[-0.03em]">{value}</div>
      <div className="mt-0.5 text-[0.75rem] text-mute">{label}</div>
    </div>
  );
}
