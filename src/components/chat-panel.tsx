"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ChiefMessage } from "@/lib/types";
import { Bot, cx } from "./ui";

/** A run report shown inline in a looper's chat. */
export interface RunEvent {
  id: string;
  at: string;
  skill: string;
  status: "running" | "success" | "error";
  summary: string;
}

type Item = { kind: "msg"; m: ChiefMessage } | { kind: "run"; r: RunEvent };

export function ChatPanel(props: {
  bot: { name: string; color?: import("@/lib/types").Accent; dark?: boolean; seed: string };
  messages: ChiefMessage[];
  runs?: RunEvent[];
  ready: boolean;
  notReadyHint?: React.ReactNode;
  starters: string[];
  emptyTitle: string;
  emptyText: string;
  placeholder: string;
  send: (text: string) => Promise<unknown>;
  clear?: () => Promise<unknown>;
}) {
  const { bot, messages, runs = [], ready } = props;
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);

  const at = (i: Item) => (i.kind === "msg" ? i.m.at : i.r.at);
  const items: Item[] = [...messages.map((m) => ({ kind: "msg" as const, m })), ...runs.map((r) => ({ kind: "run" as const, r }))].sort((a, b) =>
    at(a).localeCompare(at(b)),
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items.length, pending]);

  const send = (value: string) => {
    const t = value.trim();
    if (!t || isPending) return;
    setText("");
    setPending(t);
    start(async () => {
      await props.send(t);
      setPending(null);
      router.refresh();
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-4 py-6">
          {items.length === 0 && !pending ? (
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
                    className="flex items-center gap-3 rounded-[14px] bg-black/[0.035] px-4 py-3 text-left text-[0.9375rem] transition-colors hover:bg-black/[0.06] disabled:opacity-40"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-white text-[0.75rem] font-semibold text-mute shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                      {String.fromCharCode(65 + i)}
                    </span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {items.map((i) => (i.kind === "msg" ? <Bubble key={i.m.id} m={i.m} /> : <RunBubble key={i.r.id} r={i.r} />))}
              {pending && (
                <>
                  <Bubble m={{ id: "p", role: "user", content: pending, at: "" }} />
                  <div className="flex w-fit items-center gap-1 rounded-[18px] bg-black/[0.05] px-4 py-3">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="pulse-dot h-2 w-2 rounded-full bg-faint" style={{ animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </div>
                </>
              )}
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
        <div className="flex items-end gap-2 rounded-[26px] border border-black/[0.08] bg-white py-1.5 pl-5 pr-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.05)] focus-within:border-blue/50">
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
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue text-white disabled:bg-[#d2d2d7]"
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
    <div className={cx("flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      <div className={cx("max-w-[85%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-[0.9375rem] leading-relaxed", mine ? "bg-blue text-white" : "bg-black/[0.045] text-ink")}>
        {m.content}
      </div>
      {m.links && m.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {m.links.map((l, i) => (
            <Link key={i} href={l.href} className="rounded-full bg-blue px-4 py-2 text-[0.8125rem] font-medium text-white hover:bg-blue-hover">
              {l.label}
            </Link>
          ))}
        </div>
      )}
      {m.actions && m.actions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 self-center text-[0.75rem] text-mute">
          {m.actions.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="text-green">✓</span> {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RunBubble({ r }: { r: RunEvent }) {
  const [open, setOpen] = useState(false);
  const long = r.summary.length > 320;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1.5 pl-1 text-[0.75rem] text-mute">
        <span className={cx("h-1.5 w-1.5 rounded-full", r.status === "running" ? "pulse-dot bg-green" : r.status === "error" ? "bg-red" : "bg-faint")} />
        {r.status === "running" ? `Running ${r.skill}…` : `${r.skill} · ${new Date(r.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}`}
      </div>
      {r.summary && (
        <button
          onClick={() => setOpen((o) => !o)}
          className={cx(
            "max-w-[85%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-left text-[0.9375rem] leading-relaxed",
            r.status === "error" ? "bg-red/[0.07] text-red" : "bg-black/[0.045] text-ink",
          )}
        >
          {long && !open ? `${r.summary.slice(0, 320)}…` : r.summary}
          {long && <span className="ml-1 text-[0.8125rem] text-blue">{open ? "Less" : "More"}</span>}
        </button>
      )}
    </div>
  );
}
