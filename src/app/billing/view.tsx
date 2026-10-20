"use client";

import { useState, useTransition } from "react";
import { openBillingPortal, startCheckout } from "@/app/billing-actions";
import { Bot, Button, cx } from "@/components/ui";

type Plan = "personal" | "team";

const money = (n: number) => `$${n.toFixed(2)}`;
const price = (n: number) => `$${Math.round(n)}`;
const FEATURES: Record<Plan, string[]> = {
  personal: ["Unlimited loopers", "Approvals before anything goes out", "Apps, boards, database, canvas, retros", "One-time AI credits to start", "Then your own Grok, ChatGPT or API key"],
  team: ["Everything in Personal", "Unlimited collaborators", "Shared loopers, chats and approvals", "Invite links and roles", "Bigger one-time AI credits"],
};

export function BillingView(props: {
  workspace: { name: string; kind: "personal" | "team"; isOwner: boolean };
  billing: { plan: Plan; status: string; periodEnd?: string } | null;
  access: boolean;
  comped: boolean;
  credits: { left: number; granted: number };
  infra: { spent: number; cap: number };
  plans: { id: Plan; name: string; usd: number; credits: number; blurb: string }[];
  want?: Plan;
  welcome: boolean;
  template?: string;
}) {
  const { billing, workspace } = props;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const go = (fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>, key: string) =>
    start(async () => {
      setError(null);
      setBusy(key);
      const r = await fn();
      if (r.ok) window.location.assign(r.url);
      else {
        setError(r.error);
        setBusy(null);
      }
    });

  return (
    <div className="mx-auto max-w-[880px] px-4 py-8 sm:px-6">
      {props.welcome && (
        <div className="fade-up tile mb-6 flex items-center gap-4 p-5">
          <Bot dark seed="chief" size={48} className="looping" />
          <div>
            <div className="text-[1.0625rem] font-semibold">You&apos;re in. Welcome to Looper.</div>
            <p className="text-[0.875rem] text-mute">Your credits are ready. Tell Chief about your business and hire your first looper in three steps.</p>
          </div>
          <a href={props.template ? `/hire?template=${encodeURIComponent(props.template)}` : "/welcome"} className="ml-auto shrink-0 rounded-full bg-ink px-4 py-2 text-[0.875rem] font-medium text-page hover:bg-ink-2">
            {props.template ? "Hire a looper" : "Get started"}
          </a>
        </div>
      )}

      <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em]">{props.access ? "Plan & credits" : "Choose a plan"}</h1>
      <p className="mt-1 text-[0.9375rem] text-mute">
        {workspace.kind === "team" ? `${workspace.name} · team workspace` : "Your personal workspace"}
      </p>

      {props.access && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Plan" value={props.comped ? "Complimentary" : billing ? `${billing.plan === "team" ? "Team" : "Personal"}` : "—"} note={billing ? statusNote(billing) : props.comped ? "On the house" : ""} />
          <Stat label="AI credits left" value={money(props.credits.left)} note={props.credits.granted ? `of ${price(props.credits.granted)} included` : "Use your own Grok, ChatGPT or key"} />
          <Stat label="Computers this month" value={money(props.infra.spent)} note={`of ${price(props.infra.cap)} included`} bar={props.infra.spent / props.infra.cap} />
        </div>
      )}

      {props.access && billing && workspace.isOwner && (
        <div className="mt-4">
          <Button variant="soft" size="sm" disabled={pending} onClick={() => go(openBillingPortal, "portal")}>
            {busy === "portal" ? "Opening…" : "Manage subscription, invoices and card"}
          </Button>
        </div>
      )}

      {(!props.access || !billing) && !props.comped && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {props.plans.map((p) => {
            const teamNeedsName = p.id === "team" && workspace.kind === "personal";
            const disabled = pending || (p.id === "personal" && workspace.kind === "team");
            return (
              <div key={p.id} className={cx("tile flex flex-col p-6", props.want === p.id && "ring-2 ring-ink")}>
                <div className="flex items-baseline justify-between">
                  <div className="text-[1.125rem] font-semibold">{p.name}</div>
                  <div>
                    <span className="text-[1.75rem] font-semibold tracking-[-0.03em]">${p.usd}</span>
                    <span className="text-[0.875rem] text-mute"> / month</span>
                  </div>
                </div>
                <p className="mt-1 text-[0.875rem] text-mute">{p.blurb}</p>
                <div className="mt-4 rounded-[12px] bg-ink/[0.05] px-3.5 py-2.5 text-[0.875rem]">
                  <span className="font-semibold">${p.credits} in AI credits</span> <span className="text-mute">included once</span>
                </div>
                <ul className="mt-4 flex flex-1 flex-col gap-1.5 text-[0.875rem]">
                  {FEATURES[p.id].map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-mute">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                {teamNeedsName && (
                  <input
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="Team name, e.g. Acme"
                    aria-label="Team name"
                    className="mt-4 h-10 rounded-full bg-ink/[0.05] px-4 text-[0.875rem] outline-none focus:bg-ink/[0.08]"
                  />
                )}
                <Button className="mt-4 w-full" disabled={disabled || !workspace.isOwner} onClick={() => go(() => startCheckout(p.id, teamName.trim() || undefined, props.template), p.id)}>
                  {busy === p.id ? "Opening checkout…" : p.id === "team" && teamNeedsName ? "Create team & subscribe" : `Get ${p.name}`}
                </Button>
                {p.id === "personal" && workspace.kind === "team" && <p className="mt-2 text-[0.75rem] text-mute">Personal is for your personal workspace. Switch to it to subscribe.</p>}
              </div>
            );
          })}
        </div>
      )}

      {!workspace.isOwner && !props.access && <p className="mt-4 text-[0.875rem] text-mute">Only the owner of this workspace can choose its plan. Ask them to subscribe.</p>}
      {error && <p className="mt-4 text-[0.875rem] text-red">{error}</p>}

      <p className="mt-8 text-[0.8125rem] leading-relaxed text-mute">
        Credits pay for Claude while your loopers work; they&apos;re given once per plan and don&apos;t expire. When they run out, connect your own Grok, ChatGPT or API key in Settings and keep going. Each workspace includes up to ${props.infra.cap} of computer time a month. Prefer to run the code yourself?{" "}
        <a href="https://github.com/HireLooper-com/looper" className="underline hover:text-ink">
          Star us on GitHub
        </a>
        .
      </p>
    </div>
  );
}

function statusNote(b: { status: string; periodEnd?: string }) {
  const end = b.periodEnd ? new Date(b.periodEnd).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
  if (b.status === "active" || b.status === "trialing") return end ? `Renews ${end}` : "Active";
  if (b.status === "past_due") return "Payment failed — update your card";
  return b.status === "canceled" ? "Canceled" : b.status;
}

function Stat({ label, value, note, bar }: { label: string; value: string; note?: string; bar?: number }) {
  return (
    <div className="tile p-4">
      <div className="text-[0.75rem] text-mute">{label}</div>
      <div className="mt-1 text-[1.375rem] font-semibold tracking-[-0.02em]">{value}</div>
      {bar !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/[0.08]">
          <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, bar * 100)}%` }} />
        </div>
      )}
      {note && <div className="mt-1 text-[0.75rem] text-mute">{note}</div>}
    </div>
  );
}
