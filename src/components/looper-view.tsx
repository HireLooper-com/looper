"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { askLooper, clearLooperChat, updateLooper } from "@/app/actions";
import { occurrences } from "@/lib/schedule";
import type { Ask, Card, ChiefMessage, Looper, PublicSettings, Retro, Run } from "@/lib/types";
import { cardAssignee } from "@/lib/types";
import { AppsPanel } from "./apps-panel";
import { ChatPanel } from "./chat-panel";
import { CalendarView } from "./calendar";
import { CanvasBoard } from "./canvas-board";
import { DatabaseView } from "./database-view";
import { Kanban } from "./kanban";
import { MetricView } from "./metric-view";
import { RetroBoard } from "./retro-board";
import { SkillsPanel } from "./skills-panel";
import { Button, Sparkline, cx, fmt } from "./ui";
import { useNow } from "./use-now";

// Five places per looper. Work, Knowledge and Setup each hold two views of the same thing.
type View = "chat" | "board" | "calendar" | "database" | "canvas" | "retro" | "skills" | "apps" | "metric";
const GROUPS: { id: string; label: string; views: View[] }[] = [
  { id: "chat", label: "Chat", views: ["chat"] },
  { id: "work", label: "Work", views: ["board", "calendar"] },
  { id: "knowledge", label: "Knowledge", views: ["database", "canvas"] },
  { id: "retro", label: "Retro", views: ["retro"] },
  { id: "setup", label: "Setup", views: ["skills", "apps"] },
];
const VIEWS = new Set<string>(["chat", "board", "calendar", "database", "canvas", "retro", "skills", "apps", "metric"]);
const VIEW_LABEL: Partial<Record<View, string>> = { board: "Kanban", calendar: "Calendar", database: "Database", canvas: "Canvas", skills: "Skills", apps: "Apps" };
const FULL_HEIGHT = new Set<View>(["chat", "canvas"]);

