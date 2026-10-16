"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { askLooper, clearLooperChat, updateLooper } from "@/app/actions";
import { occurrences } from "@/lib/schedule";
import type { Card, ChiefMessage, Looper, PublicSettings, Retro, Run } from "@/lib/types";
import { cardAssignee } from "@/lib/types";
import { AppsPanel } from "./apps-panel";
import { ChatPanel } from "./chat-panel";
import { CalendarView } from "./calendar";
import { DatabaseView } from "./database-view";
import { Kanban } from "./kanban";
import { MetricView } from "./metric-view";
import { RetroBoard } from "./retro-board";
import { SkillsPanel } from "./skills-panel";
import { Button, cx, fmt } from "./ui";
import { useNow } from "./use-now";

const TABS = ["chat", "metric", "board", "calendar", "database", "skills", "retro", "apps"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { chat: "Chat", metric: "Metric", board: "Kanban", calendar: "Calendar", database: "Database", skills: "Skills", retro: "Retro", apps: "Apps" };

export function LooperView(props: {
  looper: Looper;
  cards: Card[];
  runs: Run[];
  retros: Retro[];
  integrations: PublicSettings["integrations"];
  database: { name: string; rows: number; rowNoun: string } | null;
  chat: ChiefMessage[];
  ready: boolean;
  tab: string;
}) {
  const { looper, cards, runs, retros, integrations, database } = props;
  const tab: Tab = (TABS as readonly string[]).includes(props.tab) ? (props.tab as Tab) : "chat";
  const router = useRouter();
  const [busy, start] = useTransition();
  const running = runs.some((r) => r.status === "running");
  const now = useNow();

  const nextRuns = now && looper.status === "active"
    ? looper.skills
        .flatMap((s) => occurrences(s.schedule, new Date(now), new Date(now + 8 * 864e5)).slice(0, 1).map((at) => ({ at, s })))
        .sort((a, b) => a.at.getTime() - b.at.getTime())
    : [];
  const next = nextRuns[0];

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [running, router]);

  const open = cards.filter((c) => c.column !== "done");
  const forYou = open.filter((c) => cardAssignee(c) === "you");
  const doing = open.find((c) => c.column === "doing") ?? open.find((c) => c.column === "todo");
  const lastRetro = retros.at(-1);
  const current = looper.metric.history.at(-1)?.value;
  const when = (d: Date) => d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

  const counts: Partial<Record<Tab, number>> = {
    board: forYou.length || undefined,
    database: database?.rows || undefined,
    apps: looper.apps?.length || undefined,
  };
  const summary: Record<Tab, string> = {
    chat: "",
    metric: `${looper.metric.name} ${fmt(current)} of ${fmt(looper.metric.target)}`,
    board: forYou.length ? `${forYou.length} for you: ${forYou[0].title}` : doing ? doing.title : "No open cards",
    calendar: next ? `${next.s.name}, ${when(next.at)}` : looper.status === "paused" ? "Paused" : "Nothing scheduled",
    database: database ? `${database.rows} ${database.rowNoun}${database.rows === 1 ? "" : "s"}` : "Designs itself when opened",
    skills: `Core instructions · ${looper.skills.length} skills`,
    retro: lastRetro ? `Last: ${lastRetro.effectiveness}/5 effective` : "First retro after a week",
    apps: looper.apps?.length ? looper.apps.map((a) => a.name).join(", ") : "No apps yet",
  };

  return (
    <div className={cx("flex flex-col", tab === "chat" && "h-[calc(100dvh-58px)] lg:h-dvh")}>
      <header className="sticky top-0 z-20 flex items-end gap-3 border-b border-ink/[0.05] bg-page/85 px-4 pt-3 backdrop-blur-xl sm:px-6">
        <nav className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label={`${looper.name} sections`}>
          {TABS.map((t) => (
            <Link
              key={t}
              href={`/loopers/${looper.id}?tab=${t}`}
              scroll={false}
              title={summary[t] || undefined}
              className={cx(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-[0.875rem] transition-colors",
                tab === t ? "border-ink font-medium text-ink" : "border-transparent text-mute hover:text-ink",
              )}
            >
              {LABELS[t]}
              {counts[t] !== undefined && (
                <span className={cx("rounded-full px-1.5 text-[0.6875rem]", t === "board" ? "bg-blue text-white" : "bg-ink/[0.06] text-mute")}>{counts[t]}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3 pb-2">
          <span className="hidden items-center gap-1.5 text-[0.8125rem] text-mute md:flex">
            <span className={cx("h-1.5 w-1.5 rounded-full", running ? "pulse-dot bg-green" : looper.status === "active" ? "bg-green" : "bg-faint")} />
            {running ? "Working now" : looper.status === "active" ? (next ? `Next run ${when(next.at)}` : "Active") : "Paused"}
          </span>
          <Button
            size="sm"
            variant="soft"
            disabled={busy}
            onClick={() =>
              start(async () => {
                await updateLooper(looper.id, { status: looper.status === "active" ? "paused" : "active" });
                router.refresh();
              })
            }
          >
            {looper.status === "active" ? "Pause" : "Resume"}
          </Button>
        </div>
      </header>

      {tab === "chat" ? (
        <div className="min-h-0 flex-1">
          <LooperChat looper={looper} messages={props.chat} runs={runs} ready={props.ready} />
        </div>
      ) : (
        <div className="min-w-0 px-4 py-6 sm:px-6">
          {tab === "metric" ? (
            <MetricView looper={looper} />
          ) : tab === "calendar" ? (
            <CalendarView looper={looper} runs={runs} />
          ) : tab === "database" ? (
            <DatabaseView looperId={looper.id} looperName={looper.name} color={looper.color} />
          ) : tab === "retro" ? (
            <RetroBoard looper={looper} retros={retros} running={running} />
          ) : tab === "apps" ? (
            <AppsPanel looperId={looper.id} looperName={looper.name} />
          ) : tab === "skills" ? (
            <SkillsPanel looper={looper} runs={runs} integrations={integrations} />
          ) : (
            <Kanban looperId={looper.id} cards={cards} looperName={looper.name} color={looper.color} />
          )}
        </div>
      )}
    </div>
  );
}

function LooperChat({ looper, messages, runs, ready }: { looper: Looper; messages: ChiefMessage[]; runs: Run[]; ready: boolean }) {
  return (
    <ChatPanel
      bot={{ name: looper.name, color: looper.color, seed: looper.id }}
      messages={messages}
      runs={runs.filter((r) => r.summary || r.status === "running").map((r) => ({ id: r.id, at: r.startedAt, skill: r.skillName, status: r.status, summary: r.summary }))}
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
