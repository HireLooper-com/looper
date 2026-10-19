"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { confirmHire, draftHire, startSkill } from "@/app/team-actions";
import type { LooperSpec } from "@/lib/agent";
import { describeSchedule } from "@/lib/schedule";
import type { Accent } from "@/lib/types";
import { AppsPanel } from "./apps-panel";
import { Bot, Button, cx } from "./ui";

/** Starter roles a founder or freelancer can hire in a minute. */
const TEMPLATES = [
  { title: "VAT return", role: "Accounting", goal: "Prepare my quarterly Dutch VAT return: match every bank transaction to an invoice and get unresolved VAT items to 0 before the deadline." },
  { title: "Invoice chaser", role: "Finance", goal: "Get paid faster: chase overdue invoices politely and bring overdue receivables down to €0." },
  { title: "SEO growth", role: "SEO", goal: "Grow organic clicks from Google Search Console by finding quick wins and drafting posts." },
  { title: "LinkedIn growth", role: "Social", goal: "Grow my LinkedIn impressions to 50k a month by drafting posts in my voice for my approval." },
  { title: "Lead qualifier", role: "Sales", goal: "Qualify inbound leads from my inbox and CRM and book more qualified demo calls each week." },
  { title: "Inbox zero", role: "Support", goal: "Keep customer emails answered within a day: draft replies for my approval and keep unanswered emails near 0." },
  { title: "Revenue watch", role: "Revenue", goal: "Watch Stripe for failed payments and churn, and recover failed payments to keep MRR growing." },
  { title: "Content repurposer", role: "Content", goal: "Turn every blog post into a week of social posts and grow posts published per week." },
  { title: "Competitor watch", role: "Research", goal: "Track my top competitors' pricing, launches and posts and send me a weekly brief." },
  { title: "Cash runway", role: "Finance", goal: "Keep my cash runway in view: categorise spend from my bank and Stripe and flag anything that shortens runway." },
];

type Hired = { id: string; name: string; color?: Accent; firstSkillId?: string; firstSkillName?: string };
type Step = "goal" | "drafting" | "review" | "connect";

const DRAFTING = ["Reading your goal…", "Choosing the one number to own…", "Picking the apps it needs…", "Designing its database…", "Scheduling its skills…"];

