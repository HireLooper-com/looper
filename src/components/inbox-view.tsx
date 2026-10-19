"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { editCard, moveCard } from "@/app/actions";
import { dismissAsk, dismissRuns, retryFailed } from "@/app/team-actions";
import type { InboxItem } from "@/lib/inbox";
import type { Accent } from "@/lib/types";
import { AskBubble } from "./chat-panel";
import { refreshActivity } from "./live";
import { Bot, cx, timeAgo } from "./ui";

export interface AppTodo {
  looperId: string;
  slug: string;
  name: string;
  logo?: string;
}

type LooperRef = { id: string; name: string; color: Accent };

/** Everything waiting on you, across loopers, each with a one-tap way to clear it. */
export function InboxView({ items, apps, loopers }: { items: InboxItem[]; apps: AppTodo[]; loopers: LooperRef[] }) {
  const byId = new Map(loopers.map((l) => [l.id, l]));
  const [gone, setGone] = useState<Set<string>>(new Set());
  const hide = (key: string) => setGone((g) => new Set(g).add(key));
  const shown = items.filter((i) => !gone.has(i.key) && byId.has(i.looperId));
  const asks = shown.filter((i) => i.kind === "ask");
  const cards = shown.filter((i) => i.kind === "card");
  const failed = shown.filter((i) => i.kind === "failed");
  const total = shown.length + apps.length;

  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6">
      <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em]">Needs you</h1>
      <p className="mt-1 text-[0.9375rem] text-mute">{total ? `${total} thing${total === 1 ? "" : "s"} your loopers are waiting on.` : "Nothing is waiting on you."}</p>

      {total === 0 && (
        <div className="fade-up mt-16 flex flex-col items-center gap-4 text-center">
          <Bot dark seed="chief" size={84} />
          <div className="text-[1.25rem] font-semibold tracking-[-0.02em]">All clear</div>
          <p className="max-w-[40ch] text-[0.9375rem] text-mute">Your loopers have what they need. Questions, approvals and anything that didn&apos;t finish will show up here.</p>
          <Link href="/chief" className="mt-2 rounded-full bg-ink/[0.06] px-4 py-2 text-[0.875rem] font-medium hover:bg-ink/[0.1]">
            Read today&apos;s brief
          </Link>
        </div>
      )}

      {asks.length > 0 && (
        <Section title="Questions and approvals">
          {asks.map((i) =>
            i.kind === "ask" ? (
              <Row key={i.key} looper={byId.get(i.looperId)!} at={i.at} onDismiss={() => {
                  hide(i.key);
                  void dismissAsk(i.ask.id);
                }}>
                <AskBubble ask={i.ask} compact onAnswered={() => hide(i.key)} />
              </Row>
            ) : null,
          )}
        </Section>
      )}

      {cards.length > 0 && (
        <Section title="Tasks for you">
          {cards.map((i) => (i.kind === "card" ? <CardRow key={i.key} item={i} looper={byId.get(i.looperId)!} onDone={() => hide(i.key)} /> : null))}
        </Section>
      )}

      {apps.length > 0 && (
        <Section title="Apps to connect">
          {apps.map((a) => {
            const l = byId.get(a.looperId)!;
            return (
              <div key={`${a.looperId}:${a.slug}`} className="flex items-center gap-3 px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.logo ? <img src={a.logo} alt="" className="h-8 w-8 rounded-[8px]" /> : <span className="h-8 w-8 rounded-[8px] bg-ink/[0.06]" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[0.9375rem] font-medium">{a.name}</div>
                  <div className="text-[0.8125rem] text-mute">{l.name} needs it</div>
                </div>
                <Link href={`/loopers/${a.looperId}?tab=apps`} className="rounded-full bg-blue px-3.5 py-1.5 text-[0.8125rem] font-medium text-page hover:bg-blue-hover">
                  Connect
                </Link>
              </div>
            );
          })}
        </Section>
      )}

      {failed.length > 0 && (
        <Section title="Didn't finish">
          {failed.map((i) => (i.kind === "failed" ? <FailedRow key={i.key} item={i} looper={byId.get(i.looperId)!} onDone={() => hide(i.key)} /> : null))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fade-up mt-8">
      <div className="eyebrow mb-2 px-1">{title}</div>
      <div className="tile divide-y divide-line overflow-hidden">{children}</div>
    </section>
  );
}

function Who({ looper, at }: { looper: LooperRef; at: string }) {
  return (
    <Link href={`/loopers/${looper.id}`} className="flex items-center gap-1.5 text-[0.8125rem] text-mute hover:text-ink">
      <Bot size={18} color={looper.color} seed={looper.id} />
      <span className="font-medium text-ink">{looper.name}</span> · {timeAgo(at)}
    </Link>
  );
}

function Row({ looper, at, onDismiss, children }: { looper: LooperRef; at: string; onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <Who looper={looper} at={at} />
        <button onClick={onDismiss} className="text-[0.75rem] text-faint hover:text-ink">
          Dismiss
        </button>
      </div>
      {children}
    </div>
  );
}

function CardRow({ item, looper, onDone }: { item: Extract<InboxItem, { kind: "card" }>; looper: LooperRef; onDone: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const c = item.card;
  // Clear it from the list at once; the save happens behind it.
  const act = (fn: () => Promise<unknown>) => {
    onDone();
    start(async () => {
      await fn();
      router.refresh();
    });
  };
  return (
    <div className={cx("flex items-start gap-3 px-4 py-3", busy && "opacity-50")}>
      <button
        aria-label="Mark done"
        disabled={busy}
        onClick={() => act(() => moveCard(c.id, "done"))}
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_var(--color-faint)] transition-colors hover:bg-ink hover:text-page"
      >
        <span className="text-[0.625rem]">✓</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[0.9375rem] leading-snug">{c.title}</div>
        {c.description && <div className="mt-0.5 line-clamp-2 text-[0.8125rem] text-mute">{c.description}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Who looper={looper} at={item.at} />
          <button disabled={busy} onClick={() => act(() => editCard(c.id, { assignee: "looper" }))} className="text-[0.8125rem] text-mute hover:text-ink">
            Give to {looper.name}
          </button>
          <Link href={`/loopers/${looper.id}?tab=board`} className="text-[0.8125rem] text-mute hover:text-ink">
            Open board
          </Link>
        </div>
      </div>
    </div>
  );
}

function FailedRow({ item, looper, onDone }: { item: Extract<InboxItem, { kind: "failed" }>; looper: LooperRef; onDone: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const r = item.run;
  const act = (fn: () => Promise<{ ok: boolean }>) => {
    onDone();
    start(async () => {
      await fn();
      refreshActivity();
      router.refresh();
    });
  };
  return (
    <div className={cx("flex items-start gap-3 px-4 py-3", busy && "opacity-50")}>
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
      <div className="min-w-0 flex-1">
        <div className="text-[0.9375rem]">
          {r.skillName} didn&apos;t finish{item.count > 1 ? ` (${item.count} times in a row)` : ""}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[0.8125rem] text-mute">{r.summary}</div>
        <div className="mt-1.5">
          <Who looper={looper} at={item.at} />
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <button disabled={busy} onClick={() => act(() => retryFailed(r.looperId, r.id))} className="rounded-full bg-ink/[0.06] px-3 py-1 text-[0.8125rem] font-medium hover:bg-ink/[0.1]">
          Retry
        </button>
        <button disabled={busy} onClick={() => act(() => dismissRuns(r.looperId, r.id))} className="rounded-full px-2.5 py-1 text-[0.8125rem] text-mute hover:text-ink">
          Dismiss
        </button>
      </div>
    </div>
  );
}
