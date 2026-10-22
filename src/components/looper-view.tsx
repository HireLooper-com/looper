"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { askLooper, clearLooperChat, updateLooper } from "@/app/actions";
import { occurrences } from "@/lib/schedule";
import type { Ask, Card, ChiefMessage, Looper, ModelMenu, PublicSettings, Retro, Run } from "@/lib/types";
import { cardAssignee } from "@/lib/types";
import { AppsPanel } from "./apps-panel";
import { ComputerCard } from "./computer-card";
import { ComputerView } from "./computer-view";
import { ChatPanel } from "./chat-panel";
import { ChatModelPicker } from "./model-picker";
import { CalendarView } from "./calendar";
import { CanvasBoard } from "./canvas-board";
import { DatabaseView } from "./database-view";
import { Kanban } from "./kanban";
import { MetricView } from "./metric-view";
import { RetroBoard } from "./retro-board";
import { SkillsPanel } from "./skills-panel";
import { Bot, Button, Sparkline, accentHex, cx, fmt, timeAgo } from "./ui";
import { useNow } from "./use-now";

// Six places per looper: talk, what I do and when, what I keep, what I have, how it's going, who I am.
type View = "chat" | "board" | "calendar" | "computer" | "database" | "canvas" | "retro" | "skills" | "apps" | "metric";
const GROUPS: { id: string; label: string; views: View[] }[] = [
  { id: "chat", label: "Chat", views: ["chat"] },
  { id: "tasks", label: "Tasks", views: ["board", "calendar", "computer"] },
  { id: "space", label: "Space", views: ["database", "canvas"] },
  { id: "tools", label: "Tools", views: ["apps"] },
  { id: "results", label: "Results", views: ["metric", "retro"] },
  { id: "skills", label: "Skills", views: ["skills"] },
];
const VIEWS = new Set<string>(["chat", "board", "calendar", "computer", "database", "canvas", "retro", "skills", "apps", "metric"]);
const VIEW_LABEL: Partial<Record<View, string>> = { metric: "Metric", retro: "Retros", board: "Kanban", calendar: "Calendar", computer: "Computer", database: "Database", canvas: "Canvas", skills: "Skills", apps: "Apps" };
const FULL_HEIGHT = new Set<View>(["chat", "canvas"]);
const GROUP_ICON: Record<string, React.ReactNode> = {
  chat: <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 2.8V14.5H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z" />,
  tasks: <path d="M3.5 5.5l1.5 1.5 2.5-3M3.5 12.5l1.5 1.5 2.5-3M10.5 5.5h6M10.5 12.5h6" />,
  space: (
    <>
      <ellipse cx="10" cy="5" rx="6.5" ry="2.5" />
      <path d="M3.5 5v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V5M3.5 10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
    </>
  ),
  tools: <path d="M12.2 3.4a4 4 0 0 0-4.6 5.4l-4.4 4.4a1.6 1.6 0 0 0 2.3 2.3l4.4-4.4a4 4 0 0 0 5.4-4.6l-2.4 2.4-2.3-.6-.6-2.3z" />,
  results: <path d="M3 15l4.5-5 3 3L17 5M13 5h4v4" />,
  skills: <path d="M10 3l1.8 4.2L16 9l-4.2 1.8L10 15l-1.8-4.2L4 9l4.2-1.8z" />,
};