/** Guided hiring: goal → Chief's draft → review → connect apps → watch the first run. */
export function HireFlow({ resume, notice, taken, nextColor }: { resume?: Hired; notice?: string; taken: string[]; nextColor: Accent }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(resume ? "connect" : "goal");
  const [goal, setGoal] = useState("");
  const [spec, setSpec] = useState<LooperSpec | null>(null);
  const [hired, setHired] = useState<Hired | null>(resume ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (step !== "drafting") return;
    const t = setInterval(() => setTick((n) => n + 1), 2200);
    return () => clearInterval(t);
  }, [step]);

  const draft = (text: string) => {
    setGoal(text);
    setError(null);
    setTick(0);
    setStep("drafting");
    start(async () => {
      const r = await draftHire(text);
      if (r.ok) {
        setSpec(r.value);
        setStep("review");
      } else {
        setError(r.error);
        setStep("goal");
      }
    });
  };

  const hire = () =>
    start(async () => {
      if (!spec) return;
      setError(null);
      const r = await confirmHire(spec);
      if (!r.ok) return setError(r.error);
      setHired({ ...r.value, color: nextColor });
      setStep("connect");
      router.refresh();
    });

  const firstRun = () =>
    start(async () => {
      if (!hired) return;
      if (hired.firstSkillId) await startSkill(hired.id, hired.firstSkillId);
      router.push(`/loopers/${hired.id}?tab=chat`);
      router.refresh();
    });

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Steps step={step} />

      {step === "goal" && (
        <div className="fade-up mt-8">
          <h1 className="text-[2rem] font-semibold tracking-[-0.03em]">Who do you want to hire?</h1>
          <p className="mt-1 text-[1rem] text-mute">Describe the result you want. Chief drafts a looper that owns one number, and you review it before anything runs.</p>
          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (goal.trim()) draft(goal);
            }}
          >
            <div className="rounded-[20px] border border-ink/[0.08] bg-panel p-2 shadow-[0_2px_12px_rgba(0,0,0,0.05)] focus-within:border-ink/25">
              <textarea
                autoFocus
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && goal.trim()) draft(goal);
                }}
                placeholder="e.g. Get my overdue invoices paid within 30 days"
                className="w-full resize-none bg-transparent px-3 py-2 text-[1rem] outline-none placeholder:text-faint"
              />
              <div className="flex justify-end">
                <Button disabled={!goal.trim() || busy}>Draft with Chief</Button>
              </div>
            </div>
          </form>
          {error && <p className="mt-3 text-[0.875rem] text-red">{error}</p>}
          <div className="eyebrow mt-10">Or start from a role</div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <button key={t.title} onClick={() => draft(t.goal)} className="tile group flex flex-col gap-1 p-4 text-left transition-transform hover:-translate-y-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-[0.9375rem] font-medium">{t.title}</span>
                  <span className="rounded-[5px] bg-ink/[0.05] px-1.5 text-[0.6875rem] text-mute">{t.role}</span>
                  <span className="ml-auto text-mute opacity-0 transition-opacity group-hover:opacity-100">→</span>
                </span>
                <span className="line-clamp-2 text-[0.8125rem] leading-snug text-mute">{t.goal}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "drafting" && (
        <div className="fade-up mt-24 flex flex-col items-center gap-5 text-center">
          <Bot dark seed="chief" size={88} className="looping" />
          <div className="text-[1.25rem] font-semibold tracking-[-0.02em]">Chief is drafting your looper</div>
          <div key={tick} className="fade-up text-[0.9375rem] text-mute">{DRAFTING[Math.min(tick, DRAFTING.length - 1)]}</div>
          <p className="max-w-[48ch] text-[0.8125rem] text-faint">“{goal}”</p>
        </div>
      )}

      {step === "review" && spec && (
        <div className="fade-up mt-8">
          <h1 className="text-[2rem] font-semibold tracking-[-0.03em]">Meet {spec.name || "your looper"}</h1>
          <p className="mt-1 text-[1rem] text-mute">Change anything, then hire. Nothing runs until you do.</p>
          <Review spec={spec} onChange={setSpec} taken={taken} color={nextColor} />
          {error && <p className="mt-3 text-[0.875rem] text-red">{error}</p>}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button onClick={() => setStep("goal")} className="text-[0.875rem] text-mute hover:text-ink">
              ← Start over
            </button>
            <Button onClick={hire} disabled={busy || !spec.name.trim() || taken.some((n) => n.toLowerCase() === spec.name.trim().toLowerCase())}>
              {busy ? "Hiring…" : `Hire ${spec.name || "looper"}`}
            </Button>
          </div>
        </div>
      )}

      {step === "connect" && hired && (
        <div className="fade-up mt-8">
          <div className="flex items-center gap-4">
            <Bot size={56} color={hired.color} seed={hired.id} />
            <div>
              <h1 className="text-[2rem] font-semibold tracking-[-0.03em]">{hired.name} is on the team</h1>
              <p className="text-[1rem] text-mute">Connect what {hired.name} needs, then watch the first run.</p>
            </div>
          </div>
          {notice && <div className="mt-5 rounded-[12px] bg-ink/[0.05] px-4 py-3 text-[0.875rem]">{notice}</div>}
          <div className="mt-6">
            <AppsPanel looperId={hired.id} looperName={hired.name} returnTo="hire" />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => router.push(`/loopers/${hired.id}`)} className="text-[0.875rem] text-mute hover:text-ink">
              Skip for now
            </button>
            <Button onClick={firstRun} disabled={busy}>
              {busy ? "Starting…" : hired.firstSkillName ? `Start ${hired.firstSkillName} →` : `Open ${hired.name} →`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order = ["Goal", "Review", "Connect"];
  const at = step === "goal" || step === "drafting" ? 0 : step === "review" ? 1 : 2;
  return (
    <div className="flex items-center gap-2 text-[0.8125rem]">
      {order.map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          <span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold", i < at ? "bg-ink text-page" : i === at ? "bg-ink/[0.1] text-ink" : "bg-ink/[0.04] text-faint")}>
            {i < at ? "✓" : i + 1}
          </span>
          <span className={i === at ? "font-medium" : "text-mute"}>{s}</span>
          {i < order.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
        </span>
      ))}
    </div>
  );
}

