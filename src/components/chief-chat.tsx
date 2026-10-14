"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { askChief, clearChief } from "@/app/actions";
import type { ChiefMessage, Provider } from "@/lib/types";
import { PROVIDERS } from "@/lib/types";
import { Button, cx } from "./ui";

const STARTERS = [
  "Hire a looper to grow LinkedIn impressions to 50k/month",
  "I want weekly qualified demo calls to go from 4 to 10",
  "Hire someone to cut support first-response time under 1h",
  "How is the team doing this week?",
];

export function ChiefChat({ messages, ready, provider, model }: { messages: ChiefMessage[]; ready: boolean; provider: Provider; model: string }) {
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

  const label = PROVIDERS.find((p) => p.id === provider)?.label;

  return (
    <section className="dot-grid relative flex min-h-[640px] flex-col overflow-hidden rounded-[8px] bg-ink text-white lg:h-[calc(100vh-7rem)]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-green text-ink">
            <span className="h-4 w-4 rounded-full border-[3px] border-ink" />
          </span>
          <div>
            <div className="text-[1rem] font-semibold tracking-[-0.01em]">Chief</div>
            <div className="text-[0.75rem] text-white/50">
              {ready ? `${label} · ${model}` : "Needs an API key"}
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={() => start(async () => { await clearChief(); router.refresh(); })} className="text-[0.75rem] text-white/40 hover:text-white">
            Clear
          </button>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 && !pending ? (
          <div className="flex h-full flex-col justify-end gap-8">
            <div>
              <p className="eyebrow !text-white/40">Your chief of loopers</p>
              <h1 className="display mt-3 max-w-[14ch] text-[2.75rem] sm:text-[3.5rem]">
                Hire loopers. Each owns <span className="text-green">one number.</span>
              </h1>
              <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-white/60">
                Tell Chief what you want to move. It hires a looper with one metric, a kanban board, a calendar of skills and a retro where it grades its own work.
              </p>
            </div>
            {!ready && (
              <Link href="/settings" className="inline-flex w-fit items-center gap-2 rounded-full bg-green px-5 py-2.5 text-[0.875rem] font-medium text-ink">
                Bring your Grok, OpenAI or Anthropic key →
              </Link>
            )}
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  disabled={!ready}
                  onClick={() => send(s)}
                  className="rounded-full border border-white/15 px-3.5 py-1.5 text-left text-[0.8125rem] text-white/80 transition-colors hover:border-white/40 hover:text-white disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
            {pending && (
              <>
                <Bubble m={{ id: "p", role: "user", content: pending, at: "" }} />
                <div className="flex items-center gap-2 text-[0.8125rem] text-white/50">
                  <span className="pulse-dot h-2 w-2 rounded-full bg-green" /> Chief is working…
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
        className="border-t border-white/10 p-3"
      >
        <div className="flex items-end gap-2 rounded-[8px] bg-white/[0.06] p-1.5 focus-within:bg-white/[0.09]">
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
            placeholder={ready ? "Ask Chief to hire, brief, pause or report on a looper…" : "Add an API key in Settings to talk to Chief"}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-[0.9375rem] text-white outline-none placeholder:text-white/35"
          />
          <Button type="submit" variant="light" disabled={!ready || isPending || !text.trim()}>
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}

function Bubble({ m }: { m: ChiefMessage }) {
  const mine = m.role === "user";
  return (
    <div className={cx("flex flex-col gap-2", mine ? "items-end" : "items-start")}>
      <div
        className={cx(
          "max-w-[85%] whitespace-pre-wrap rounded-[8px] px-4 py-3 text-[0.9375rem] leading-relaxed",
          mine ? "bg-white text-ink" : "bg-white/[0.06] text-white/90",
        )}
      >
        {m.content}
      </div>
      {m.actions && m.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.actions.map((a, i) => (
            <span key={i} className="rounded-full bg-green/15 px-2.5 py-1 text-[0.75rem] text-green">
              ✓ {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