export function LooperView(props: {
  looper: Looper;
  cards: Card[];
  runs: Run[];
  retros: Retro[];
  asks: Ask[];
  integrations: PublicSettings["integrations"];
  database: { name: string; rows: number; rowNoun: string } | null;
  canvasItems: number;
  computer: { sessions: number; lastAt?: string; live: boolean } | null;
  chat: ChiefMessage[];
  ready: boolean;
  menu: ModelMenu;
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
    tasks: forYou || undefined,
    chat: props.asks.filter((a) => a.status === "open").length || undefined,
    database: database?.rows || undefined,
    tools: looper.apps?.length || undefined,
  };

  // What's in each view, shown in the tab menus so you know the other one is worth a look.
  const open = cards.filter((c) => c.column !== "done").length;
  const nextRun =
    now && looper.status === "active"
      ? looper.skills
          .flatMap((sk) => occurrences(sk.schedule, new Date(now), new Date(now + 8 * 864e5)).slice(0, 1).map((at) => ({ at, sk })))
          .sort((a, b) => a.at.getTime() - b.at.getTime())[0]
      : undefined;
  const scheduled = looper.skills.filter((sk) => sk.schedule.type !== "manual").length;
  const lastValue = looper.metric.history.at(-1)?.value;
  const lastRetro = retros.at(-1);
  const previews: Partial<Record<View, string>> = {
    metric: lastValue === undefined ? "No reading yet" : `${fmt(lastValue)} now · target ${fmt(looper.metric.target)}`,
    retro: lastRetro ? `${retros.length} retro${retros.length === 1 ? "" : "s"} · last scored ${lastRetro.effectiveness}/5` : "No retro yet",
    board: open ? `${open} open card${open === 1 ? "" : "s"}${forYou ? ` · ${forYou} for you` : ""}` : "No open cards",
    calendar: nextRun
      ? `Next: ${nextRun.sk.name}, ${nextRun.at.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}`
      : looper.status === "paused"
        ? `Paused · ${scheduled} scheduled skill${scheduled === 1 ? "" : "s"}`
        : "Nothing scheduled",
    computer: !props.computer
      ? "Not available"
      : props.computer.live
        ? "Working on it now · watch live"
        : props.computer.sessions
          ? `${props.computer.sessions} session${props.computer.sessions === 1 ? "" : "s"} · last ${timeAgo(props.computer.lastAt)}`
          : "Not used yet",
    database: database ? `${database.name} · ${database.rows} row${database.rows === 1 ? "" : "s"}` : "Not set up yet",
    canvas: props.canvasItems ? `${props.canvasItems} item${props.canvasItems === 1 ? "" : "s"} on the board` : "Empty board",
    skills: `${looper.skills.length} skill${looper.skills.length === 1 ? "" : "s"} · ${scheduled} on a schedule`,
    apps: looper.apps?.length ? `${looper.apps.length} connected` : "None connected yet",
  };
  const [menu, setMenu] = useState<{ id: string; left: number; top: number; keyboard: boolean } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = (id: string, e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.parentElement!.getBoundingClientRect();
    const keyboard = e.detail === 0;
    setMenu((m) => (m?.id === id ? null : { id, left: r.left, top: r.bottom, keyboard }));
  };

  // Sliding glow behind the active place, in the looper's colour.
  const nav = useRef<HTMLElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[data-active="true"]');
    setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [group?.id, view]);
  const glow = accentHex[looper.color];

  return (
    <div className={cx("flex flex-col", FULL_HEIGHT.has(view) && "h-[calc(100dvh-58px)] lg:h-dvh")}>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink/[0.05] bg-page/85 px-4 py-2.5 backdrop-blur-xl sm:px-6 2xl:grid 2xl:grid-cols-[1fr_auto_1fr]">
        <div className="hidden 2xl:block" />
        <nav
          ref={nav}
          className="relative flex min-w-0 shrink-0 gap-0.5 overflow-x-auto rounded-full bg-panel/85 p-[5px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-[0.5px] ring-ink/[0.12] [scrollbar-width:none]"
          aria-label={`${looper.name} sections`}
        >
          {bar && (
            <span
              aria-hidden
              className="absolute inset-y-[5px] rounded-full transition-all duration-300 ease-out"
              style={{
                left: bar.left,
                width: bar.width,
                background: `radial-gradient(120% 140% at 50% 0%, ${glow}73, ${glow}2e)`,
                boxShadow: `inset 0 0 0 0.5px ${glow}80, 0 0 18px ${glow}59`,
              }}
            />
          )}
          {GROUPS.map((g) => {
            const active = g.id === group?.id;
            const n = counts[g.id];
            const multi = g.views.length > 1;
            const tab = cx(
              "relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.875rem] transition-colors focus-visible:text-ink quiet-focus",
              active ? "font-medium text-ink" : "text-mute hover:text-ink",
              active && !bar && "bg-ink/[0.08]",
            );
            const inner = (
              <>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden className="shrink-0">
                  {GROUP_ICON[g.id]}
                </svg>
                {g.label}
                {multi && active && <span className="font-normal text-ink/60">· {VIEW_LABEL[view]}</span>}
                {n !== undefined && <span className="rounded-full bg-ink/[0.08] px-1.5 text-[0.6875rem] font-normal tabular-nums text-ink">{n}</span>}
              </>
            );
            if (!multi)
              return (
                <Link key={g.id} data-active={active} href={`/loopers/${looper.id}?tab=${g.views[0]}`} scroll={false} className={tab}>
                  {inner}
                </Link>
              );
            // Two views in one place: the tab opens a menu that says what's in each.
            return (
              <div key={g.id} data-active={active} className={cx(tab, "gap-0 px-0")}>
                {active ? (
                  <button onClick={(e) => openMenu(g.id, e)} aria-haspopup="menu" aria-expanded={menu?.id === g.id} className="flex items-center gap-1.5 pl-3 quiet-focus">
                    {inner}
                  </button>
                ) : (
                  <Link href={`/loopers/${looper.id}?tab=${g.views[0]}`} scroll={false} className="flex items-center gap-1.5 pl-3 quiet-focus">
                    {inner}
                  </Link>
                )}
                <button
                  aria-label={`${g.label} views`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === g.id}
                  onClick={(e) => openMenu(g.id, e)}
                  className={cx("ml-0.5 mr-1.5 flex h-5 w-5 items-center justify-center rounded-full text-mute transition-colors hover:bg-ink/[0.08] hover:text-ink quiet-focus focus-visible:bg-ink/[0.1]", menu?.id === g.id && "bg-ink/[0.08] text-ink")}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cx("transition-transform", menu?.id === g.id && "rotate-180")}>
                    <path d="m2.5 4 2.5 2.5L7.5 4" />
                  </svg>
                </button>
              </div>
            );
          })}
        </nav>

        {menu && (
          <ViewMenu
            at={menu}
            views={GROUPS.find((g) => g.id === menu.id)!.views.map((v) => ({ v, label: VIEW_LABEL[v]!, preview: previews[v] ?? "" }))}
            current={view}
            href={(v) => `/loopers/${looper.id}?tab=${v}`}
            onClose={closeMenu}
          />
        )}

        <div className="ml-auto flex min-w-0 items-center gap-2 2xl:justify-self-end">
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
            <LooperChat looper={looper} messages={props.chat} runs={runs} asks={props.asks} ready={props.ready} menu={props.menu} />
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
          ) : view === "computer" ? (
            <ComputerView looper={{ id: looper.id, name: looper.name, color: looper.color }} />
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
            <div className="flex flex-col gap-4">
              <AppsPanel looperId={looper.id} looperName={looper.name} />
              {props.computer && <ComputerCard looperId={looper.id} looperName={looper.name} summary={props.computer} />}
            </div>
          ) : view === "skills" ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-4 [&>*]:w-full [&>*]:max-w-none">
              <WhoIAm looper={looper} />
              <StatusCard looper={looper} now={now} />
              <SkillsPanel looper={looper} runs={runs} integrations={props.integrations} />
            </div>
          ) : (
            <Kanban looperId={looper.id} cards={cards} looperName={looper.name} color={looper.color} running={!!running} />
          )}
        </div>
      )}
    </div>
  );
}

