"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { recordMetric, updateLooper } from "@/app/actions";
import type { Card, Looper, PublicSettings, Retro, Run } from "@/lib/types";
import { occurrences } from "@/lib/schedule";
import { CalendarView } from "./calendar";
import { Kanban } from "./kanban";
import { RetroBoard } from "./retro-board";
import { SkillsPanel } from "./skills-panel";
import { progress } from "./team-list";
import { Avatar, Button, Input, Pill, Sparkline, accentHex, cx, fmt } from "./ui";

const TABS = [
  { id: "board", label: "Kanban" },
  { id: "calendar", label: "Calendar" },
  { id: "retro", label: "Retro" },
  { id: "skills", label: "Skills & tools" },
];

export function LooperView(props: {
  looper: Looper;
  cards: Card[];
  runs: Run[];
  retros: Retro[];
  integrations: PublicSettings["integrations"];
  tab: string;
}) {
  const { looper, cards, runs, retros, integrations, tab } = props;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [reading, setReading] = useState("");
  const running = runs.some((r) => r.status === "running");
  const { current, pct } = progress(looper);
  const [now] = useState(() => Date.now());
  const next = looper.status === "active"
    ? looper.skills.flatMap((s) => occurrences(s.schedule, new Date(now), new Date(now + 8 * 864e5)).slice(0, 1)).sort((a, b) => a.getTime() - b.getTime())[0]
    : undefined;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [running, router]);

  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="pt-8">
      <Link href="/loopers" className="text-[0.8125rem] text-mute hover:text-ink">← All loopers</Link>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col justify-between gap-6 rounded-[8px] border border-line bg-panel p-6">
          <div className="flex items-start gap-4">
            <Avatar emoji={looper.emoji} color={looper.color} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="display text-[2.25rem]">{looper.name}</h1>
                {looper.status === "paused" ? <Pill>Paused</Pill> : <Pill tone="green">Active</Pill>}
                {running && (
                  <Pill tone="dark">
                    <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-green" /> Working
                  </Pill>
                )}
              </div>
              <p className="mt-2 max-w-[70ch] text-[0.9375rem] leading-relaxed text-ink-2">{looper.mission}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Next run" value={next ? next.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"} />
            <MiniStat label="Runs · 7d" value={String(runs.filter((r) => now - Date.parse(r.startedAt) < 7 * 864e5).length)} />
            <MiniStat label="Last retro" value={retros.length ? `${retros.at(-1)!.effectiveness}/5` : "—"} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="soft" disabled={busy} onClick={() => act(() => updateLooper(looper.id, { status: looper.status === "active" ? "paused" : "active" }))}>
              {looper.status === "active" ? "Pause looper" : "Resume looper"}
            </Button>
            <span className="text-[0.75rem] text-faint">
              {looper.status === "active" ? "Scheduled skills run automatically." : "Scheduled skills are on hold."}
            </span>
          </div>
        </div>

        <div className="rounded-[8px] bg-ink p-6 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow !text-white/45">The one metric</div>
              <div className="mt-1 text-[1rem] font-medium">{looper.metric.name}</div>
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[0.75rem] text-green">{looper.metric.direction === "up" ? "↑ higher is better" : "↓ lower is better"}</span>
          </div>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <span className="text-[3.25rem] font-medium leading-none tabular-nums tracking-[-0.04em]">{fmt(current)}</span>
              <span className="ml-2 text-[0.875rem] text-white/50">/ {fmt(looper.metric.target)} {looper.metric.unit}</span>
            </div>
            <Sparkline values={looper.metric.history.map((p) => p.value)} color={looper.color === "ink" ? "#5dd674" : accentHex[looper.color]} width={130} height={44} />
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-green" style={{ width: `${pct}%` }} />
          </div>
          <form
            className="mt-5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(reading);
              if (reading === "" || Number.isNaN(v)) return;
              setReading("");
              act(() => recordMetric(looper.id, v));
            }}
          >
            <Input
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              type="number"
              step="any"
              placeholder="Log a reading"
              className="!h-9 !border-white/10 !bg-white/[0.06] !text-white placeholder:!text-white/35"
            />
            <Button size="sm" variant="light" className="!h-9" disabled={busy || reading === ""}>
              Log
            </Button>
          </form>
        </div>
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/loopers/${looper.id}?tab=${t.id}`}
            scroll={false}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-[0.875rem] transition-colors",
              tab === t.id ? "border-ink font-medium text-ink" : "border-transparent text-mute hover:text-ink",
            )}
          >
            {t.label}
            {t.id === "board" && <span className="ml-1.5 text-faint">{cards.filter((c) => c.column !== "done").length}</span>}
            {t.id === "retro" && retros.length > 0 && <span className="ml-1.5 text-faint">{retros.length}</span>}
          </Link>
        ))}
      </div>

      <div className="pt-5">
        {tab === "calendar" ? (
          <CalendarView looper={looper} runs={runs} />
        ) : tab === "retro" ? (
          <RetroBoard looper={looper} retros={retros} running={running} />
        ) : tab === "skills" ? (
          <SkillsPanel looper={looper} runs={runs} integrations={integrations} />
        ) : (
          <Kanban looperId={looper.id} cards={cards} />
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-well px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 truncate text-[1rem] font-medium tracking-[-0.01em]">{value}</div>
    </div>
  );
}
