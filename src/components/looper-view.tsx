"use client";

import { useNow } from "./use-now";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { recordMetric, updateLooper } from "@/app/actions";
import { occurrences } from "@/lib/schedule";
import type { Card, Looper, PublicSettings, Retro, Run } from "@/lib/types";
import { AppsPanel } from "./apps-panel";
import { CalendarView } from "./calendar";
import { DatabaseView } from "./database-view";
import { Kanban } from "./kanban";
import { RetroBoard } from "./retro-board";
import { SkillsPanel } from "./skills-panel";
import { progress } from "./team-list";
import { Avatar, Button, Input, Sparkline, accentHex, cx, fmt } from "./ui";

const TABS = [
  { id: "board", label: "Kanban", icon: "▦" },
  { id: "database", label: "Database", icon: "☷" },
  { id: "calendar", label: "Calendar", icon: "◷" },
  { id: "retro", label: "Retro", icon: "↺" },
  { id: "apps", label: "Apps", icon: "⌘" },
  { id: "skills", label: "Skills", icon: "✧" },
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
  const { current, pct, onTrack } = progress(looper);
  const now = useNow();
  const next =
    now && looper.status === "active"
      ? looper.skills.flatMap((s) => occurrences(s.schedule, new Date(now), new Date(now + 8 * 864e5)).slice(0, 1)).sort((a, b) => a.getTime() - b.getTime())[0]
      : undefined;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [running, router]);

  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  const counts: Record<string, number | undefined> = {
    board: cards.filter((c) => c.column !== "done").length,
    retro: retros.length || undefined,
    skills: looper.skills.length,
    apps: looper.apps?.length || undefined,
  };

  return (
    <div className="grid grid-cols-1 gap-5 pt-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-[4.5rem] lg:self-start">
        <div className="tile p-5">
          <div className="flex items-center gap-3">
            <Avatar seed={looper.id} color={looper.color} size={52} />
            <div className="min-w-0">
              <h1 className="truncate text-[1.375rem] font-semibold tracking-[-0.02em]">{looper.name}</h1>
              <div className="flex items-center gap-1.5 text-[0.8125rem] text-mute">
                <span className={cx("h-2 w-2 rounded-full", running ? "pulse-dot bg-green" : looper.status === "active" ? "bg-green" : "bg-faint")} />
                {running ? "Working now" : looper.status === "active" ? "Active" : "Paused"}
              </div>
            </div>
          </div>
          <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-2">{looper.mission}</p>

          <div className="mt-5 rounded-[14px] bg-well p-4">
            <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-mute">
              <span className="truncate">{looper.metric.name}</span>
              <span>{looper.metric.direction === "up" ? "↑" : "↓"}</span>
            </div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <div>
                <span className="text-[2.25rem] font-semibold leading-none tracking-[-0.035em] tabular-nums">{fmt(current)}</span>
                <div className="mt-1 text-[0.75rem] text-faint">
                  target {fmt(looper.metric.target)} {looper.metric.unit}
                </div>
              </div>
              <Sparkline values={looper.metric.history.map((p) => p.value)} color={accentHex[looper.color]} width={96} height={36} />
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e3e3e8]">
              <div className={cx("h-full rounded-full", onTrack ? "bg-green" : "bg-blue")} style={{ width: `${pct}%` }} />
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = Number(reading);
                if (reading === "" || Number.isNaN(v)) return;
                setReading("");
                act(() => recordMetric(looper.id, v));
              }}
            >
              <Input value={reading} onChange={(e) => setReading(e.target.value)} type="number" step="any" placeholder="Log a reading" className="!h-8 !text-[0.8125rem]" />
              <Button size="sm" variant="soft" disabled={busy || reading === ""}>
                Log
              </Button>
            </form>
          </div>
        </div>

        <nav className="tile p-2">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/loopers/${looper.id}?tab=${t.id}`}
              scroll={false}
              className={cx(
                "flex items-center gap-3 rounded-[10px] px-3 py-2 text-[0.9375rem] transition-colors",
                tab === t.id ? "bg-blue text-white" : "text-ink hover:bg-black/[0.04]",
              )}
            >
              <span className={cx("w-5 text-center", tab === t.id ? "text-white" : "text-blue")}>{t.icon}</span>
              <span className="flex-1">{t.label}</span>
              {counts[t.id] !== undefined && <span className={cx("text-[0.8125rem]", tab === t.id ? "text-white/80" : "text-faint")}>{counts[t.id]}</span>}
            </Link>
          ))}
        </nav>

        <div className="tile flex items-center justify-between gap-3 p-4 text-[0.8125rem]">
          <div>
            <div className="text-mute">Next run</div>
            <div className="font-semibold">{next ? next.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}</div>
          </div>
          <Button size="sm" variant="soft" disabled={busy} onClick={() => act(() => updateLooper(looper.id, { status: looper.status === "active" ? "paused" : "active" }))}>
            {looper.status === "active" ? "Pause" : "Resume"}
          </Button>
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="display text-[1.75rem]">{TABS.find((t) => t.id === tab)?.label ?? "Kanban"}</h2>
          <Link href="/loopers" className="text-[0.875rem] text-blue hover:underline">
            All loopers
          </Link>
        </div>
        {tab === "calendar" ? (
          <CalendarView looper={looper} runs={runs} />
        ) : tab === "retro" ? (
          <RetroBoard looper={looper} retros={retros} running={running} />
        ) : tab === "database" ? (
          <DatabaseView looperId={looper.id} looperName={looper.name} />
        ) : tab === "apps" ? (
          <AppsPanel looperId={looper.id} looperName={looper.name} />
        ) : tab === "skills" ? (
          <SkillsPanel looper={looper} runs={runs} integrations={integrations} />
        ) : (
          <Kanban looperId={looper.id} cards={cards} />
        )}
      </main>
    </div>
  );
}