/** The looper's business metric, always in view: value, trend, target. Opens the chart. */
const VIEW_ICON: Partial<Record<View, React.ReactNode>> = {
  metric: <path d="M3 15l4.5-5 3 3L17 5M13 5h4v4" />,
  retro: <path d="M4 10a6 6 0 1 0 2-4.5M4 3.5V6h2.5M10 7v3.5l2.5 1.5" />,
  board: <path d="M3 4h4v12H3zM8 4h4v8H8zM13 4h4v5h-4z" />,
  computer: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.8" />
      <path d="M7 17h6M10 13.5V17" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="2" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
    </>
  ),
  database: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 8h14M3 12h14M8 4v12" />
    </>
  ),
  canvas: (
    <>
      <rect x="3" y="3.5" width="7" height="6" rx="1.2" />
      <rect x="11" y="10.5" width="6" height="6" rx="1.2" />
      <path d="M6.5 9.5v4.5H11" />
    </>
  ),
  skills: <path d="M10 3l1.8 4.2L16 9l-4.2 1.8L10 15l-1.8-4.2L4 9l4.2-1.8z" />,
  apps: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" />
    </>
  ),
};

/** The menu under a tab that holds two views: each with what's in it right now. */
function ViewMenu({ at, views, current, href, onClose }: { at: { left: number; top: number; keyboard: boolean }; views: { v: View; label: string; preview: string }[]; current: View; href: (v: View) => string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Only move focus into the menu when it was opened from the keyboard.
    if (at.keyboard) ref.current?.querySelector<HTMLElement>('[aria-current="page"], a')?.focus();
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest("[aria-haspopup]") && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLElement>("a") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, at.keyboard]);
  // Rendered into <body>: the header's backdrop blur would otherwise offset a fixed menu.
  return createPortal(
    <div ref={ref} role="menu" style={{ left: Math.max(8, at.left), top: at.top + 6 }} className="pop-in fixed z-50 w-[300px] rounded-[16px] border border-ink/[0.06] bg-panel p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.22)]">
      {views.map(({ v, label, preview }) => (
        <Link
          key={v}
          role="menuitem"
          href={href(v)}
          scroll={false}
          onClick={onClose}
          aria-current={v === current ? "page" : undefined}
          className={cx("quiet-focus flex items-center gap-3 rounded-[11px] px-2.5 py-2 transition-colors hover:bg-ink/[0.05] focus-visible:bg-ink/[0.05]", v === current && "bg-ink/[0.04]")}
        >
          <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", v === current ? "bg-ink text-page" : "bg-ink/[0.06] text-ink")}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
              {VIEW_ICON[v]}
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.875rem] font-medium">{label}</span>
            <span className="block truncate text-[0.75rem] text-mute">{preview}</span>
          </span>
          {v === current && <span className="text-[0.75rem] text-mute">✓</span>}
        </Link>
      ))}
    </div>,
    document.body,
  );
}

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