export function LooperView(props: {
  looper: Looper;
  cards: Card[];
  runs: Run[];
  retros: Retro[];
  asks: Ask[];
  integrations: PublicSettings["integrations"];
  database: { name: string; rows: number; rowNoun: string } | null;
  chat: ChiefMessage[];
  ready: boolean;
  tab: string;
}) {
  const { looper, cards, runs, retros, database } = props;
  const view: View = VIEWS.has(props.tab) ? (props.tab as View) : "chat";
  const group = GROUPS.find((g) => g.views.includes(view));
  const router = useRouter();
  const running = runs.find((r) => r.status === "running");
  const now = useNow();

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [running, router]);

  const forYou = cards.filter((c) => c.column !== "done" && cardAssignee(c) === "you").length;
  const counts: Partial<Record<string, number>> = {
    work: forYou || undefined,
    chat: props.asks.filter((a) => a.status === "open").length || undefined,
    database: database?.rows || undefined,
    apps: looper.apps?.length || undefined,
  };

  // Sliding underline under the active place.
  const nav = useRef<HTMLElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[data-active="true"]');
    setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [group?.id]);

  return (
    <div className={cx("flex flex-col", FULL_HEIGHT.has(view) && "h-[calc(100dvh-58px)] lg:h-dvh")}>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink/[0.05] bg-page/85 px-4 backdrop-blur-xl sm:px-6">
        <nav ref={nav} className="relative flex min-w-0 shrink-0 gap-1 overflow-x-auto" aria-label={`${looper.name} sections`}>
          {GROUPS.map((g) => {
            const active = g.id === group?.id;
            const n = counts[g.id];
            return (
              <Link
                key={g.id}
                data-active={active}
                href={`/loopers/${looper.id}?tab=${active ? view : g.views[0]}`}
                scroll={false}
                className={cx(
                  "flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-3 pt-3.5 text-[0.875rem] outline-none transition-colors focus-visible:text-ink",
                  active ? "font-medium text-ink" : "text-mute hover:text-ink",
                  active && !bar ? "border-ink" : "border-transparent",
                )}
              >
                {g.label}
                {n !== undefined && <span className="rounded-full bg-ink/[0.07] px-1.5 text-[0.6875rem] tabular-nums text-ink">{n}</span>}
              </Link>
            );
          })}
          {bar && <span className="absolute bottom-0 h-0.5 rounded-full bg-ink transition-all duration-300 ease-out" style={{ left: bar.left, width: bar.width }} />}
        </nav>

        {group && group.views.length > 1 && (
          <div className="hidden shrink-0 rounded-full bg-ink/[0.05] p-0.5 sm:flex">
            {group.views.map((v) => (
              <Link
                key={v}
                href={`/loopers/${looper.id}?tab=${v}`}
                scroll={false}
                className={cx("rounded-full px-3 py-1 text-[0.8125rem] transition-colors", v === view ? "bg-panel font-medium text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "text-mute hover:text-ink")}
              >
                {VIEW_LABEL[v]}
                {counts[v] !== undefined && <span className="ml-1 text-[0.6875rem] tabular-nums text-mute">{counts[v]}</span>}
              </Link>
            ))}
          </div>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-2 py-2">
          {running && (
            <Link href={`/loopers/${looper.id}?tab=chat`} className="hidden items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1 text-[0.8125rem] text-mute hover:text-ink md:flex">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ink" />
              {running.skillName}
            </Link>
          )}
          {looper.status === "paused" && <PausedPill looper={looper} />}
          <MetricStrip looper={looper} active={view === "metric"} now={now} />
        </div>
      </header>

      {view === "chat" || view === "canvas" ? (
        <div key={view} className="fade-up min-h-0 flex-1">
          {view === "chat" ? (
            <LooperChat looper={looper} messages={props.chat} runs={runs} asks={props.asks} ready={props.ready} />
          ) : (
            <CanvasBoard looper={{ id: looper.id, name: looper.name, color: looper.color }} running={!!running} />
          )}
        </div>
      ) : (
        <div key={view} className="fade-up min-w-0 px-4 py-6 sm:px-6">
          {group && group.views.length > 1 && (
            <div className="mb-4 flex rounded-full bg-ink/[0.05] p-0.5 sm:hidden">
              {group.views.map((v) => (
                <Link key={v} href={`/loopers/${looper.id}?tab=${v}`} scroll={false} className={cx("flex-1 rounded-full py-1.5 text-center text-[0.8125rem]", v === view ? "bg-panel font-medium shadow-sm" : "text-mute")}>
                  {VIEW_LABEL[v]}
                </Link>
              ))}
            </div>
          )}
          {view === "metric" ? (
            <MetricView looper={looper} />
          ) : view === "calendar" ? (
            <CalendarView looper={looper} runs={runs} />
          ) : view === "database" ? (
            <DatabaseView looperId={looper.id} looperName={looper.name} color={looper.color} />
          ) : view === "retro" ? (
            <RetroBoard
              looper={looper}
              retros={retros}
              reflecting={running && looper.skills.find((s) => s.id === running.skillId)?.kind === "retro" ? { runId: running.id } : undefined}
              lastError={(() => {
                const last = runs.filter((r) => looper.skills.find((s) => s.id === r.skillId)?.kind === "retro").at(-1);
                return last?.status === "error" && now - Date.parse(last.startedAt) < 10 * 60_000 ? last.summary : undefined;
              })()}
            />
          ) : view === "apps" ? (
            <AppsPanel looperId={looper.id} looperName={looper.name} />
          ) : view === "skills" ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-4 [&>*]:w-full [&>*]:max-w-none">
              <StatusCard looper={looper} now={now} />
              <SkillsPanel looper={looper} runs={runs} integrations={props.integrations} />
            </div>
          ) : (
            <Kanban looperId={looper.id} cards={cards} looperName={looper.name} color={looper.color} />
          )}
        </div>
      )}
    </div>
  );
}

/** The looper's one number, always in view: value, trend, target. Opens the chart. */
function MetricStrip({ looper, active, now }: { looper: Looper; active: boolean; now: number }) {
  const h = looper.metric.history;
  const last = h.at(-1);
  const weekAgo = now ? new Date(now - 7 * 864e5).toISOString() : "";
  const base = [...h].reverse().find((p) => p.at < weekAgo) ?? h[0];
  const delta = last && base && base !== last ? last.value - base.value : undefined;
  const good = delta !== undefined && delta !== 0 && (looper.metric.direction === "up" ? delta > 0 : delta < 0);
  return (
    <Link
      href={`/loopers/${looper.id}?tab=metric`}
      scroll={false}
      title={`${looper.metric.name}: ${fmt(last?.value)} of ${fmt(looper.metric.target)} ${looper.metric.unit}. Open the chart.`}
      className={cx("flex min-w-0 items-center gap-2.5 rounded-full py-1 pl-3 pr-3.5 transition-colors", active ? "bg-ink/[0.08]" : "hover:bg-ink/[0.05]")}
    >
      {h.length > 1 && (
        <span className="hidden lg:block">
          <Sparkline values={h.slice(-14).map((p) => p.value)} color="var(--color-ink)" width={52} height={20} />
        </span>
      )}
      <span className="min-w-0 truncate text-[0.875rem]">
        <span className="font-semibold tabular-nums">{fmt(last?.value)}</span> <span className="text-mute">{looper.metric.name}</span>
        <span className="hidden text-faint xl:inline"> → {fmt(looper.metric.target)}</span>
      </span>
      {delta !== undefined && delta !== 0 && (
        <span className={cx("shrink-0 text-[0.75rem] tabular-nums", good ? "text-ink" : "text-mute")}>
          {delta > 0 ? "▲" : "▼"}
          {fmt(Math.abs(delta))}
        </span>
      )}
    </Link>
  );
}

function PausedPill({ looper }: { looper: Looper }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [resumed, setResumed] = useState(false);
  if (resumed) return null;
  return (
    <button
      disabled={busy}
      onClick={() => {
        setResumed(true);
        start(async () => {
          await updateLooper(looper.id, { status: "active" });
          router.refresh();
        });
      }}
      className="shrink-0 rounded-full bg-ink/[0.05] px-3 py-1 text-[0.8125rem] text-mute hover:text-ink"
    >
      Paused · <span className="font-medium text-ink">Resume</span>
    </button>
  );
}

/** Setup's first card: is it on, and when does it work next. */
function StatusCard({ looper: saved, now }: { looper: Looper; now: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // Flip at once; the server catches up.
  const [status, setStatus] = useState<Looper["status"] | null>(null);
  const looper = status && status !== saved.status && busy ? { ...saved, status } : saved;
  const next =
    now && looper.status === "active"
      ? looper.skills
          .flatMap((s) => occurrences(s.schedule, new Date(now), new Date(now + 8 * 864e5)).slice(0, 1).map((at) => ({ at, s })))
          .sort((a, b) => a.at.getTime() - b.at.getTime())[0]
      : undefined;
  const when = (d: Date) => d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="tile flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <div className="flex items-center gap-2 text-[1.0625rem] font-medium">
          <span className={cx("h-2 w-2 rounded-full", looper.status === "active" ? "bg-ink" : "bg-faint")} />
          {looper.status === "active" ? "Working on schedule" : "Paused"}
        </div>
        <div className="mt-0.5 text-[0.8125rem] text-mute">
          {looper.status === "active" ? (next ? `Next: ${next.s.name}, ${when(next.at)}` : "Nothing scheduled") : "Scheduled skills won't run until you resume."}
        </div>
      </div>
      <Button
        size="sm"
        variant={looper.status === "active" ? "soft" : "primary"}
        disabled={busy}
        onClick={() => {
          const next = looper.status === "active" ? "paused" : "active";
          setStatus(next);
          start(async () => {
            await updateLooper(looper.id, { status: next });
            router.refresh();
          });
        }}
      >
        {looper.status === "active" ? "Pause" : "Resume"}
      </Button>
    </div>
  );
}

function LooperChat({ looper, messages, runs, asks, ready }: { looper: Looper; messages: ChiefMessage[]; runs: Run[]; asks: Ask[]; ready: boolean }) {
  return (
    <ChatPanel
      bot={{ name: looper.name, color: looper.color, seed: looper.id }}
      looperId={looper.id}
      messages={messages}
      asks={asks}
      runs={runs.filter((r) => r.summary || r.status === "running")}
      ready={ready}
      starters={[`What did you do on your last run?`, `What's blocking ${looper.metric.name}?`, `Show me what's in your database`, `Change how you work`]}
      emptyTitle={`Hi, I'm ${looper.name}`}
      emptyText={`I own one number: ${looper.metric.name}. Ask me anything, give me a task, or change how I work. My runs report here too.`}
      placeholder={`Message ${looper.name}`}
      send={(t) => askLooper(looper.id, t)}
      progressTarget={`chat:${looper.id}`}
      clear={() => clearLooperChat(looper.id)}
    />
  );
}
