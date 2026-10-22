"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { resetComputer } from "@/app/computer-actions";
import type { ComputerSessionLog, ComputerStep } from "@/lib/computer";
import type { Accent } from "@/lib/types";
import { TakeoverView } from "./takeover-view";
import { Bot, Button, cx, timeAgo } from "./ui";

type Log = { available: boolean; now: number; takeover?: boolean; sessions: ComputerSessionLog[] };

const LIVE_MS = 8 * 60_000;
const isLive = (s: ComputerSessionLog, now: number) => !s.endedAt && now - Date.parse(s.startedAt) < LIVE_MS;
const host = (url?: string) => url?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? "";
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const duration = (s: ComputerSessionLog) => {
  const ms = Date.parse(s.endedAt ?? s.steps.at(-1)?.at ?? s.startedAt) - Date.parse(s.startedAt);
  const sec = Math.max(1, Math.round(ms / 1000));
  return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)} min`;
};

/** Watch the looper's computer: the screen as it works, and a replay of every earlier session. */
export function ComputerView({ looper }: { looper: { id: string; name: string; color: Accent } }) {
  const [log, setLog] = useState<Log | null>(null);
  const [pick, setPick] = useState<{ session: string | null; step: number | null }>({ session: null, step: null });
  // Taking over the browser: opened from a looper's ask (?takeover=<ask id>) or the button here.
  const params = useSearchParams();
  const router = useRouter();
  const [takeover, setTakeover] = useState<{ askId?: string } | null>(() => {
    const t = params.get("takeover");
    return t ? { askId: t === "1" ? undefined : t } : null;
  });
  const closeTakeover = () => {
    setTakeover(null);
    if (params.get("takeover")) router.replace(`/loopers/${looper.id}?tab=computer`, { scroll: false });
  };

  // Poll quickly while a session is live, slowly otherwise (to notice a new one starting).
  const live = !!log && log.sessions.some((s) => isLive(s, log.now));
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) {
        const next: Log | null = await fetch(`/api/computer/${looper.id}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!alive) return;
        if (next) setLog(next);
      }
      timer = setTimeout(tick, live ? 1500 : 8000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [looper.id, live]);

  const sessions = log?.sessions ?? [];
  const session = sessions.find((s) => s.id === pick.session) ?? sessions.at(-1);
  const steps = session?.steps ?? [];
  // No step picked means "follow along": always the newest.
  const index = pick.step === null || pick.step >= steps.length ? steps.length - 1 : pick.step;
  const following = pick.step === null;
  const sessionLive = !!session && !!log && isLive(session, log.now);

  const go = (i: number) => setPick((p) => ({ session: session?.id ?? p.session, step: i >= steps.length - 1 && sessionLive ? null : Math.max(0, Math.min(steps.length - 1, i)) }));

  // Arrow keys scrub through the steps.
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") goRef.current(index - 1);
      if (e.key === "ArrowRight") goRef.current(index + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index]);

  if (takeover)
    return (
      <div className="mx-auto max-w-[1200px]">
        <TakeoverView looper={looper} askId={takeover.askId} onClose={closeTakeover} />
      </div>
    );
  if (!log) return <div className="py-16 text-center text-[0.875rem] text-mute">Loading the computer…</div>;
  if (!log.available) return <Empty looper={looper} text="The computer needs Vercel Sandbox, which isn't set up on this server." />;
  if (!sessions.length) return <Empty looper={looper} onTakeover={() => setTakeover({})} />;

  const current = steps[index];
  // The screen shows the latest screenshot up to this step (reading or typing a command keeps the last view).
  const screen = steps.slice(0, index + 1).findLast((s) => s.shot);
  const at = steps.slice(0, index + 1).findLast((s) => s.url);

  return (
    <div className="mx-auto grid max-w-[1200px] gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="tile min-w-0 overflow-hidden">
        {/* Browser chrome: address and live state */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-ink/[0.12]" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink/[0.12]" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink/[0.12]" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-ink/[0.05] px-3 py-1 text-[0.8125rem]">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0 text-faint" aria-hidden>
              <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
              <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
            </svg>
            <span className="truncate">{at?.url ? host(at.url) : "about:blank"}</span>
            {at?.title && <span className="hidden truncate text-mute md:inline">· {at.title}</span>}
          </div>
          {log.takeover ? (
            <Button size="sm" onClick={() => setTakeover({})}>
              Resume take-over
            </Button>
          ) : (
            !sessionLive && (
              <Button size="sm" variant="soft" onClick={() => setTakeover({})} title={`Use ${looper.name}'s browser yourself: log in to a site, or pass a check`}>
                Take over
              </Button>
            )
          )}
          {sessionLive ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem] font-medium">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ink" />
              Live
            </span>
          ) : (
            <span className="shrink-0 text-[0.75rem] text-faint">{session ? `${clock(session.startedAt)} · ${duration(session)}` : ""}</span>
          )}
        </div>

        {/* The screen */}
        {/* Sized by the screenshot (all the same viewport), so nothing is cropped. */}
        <div className="relative min-h-[240px] bg-well">
          {current?.command !== undefined ? (
            <div className="aspect-[16/9]">
              <Terminal step={current} />
            </div>
          ) : screen?.shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={screen.shot} src={screen.shot} alt={screen.title ? `${looper.name}'s screen: ${screen.title}` : `${looper.name}'s screen`} className="fade-up block h-auto w-full" />
          ) : (
            <div className="flex aspect-[16/9] flex-col items-center justify-center gap-3 text-[0.875rem] text-mute">
              <Bot size={56} color={looper.color} seed={looper.id} className={cx(sessionLive && "looping")} />
              {sessionLive ? "Waking up the computer…" : "Nothing on screen in this session"}
            </div>
          )}
        </div>

        {/* What it's doing, and scrubbing */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className={cx("truncate text-[0.9375rem] font-medium", current?.error && "text-red")}>{current?.label ?? (sessionLive ? "Starting…" : "No steps")}</div>
            <div className="text-[0.75rem] text-mute">
              {steps.length ? `Step ${index + 1} of ${steps.length}` : ""}
              {current ? ` · ${clock(current.at)}` : ""}
            </div>
          </div>
          {sessionLive && !following && (
            <Button size="sm" variant="soft" onClick={() => setPick({ session: session!.id, step: null })}>
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ink" />
              Back to live
            </Button>
          )}
          <div className="flex gap-1">
            <StepButton label="Previous step" disabled={index <= 0} onClick={() => go(index - 1)} d="M8.5 3 4.5 7l4 4" />
            <StepButton label="Next step" disabled={index >= steps.length - 1} onClick={() => go(index + 1)} d="m5.5 3 4 4-4 4" />
          </div>
        </div>

        {/* Filmstrip */}
        {steps.length > 1 && (
          <Filmstrip steps={steps} index={index} onPick={go} />
        )}
      </section>

      <aside className="flex min-w-0 flex-col gap-4">
        <div className="tile overflow-hidden">
          <div className="eyebrow px-4 pb-1 pt-3.5">Sessions</div>
          <div className="flex max-h-[420px] flex-col overflow-y-auto pb-1.5">
            {[...sessions].reverse().map((s) => {
              const on = s.id === session?.id;
              const sLive = isLive(s, log.now);
              return (
                <button
                  key={s.id}
                  onClick={() => setPick({ session: s.id, step: sLive ? null : 0 })}
                  className={cx("mx-1.5 flex items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors", on ? "bg-ink/[0.06]" : "hover:bg-ink/[0.03]")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] font-medium">{s.label}</span>
                    <span className="block truncate text-[0.75rem] text-mute">
                      {sLive ? "Working now" : timeAgo(s.startedAt)} · {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                      {s.steps.some((x) => x.url) ? ` · ${host(s.steps.findLast((x) => x.url)?.url).split("/")[0]}` : ""}
                    </span>
                  </span>
                  {sLive && <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />}
                </button>
              );
            })}
          </div>
        </div>
        <About looper={looper} />
      </aside>
    </div>
  );
}