/** Is it on, and when does it work next. */
/** The top of Skills: who this looper is, before what it can do. */
function WhoIAm({ looper }: { looper: Looper }) {
  const m = looper.metric;
  return (
    <div className="tile flex items-center gap-4 p-5">
      <Bot size={52} color={looper.color} seed={looper.id} />
      <div className="min-w-0 flex-1">
        <div className="text-[1.25rem] font-semibold tracking-[-0.02em]">I&apos;m {looper.name}</div>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-mute">
          <span>
            I own <span className="font-medium text-ink">{m.name}</span>, {m.direction === "down" ? "down" : "up"} to {fmt(m.target)}
            {m.unit && m.unit !== m.name ? ` ${m.unit}` : ""}
          </span>
          <span>I ask you before sending, publishing, filing, paying or deleting anything</span>
        </div>
      </div>
    </div>
  );
}

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

function LooperChat({ looper, messages, runs, asks, ready, menu }: { looper: Looper; messages: ChiefMessage[]; runs: Run[]; asks: Ask[]; ready: boolean; menu: ModelMenu }) {
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
      emptyText={`I own one business metric: ${looper.metric.name}. Ask me anything, give me a task, or change how I work. My runs report here too.`}
      placeholder={`Message ${looper.name}`}
      send={(t, files) => askLooper(looper.id, t, files)}
      progressTarget={`chat:${looper.id}`}
      clear={() => clearLooperChat(looper.id)}
      model={<ChatModelPicker target={looper.id} menu={menu} />}
    />
  );
}