/** The draft as an editable profile: name, number, target, then what it does and uses. */
function Review({ spec, onChange, taken, color }: { spec: LooperSpec; onChange: (s: LooperSpec) => void; taken: string[]; color: Accent }) {
  const set = (patch: Partial<LooperSpec>) => onChange({ ...spec, ...patch });
  const clash = taken.some((n) => n.toLowerCase() === spec.name.trim().toLowerCase());
  return (
    <div className="tile mt-6 divide-y divide-line overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <Bot size={56} color={color} seed={spec.name || "new"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <input value={spec.name} onChange={(e) => set({ name: e.target.value })} aria-label="Name" className="w-40 rounded-[8px] bg-transparent text-[1.375rem] font-semibold tracking-[-0.02em] outline-none hover:bg-ink/[0.04] focus:bg-ink/[0.04]" />
            <input value={spec.role ?? ""} onChange={(e) => set({ role: e.target.value })} aria-label="Role" placeholder="Role" className="w-28 rounded-[5px] bg-ink/[0.05] px-1.5 text-[0.75rem] text-mute outline-none" />
          </div>
          {clash && <div className="text-[0.8125rem] text-red">You already have a looper called {spec.name}.</div>}
          <textarea value={spec.mission} onChange={(e) => set({ mission: e.target.value })} rows={3} aria-label="Mission" className="mt-1 w-full resize-none rounded-[8px] bg-transparent text-[0.9375rem] leading-relaxed text-ink-2 outline-none hover:bg-ink/[0.03] focus:bg-ink/[0.03]" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="eyebrow">Owns one number</div>
          <div className="mt-1 text-[1.125rem] font-medium">{spec.metric.name}</div>
          <div className="text-[0.8125rem] text-mute">
            {spec.metric.direction === "up" ? "Higher is better" : "Lower is better"} · {spec.metric.unit}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <label className="flex flex-col text-[0.75rem] text-mute">
            Now
            <input
              type="number"
              value={spec.metric.current ?? ""}
              placeholder="?"
              onChange={(e) => set({ metric: { ...spec.metric, current: e.target.value === "" ? undefined : Number(e.target.value) } })}
              className="mt-0.5 h-9 w-24 rounded-[10px] bg-ink/[0.05] px-2.5 text-[0.9375rem] text-ink outline-none"
            />
          </label>
          <span className="pb-2 text-mute">→</span>
          <label className="flex flex-col text-[0.75rem] text-mute">
            Target
            <input
              type="number"
              value={spec.metric.target}
              onChange={(e) => set({ metric: { ...spec.metric, target: Number(e.target.value) } })}
              className="mt-0.5 h-9 w-24 rounded-[10px] bg-ink/[0.05] px-2.5 text-[0.9375rem] font-medium text-ink outline-none"
            />
          </label>
        </div>
      </div>

      <div className="p-5">
        <div className="eyebrow">Skills</div>
        <div className="mt-2 flex flex-col gap-2">
          {spec.skills.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
              <div className="min-w-0">
                <div className="text-[0.9375rem]">
                  <span className="font-medium">{s.name}</span> <span className="text-mute">· {describeSchedule({ type: s.type, time: s.time, days: s.days })}</span>
                </div>
                <div className="line-clamp-2 text-[0.8125rem] text-mute">{s.instructions}</div>
              </div>
            </div>
          ))}
          <div className="flex gap-3 text-[0.8125rem] text-mute">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
            Weekly retro, Fridays at 17:00 (added automatically)
          </div>
        </div>
      </div>

      {(spec.apps.length > 0 || spec.database) && (
        <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          {spec.apps.length > 0 && (
            <div>
              <div className="eyebrow">Uses</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spec.apps.map((a) => (
                  <span key={a} className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-[0.8125rem]">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {spec.database && (
            <div>
              <div className="eyebrow">Keeps a database</div>
              <div className="mt-1 text-[0.9375rem]">
                {spec.database.name} <span className="text-mute">· one row per {spec.database.rowNoun}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {spec.database.columns.map((c) => (
                  <span key={c.name} className="tag">
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {spec.starterCards.length > 0 && (
        <div className="p-5">
          <div className="eyebrow">First tasks</div>
          <div className="mt-2 flex flex-col gap-1">
            {spec.starterCards.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[0.875rem]">
                <span className="text-mute">{c.for === "you" ? "You:" : `${spec.name}:`}</span> {c.title}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
