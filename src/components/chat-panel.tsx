"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { getProgress } from "@/app/actions";
import { answerAsk, dismissRuns, retryFailed } from "@/app/team-actions";
import type { Ask, ChiefMessage, Run } from "@/lib/types";
import { Bot, cx } from "./ui";

// Steps newer than this belong to the reply we're waiting for (a little slack for clock skew).
const stepsFrom = () => Date.now() - 2000;

type Item = { kind: "msg"; at: string; m: ChiefMessage } | { kind: "run"; at: string; r: Run } | { kind: "failed"; at: string; runs: Run[] };

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const firstSentence = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.{20,200}?[.!?])(\s|$)/);
  return m ? m[1] : flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
};

/** Messages and run reports in time order, with back-to-back failed runs folded into one line. */
function timeline(messages: ChiefMessage[], runs: Run[]): Item[] {
  const sorted: Item[] = [...messages.map((m) => ({ kind: "msg" as const, at: m.at, m })), ...runs.map((r) => ({ kind: "run" as const, at: r.startedAt, r }))].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const out: Item[] = [];
  for (const it of sorted) {
    const prev = out.at(-1);
    if (it.kind === "run" && it.r.status === "error") {
      if (prev?.kind === "failed") prev.runs.push(it.r);
      else if (prev?.kind === "run" && prev.r.status === "error") out[out.length - 1] = { kind: "failed", at: prev.at, runs: [prev.r, it.r] };
      else out.push(it);
    } else out.push(it);
  }
  return out;
}

