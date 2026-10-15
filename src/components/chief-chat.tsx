"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { askChief, clearChief } from "@/app/actions";
import type { ChiefMessage } from "@/lib/types";
import { cx } from "./ui";

const STARTERS = [
  "Hire a looper to grow LinkedIn impressions to 50k/month",
  "I want weekly qualified demo calls to go from 4 to 10",
  "Hire someone to cut support first-response time under 1h",
  "How is the team doing this week?",
];

export function ChiefChat({ messages, ready, source, model }: { messages: ChiefMessage[]; ready: boolean; source: string; model: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending]);

  const send = (value: string) => {
    const t = value.trim();
    if (!t || isPending) return;
    setText("");
    setPending(t);
    start(async () => {
      await askChief(t);
      setPending(null);
      router.refresh();
    });
  };

  return (
    <section className="tile flex min-h-[620px] flex-col overflow-hidden lg:h-[calc(100vh-6rem)]">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="app-icon flex h-9 w-9 items-center justify-center bg-gradient-to-b from-[#5e5ce6] to-[#3634a3] text-white">✦</span>
          <div>
            <div className="text-[0.9375rem] font-semibold">Chief</div>
            <div className="text-[0.75rem] text-mute">{ready ? `${source} · ${model}` : "Not connected"}</div>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() =>
              start(async () => {
                await clearChief();
                router.refresh();
              })
            }
            className="text-[0.8125rem] text-blue hover:underline"
          >
            Clear
          </button>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 && !pending ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <span className="app-icon flex h-16 w-16 items-center justify-center bg-gradient-to-b from-[#5e5ce6] to-[#3634a3] text-[1.75rem] text-white">✦</span>
            <div>
              <h1 className="display text-[1.75rem]">What should we move?</h1>
              <p className="mx-auto mt-2 max-w-[44ch] text-[0.9375rem] leading-relaxed text-mute">
                Chief turns a goal into a looper with one metric, a kanban board, a calendar of skills and a retro where it grades its own work.
              </p>
            </div>
            {!ready && (
              <Link href="/settings" className="rounded-full bg-blue px-5 py-2.5 text-[0.9375rem] font-medium text-white">
                Connect your plan in Settings
              </Link>
            )}
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  disabled={!ready}
                  onClick={() => send(s)}
                  className="rounded-full bg-well px-4 py-2 text-[0.8125rem] text-ink-2 transition-colors hover:bg-[#ebebf0] disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
            {pending && (
              <>
                <Bubble m={{ id: "p", role: "user", content: pending, at: "" }} />
                <div className="flex w-fit items-center gap-1 rounded-[18px] rounded-bl-[6px] bg-[#e9e9eb] px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="pulse-dot h-2 w-2 rounded-full bg-faint" style={{ animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="border-t border-line p-3"
      >
        <div className="flex items-end gap-2 rounded-[22px] border border-[#d2d2d7] bg-white py-1 pl-4 pr-1 focus-within:border-blue focus-within:ring-4 focus-within:ring-blue/15">
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
            placeholder={ready ? "Message Chief" : "Connect your plan in Settings to talk to Chief"}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[0.9375rem] outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={!ready || isPending || !text.trim()}
            aria-label="Send"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue text-white disabled:bg-[#d2d2d7]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 12V2M7 2 2.5 6.5M7 2l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}

function Bubble({ m }: { m: ChiefMessage }) {
  const mine = m.role === "user";
  return (
    <div className={cx("flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      <div
        className={cx(
          "max-w-[80%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-[0.9375rem] leading-snug",
          mine ? "rounded-br-[6px] bg-blue text-white" : "rounded-bl-[6px] bg-[#e9e9eb] text-ink",
        )}
      >
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
        <div className="flex flex-wrap gap-1.5">
          {m.actions.map((a, i) => (
            <span key={i} className="rounded-full bg-green/15 px-2.5 py-1 text-[0.75rem] font-medium text-green-deep">
              ✓ {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