function StepButton({ label, d, disabled, onClick }: { label: string; d: string; disabled: boolean; onClick: () => void }) {
  return (
    <button aria-label={label} disabled={disabled} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.05] text-ink transition-colors hover:bg-ink/[0.09] disabled:opacity-30">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}

function Filmstrip({ steps, index, onPick }: { steps: ComputerStep[]; index: number; onPick: (i: number) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  // Keep the current step in view as it advances.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [index]);
  return (
    <div ref={strip} className="flex gap-2 overflow-x-auto border-t border-line px-4 py-3">
      {steps.map((s, i) => (
        <button
          key={s.id}
          data-i={i}
          title={s.label}
          aria-label={`Step ${i + 1}: ${s.label}`}
          aria-current={i === index ? "step" : undefined}
          onClick={() => onPick(i)}
          className={cx(
            "relative aspect-[16/9] w-24 shrink-0 overflow-hidden rounded-[8px] bg-well transition-opacity",
            i === index ? "ring-2 ring-ink" : "opacity-60 hover:opacity-100",
          )}
        >
          {s.shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.shot} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-mono text-[0.6875rem] text-mute">{s.command !== undefined ? ">_" : s.label.startsWith("Reading") ? "Aa" : "·"}</span>
          )}
          {s.error && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red" />}
        </button>
      ))}
    </div>
  );
}

function Terminal({ step }: { step: ComputerStep }) {
  return (
    <div className="absolute inset-0 overflow-auto bg-[#0c0c0c] p-5 font-mono text-[0.8125rem] leading-relaxed text-[#e8e8e8]">
      <div>
        <span className="text-[#8a8a8a]">$ </span>
        {step.command}
      </div>
      {step.output && <pre className="mt-2 whitespace-pre-wrap break-words text-[#b5b5b5]">{step.output}</pre>}
    </div>
  );
}

function Empty({ looper, text, onTakeover }: { looper: { id: string; name: string; color: Accent }; text?: string; onTakeover?: () => void }) {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-16 text-center">
      <Bot size={72} color={looper.color} seed={looper.id} />
      <div className="text-[1.25rem] font-semibold tracking-[-0.02em]">{looper.name}&apos;s computer</div>
      <p className="text-[0.9375rem] text-mute">
        {text ?? `${looper.name} has a private Linux machine with Chrome for websites no app covers. When it uses it, you can watch here live and replay every session.`}
      </p>
      {!text && (
        <>
          <p className="text-[0.875rem] text-mute">Try asking in chat: &ldquo;Open our competitor&apos;s pricing page and summarise their plans&rdquo;.</p>
          <div className="flex gap-2">
            <Link href={`/loopers/${looper.id}?tab=chat`} className="rounded-full bg-ink/[0.06] px-4 py-2 text-[0.875rem] font-medium hover:bg-ink/[0.1]">
              Open chat
            </Link>
            {onTakeover && (
              <button onClick={onTakeover} className="rounded-full bg-ink/[0.06] px-4 py-2 text-[0.875rem] font-medium hover:bg-ink/[0.1]">
                Log in to a site for {looper.name}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** What the machine is, and the way to start it over. */
function About({ looper }: { looper: { id: string; name: string } }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();
  return (
    <div className="tile px-4 py-3.5 text-[0.8125rem] text-mute">
      <p>A private Linux machine with Chrome. It remembers {looper.name}&apos;s logins and files, and sleeps between runs.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span>Delete its files, logins and history?</span>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  await resetComputer(looper.id);
                  window.location.reload();
                })
              }
            >
              {busy ? "Wiping…" : "Wipe"}
            </Button>
            <Button size="sm" variant="soft" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="soft" onClick={() => setConfirming(true)}>
            Wipe computer
          </Button>
        )}
      </div>
    </div>
  );
}