export function ChatPanel(props: {
  bot: { name: string; color?: import("@/lib/types").Accent; dark?: boolean; seed: string };
  looperId?: string;
  messages: ChiefMessage[];
  runs?: Run[];
  asks?: Ask[];
  ready: boolean;
  notReadyHint?: React.ReactNode;
  starters: string[];
  emptyTitle: string;
  emptyText: string;
  placeholder: string;
  send: (text: string) => Promise<unknown>;
  clear?: () => Promise<unknown>;
  /** progress key for replies: "chief" or "chat:<looperId>" */
  progressTarget: string;
  /** shown above the conversation, e.g. Chief's daily brief */
  header?: React.ReactNode;
}) {
  const { bot, messages, runs = [], asks = [], ready } = props;
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [pendingSince, setPendingSince] = useState(0);
  // After tapping an answer the looper replies in the background; watch for it.
  const [waiting, setWaiting] = useState<{ since: number; count: number } | null>(null);
  const [isPending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const items = timeline(messages, runs);
  const askById = new Map(asks.map((a) => [a.id, a]));
  const replied = waiting && messages.length > waiting.count;

  // Follow the conversation; with nothing said yet, stay at the top (Chief's brief lives there).
  useEffect(() => {
    if (items.length || pending) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items.length, pending, waiting]);

  useEffect(() => {
    if (!waiting || replied) return;
    const t = setInterval(() => router.refresh(), 2500);
    const stop = setTimeout(() => setWaiting(null), 5 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [waiting, replied, router]);

  const send = (value: string) => {
    const t = value.trim();
    if (!t || isPending) return;
    setText("");
    setPending(t);
    setPendingSince(stepsFrom());
    start(async () => {
      await props.send(t);
      setPending(null);
      router.refresh();
    });
  };

  const onAnswered = () => {
    setWaiting({ since: stepsFrom(), count: messages.length + 1 });
    router.refresh();
  };

  const empty = items.length === 0 && !pending;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-4 py-6">
          {props.header}
          {empty && props.header ? (
            <div className="flex flex-col gap-2">
              {!ready && <div className="self-start">{props.notReadyHint}</div>}
              <div className="flex flex-wrap gap-2">
                {props.starters.map((s) => (
                  <button key={s} disabled={!ready} onClick={() => send(s)} className="rounded-full bg-ink/[0.045] px-3.5 py-2 text-left text-[0.875rem] transition-colors hover:bg-ink/[0.08] disabled:opacity-40">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center gap-5 py-16 text-center">
              <Bot dark={bot.dark} color={bot.color} seed={bot.seed} size={72} />
              <div>
                <h2 className="text-[1.5rem] font-semibold tracking-[-0.02em]">{props.emptyTitle}</h2>
                <p className="mx-auto mt-2 max-w-[48ch] text-[0.9375rem] leading-relaxed text-mute">{props.emptyText}</p>
              </div>
              {!ready && props.notReadyHint}
              <div className="flex w-full max-w-md flex-col gap-2">
                {props.starters.map((s, i) => (
                  <button
                    key={s}
                    disabled={!ready}
                    onClick={() => send(s)}
                    className="flex items-center gap-3 rounded-[14px] bg-ink/[0.035] px-4 py-3 text-left text-[0.9375rem] transition-colors hover:bg-ink/[0.06] disabled:opacity-40"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-panel text-[0.75rem] font-semibold text-mute shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                      {String.fromCharCode(65 + i)}
                    </span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {items.map((i) =>
                i.kind === "msg" ? (
                  i.m.askId && askById.get(i.m.askId) ? (
                    <AskBubble key={i.m.id} ask={askById.get(i.m.askId)!} onAnswered={onAnswered} />
                  ) : (
                    <Bubble key={i.m.id} m={i.m} />
                  )
                ) : i.kind === "run" ? (
                  <RunLine key={i.r.id} r={i.r} />
                ) : (
                  <FailedGroup key={i.runs[0].id} runs={i.runs} />
                ),
              )}
              {pending && (
                <>
                  <Bubble m={{ id: "p", role: "user", content: pending, at: "" }} />
                  <LiveSteps target={props.progressTarget} since={pendingSince} />
                </>
              )}
              {waiting && !replied && !pending && <LiveSteps target={props.progressTarget} since={waiting.since} />}
            </>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="mx-auto w-full max-w-[760px] px-4 pb-4"
      >
        <div className="flex items-end gap-2 rounded-[26px] border border-ink/[0.08] bg-panel py-1.5 pl-5 pr-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-colors focus-within:border-ink/25">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            rows={1}
            disabled={!ready}
            placeholder={ready ? props.placeholder : "Connect your plan in Settings to chat"}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[0.9375rem] outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={!ready || isPending || !text.trim()}
            aria-label="Send"
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue text-page transition-colors disabled:bg-ink/[0.15]"
          >
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 12V2M7 2 2.5 6.5M7 2l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {props.clear && messages.length > 0 && (
          <div className="mt-1.5 text-center">
            <button
              type="button"
              onClick={() =>
                start(async () => {
                  await props.clear!();
                  router.refresh();
                })
              }
              className="text-[0.75rem] text-faint hover:text-ink"
            >
              Clear conversation
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

function Bubble({ m }: { m: ChiefMessage }) {
  const mine = m.role === "user";
  return (
    <div className={cx("fade-up flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      <div className={cx("max-w-[85%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-[0.9375rem] leading-relaxed", mine ? "bg-blue text-page" : "bg-ink/[0.045] text-ink")}>
        {m.content}
      </div>
      {m.links && m.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {m.links.map((l, i) => (
            <Link key={i} href={l.href} className="rounded-full bg-blue px-4 py-2 text-[0.8125rem] font-medium text-page hover:bg-blue-hover">
              {l.label}
            </Link>
          ))}
        </div>
      )}
      {m.actions && m.actions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 self-center text-[0.75rem] text-mute">
          {m.actions.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="text-ink">✓</span> {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A looper's question (tap an option) or approval (approve, decline, or reply in your words). */
export function AskBubble({ ask, onAnswered, compact }: { ask: Ask; onAnswered?: () => void; compact?: boolean }) {
  const [busy, start] = useTransition();
  const [replying, setReplying] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = ask.status === "open";

  const answer = (value: string, withNote?: string) =>
    start(async () => {
      setError(null);
      const r = await answerAsk(ask.id, value, withNote);
      if (r.ok) onAnswered?.();
      else setError(r.error);
    });

  const options = ask.kind === "approval" ? ["Approve", "Not now"] : (ask.options ?? []);
  return (
    <div className={cx("fade-up flex flex-col items-start gap-2", compact && "w-full")}>
      <div className={cx("rounded-[18px] bg-ink/[0.045] px-4 py-3", compact ? "w-full" : "max-w-[85%]")}>
        <div className="flex items-center gap-1.5 text-[0.75rem] font-medium text-mute">
          {ask.kind === "approval" ? "Needs your approval" : "Question for you"}
        </div>
        <div className="mt-1 whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{ask.question}</div>
        {ask.detail && <div className="mt-2 whitespace-pre-wrap rounded-[12px] bg-panel px-3 py-2 text-[0.8125rem] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]">{ask.detail}</div>}
        {open ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {options.map((o, i) => (
              <button
                key={o}
                disabled={busy}
                onClick={() => answer(o)}
                className={cx(
                  "rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors disabled:opacity-50",
                  ask.kind === "approval" && i === 0 ? "bg-blue text-page hover:bg-blue-hover" : "bg-panel text-ink shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] hover:bg-ink/[0.04]",
                )}
              >
                {o}
              </button>
            ))}
            <button disabled={busy} onClick={() => setReplying((r) => !r)} className="rounded-full px-3 py-1.5 text-[0.8125rem] text-mute hover:text-ink">
              {ask.kind === "approval" ? "Change it…" : "Other…"}
            </button>
          </div>
        ) : (
          <div className="mt-2 text-[0.8125rem] text-mute">
            {ask.status === "answered" ? (
              <>
                <span className="text-ink">✓</span> {ask.answer}
              </>
            ) : (
              "Dismissed"
            )}
          </div>
        )}
        {open && replying && (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) answer(ask.kind === "approval" ? "Not now" : "Other", note);
            }}
          >
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={ask.kind === "approval" ? "What should change?" : "Your answer"}
              className="h-8 min-w-0 flex-1 rounded-full bg-panel px-3 text-[0.8125rem] outline-none shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]"
            />
            <button disabled={busy || !note.trim()} className="rounded-full bg-blue px-3 text-[0.8125rem] font-medium text-page disabled:opacity-40">
              Send
            </button>
          </form>
        )}
        {error && <div className="mt-2 text-[0.8125rem] text-red">{error}</div>}
      </div>
    </div>
  );
}

/** What the bot is doing right now, polled from the server; finished steps are ticked. */
function LiveSteps({ target, since }: { target: string; since: number }) {
  const [steps, setSteps] = useState<{ at: number; text: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      getProgress(target)
        .then((s) => alive && setSteps(s.filter((x) => x.at >= since)))
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [target, since]);
  const shown = steps.slice(-7);
  const box = useRef<HTMLDivElement>(null);
  // Keep the newest step in view as they arrive.
  useEffect(() => {
    box.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [steps.length]);
  return (
    <div ref={box} className="fade-up flex w-fit min-w-[220px] max-w-[85%] flex-col gap-1 rounded-[18px] bg-ink/[0.045] px-4 py-3 text-[0.875rem]">
      {shown.length === 0 && (
        <div className="flex items-center gap-2 text-mute">
          <span className="pulse-dot h-2 w-2 rounded-full bg-ink" /> Starting…
        </div>
      )}
      {shown.map((s, i) => {
        const current = i === shown.length - 1;
        return (
          <div key={`${s.at}-${i}`} className={cx("flex items-center gap-2", current ? "text-ink" : "text-mute")}>
            {current ? <span className="pulse-dot h-2 w-2 shrink-0 rounded-full bg-ink" /> : <span className="w-2 shrink-0 text-center text-[0.75rem]">✓</span>}
            <span className="truncate">{s.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "74 rows · 2 cards · 3 pins": what a run changed. */
function statsLine(r: Run) {
  const s = r.stats ?? {};
  const n = (v: number | undefined, one: string, many = `${one}s`) => (v ? `${v} ${v === 1 ? one : many}` : "");
  return [n(s.rows, "row"), n(s.cards, "new card"), n(s.moved, "card moved", "cards moved"), n(s.pins, "pin"), s.metric !== undefined && !Number.isNaN(s.metric) ? `metric ${s.metric}` : ""].filter(Boolean);
}

/** One line per run; open it for the steps it took and the full report. */
function RunLine({ r }: { r: Run }) {
  const [open, setOpen] = useState(false);
  if (r.status === "running")
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-1.5 pl-1 text-[0.75rem] text-mute">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ink" /> Running {r.skillName}…
        </div>
        <LiveSteps target={`run:${r.id}`} since={Date.parse(r.startedAt) - 2000} />
      </div>
    );
  if (r.status === "error") return <FailedGroup runs={[r]} />;
  const chips = statsLine(r);
  return (
    <div className="fade-up flex flex-col items-start">
      <button onClick={() => setOpen((o) => !o)} className="group w-full max-w-[85%] rounded-[18px] bg-ink/[0.045] px-4 py-2.5 text-left transition-colors hover:bg-ink/[0.06]">
        <div className="flex items-center gap-2 text-[0.8125rem]">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[0.5625rem] text-page">✓</span>
          <span className="font-medium">{r.skillName}</span>
          <span className="text-mute">· {when(r.startedAt)}</span>
          <span className="ml-auto text-[0.75rem] text-faint transition-colors group-hover:text-mute">{open ? "Less" : "Details"}</span>
        </div>
        {chips.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{chips.map((c) => <span key={c} className="rounded-full bg-panel px-2 py-0.5 text-[0.6875rem] text-mute shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">{c}</span>)}</div>}
        <div className="mt-1.5 text-[0.9375rem] leading-relaxed">{open ? <span className="whitespace-pre-wrap">{r.summary}</span> : firstSentence(r.summary)}</div>
        {open && r.steps && r.steps.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <div className="eyebrow mb-1">Steps</div>
            {r.steps.map((s, i) => (
              <div key={i} className="flex gap-2 text-[0.8125rem] text-mute">
                <span className="w-3 shrink-0 text-center">✓</span>
                {s}
              </div>
            ))}
          </div>
        )}
      </button>
    </div>
  );
}

/** Failed runs, folded: one quiet line with Retry, details on demand. */
function FailedGroup({ runs }: { runs: Run[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const last = runs.at(-1)!;
  const many = runs.length > 1;
  const settled = runs.every((r) => r.dismissed);
  const act = (fn: () => Promise<{ ok: boolean }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) setDone(msg);
      router.refresh();
    });
  return (
    <div className="fade-up flex flex-col items-start">
      <div className="w-full max-w-[85%] rounded-[18px] px-4 py-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]">
          <span className="h-1.5 w-1.5 rounded-full bg-red" />
          <button onClick={() => setOpen((o) => !o)} className="text-left">
            <span className="font-medium">{many ? `${runs.length} runs didn't finish` : `${last.skillName} didn't finish`}</span>
            <span className="text-mute"> · {when(last.startedAt)}</span>
          </button>
          {!settled && !done && (
            <span className="ml-auto flex gap-1">
              <button disabled={busy} onClick={() => act(() => retryFailed(last.looperId, many ? undefined : last.id), "Retrying…")} className="rounded-full bg-ink/[0.06] px-2.5 py-0.5 text-[0.75rem] font-medium hover:bg-ink/[0.1]">
                {many ? "Retry all" : "Retry"}
              </button>
              <button disabled={busy} onClick={() => act(() => dismissRuns(last.looperId, many ? undefined : last.id), "Dismissed")} className="rounded-full px-2 py-0.5 text-[0.75rem] text-mute hover:text-ink">
                Dismiss
              </button>
            </span>
          )}
          {done && <span className="ml-auto text-[0.75rem] text-mute">{done}</span>}
        </div>
        {open && (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2 text-[0.8125rem] text-mute">
            {runs.map((r) => (
              <div key={r.id}>
                <span className="text-ink">{r.skillName}</span> · {when(r.startedAt)} — {r.summary}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
