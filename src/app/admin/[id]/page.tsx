import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { NudgeButton } from "@/components/admin-nudge";
import { Section, Stat, Table, ago, date, money, planLabel } from "@/components/admin-view";
import { Usage } from "@/components/settings-view";
import { Pill } from "@/components/ui";
import { requireAdmin, steps, workspaceDetail } from "@/lib/admin";
import { hasNotes } from "@/lib/loops";
import { getCatalog, nameOf } from "@/lib/models";

export const metadata = { title: "Workspace · Admin · Looper", robots: { index: false } };

/** One workspace for the operators: where it is in onboarding, what it costs, what its loopers did. */
export default async function AdminWorkspacePage({ params }: PageProps<"/admin/[id]">) {
  await connection();
  const me = await requireAdmin();
  const { id } = await params;
  const [detail, catalog] = await Promise.all([workspaceDetail(id, me), getCatalog()]);
  if (!detail) notFound();
  const { row: r, runs, members, usage, log } = detail;
  const at: Partial<Record<string, string>> = { signup: r.at.signup, profile: r.at.profile, hire: r.at.hire, run: r.at.run };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6">
      <Link href="/admin" className="text-[0.875rem] text-mute hover:text-ink">
        ← Admin
      </Link>
      <h1 className="display mt-3 text-[2rem] sm:text-[2.5rem]">{r.name}</h1>
      <p className="mt-2 text-[1rem] text-mute">
        {r.owner.email ?? "No email"}{" "}
        <span className="text-faint">
          · {planLabel(r)} · signed up {date(r.createdAt)} · last seen {ago(r.lastSeen)}
          {r.site && (
            <>
              {" · "}
              <a href={r.site} target="_blank" rel="noreferrer" className="hover:text-ink">
                {r.site.replace(/^https?:\/\//, "")}
              </a>
            </>
          )}
        </span>
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Runs, 7 days" value={String(r.runsOk7)} sub={`${r.runsFailed7} failed · last ${ago(r.lastRunAt)}`} />
        <Stat label="Messages, 7 days" value={String(r.messages7)} sub={`${r.openAsks} open asks${r.oldestAsk ? `, oldest ${ago(r.oldestAsk)}` : ""}`} />
        <Stat label="Our spend this month" value={money(r.spendUs + r.infra)} sub={`${money(r.spendUs)} models · ${money(r.infra)} computers`} />
        <Stat
          label="Credits left"
          value={r.credits ? money(Math.max(0, r.credits.granted - r.credits.used)) : "–"}
          sub={r.credits ? `of ${money(r.credits.granted)} · ${money(r.spendUs7 / 7)} a day` : "none granted"}
        />
      </div>

      {r.nudges.length > 0 && (
        <Section title="Needs a nudge">
          <div className="tile divide-y divide-line">
            {r.nudges.map((n) => (
              <div key={n.reason} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[0.875rem]">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{n.label}</div>
                  {n.since && <div className="text-[0.75rem] text-mute">since {date(n.since)}</div>}
                </div>
                <NudgeButton wsId={r.id} nudge={n} to={r.owner.email} canSend={hasNotes()} />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Onboarding">
        <ol className="tile divide-y divide-line">
          {steps().map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-[0.875rem]">
              <span className={r.reached[s.id] ? "text-ink" : "text-faint"}>{r.reached[s.id] ? "✓" : "○"}</span>
              <span className={r.reached[s.id] ? "flex-1" : "flex-1 text-mute"}>{s.label}</span>
              <span className="text-faint tabular-nums">{at[s.id] ? date(at[s.id]) : ""}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Loopers" hint={String(r.loopers.length)}>
        <Table
          head={[{ label: "Looper" }, { label: "Metric" }, { label: "Runs, 7 days", right: true }, { label: "Last run", right: true }]}
          rows={r.loopers.map((l) => [
            <span key="n" className="font-medium">
              {l.name} {l.paused && <Pill>Paused</Pill>}
            </span>,
            l.metric,
            l.runs7,
            l.lastRun ? <span key="l" className={l.lastRun.status === "error" ? "text-red" : undefined}>{`${l.lastRun.status} · ${ago(l.lastRun.at)}`}</span> : "never",
          ])}
          empty="No loopers hired."
        />
      </Section>

      <Section title="Recent runs" hint="summaries only">
        {runs.length ? (
          <div className="tile divide-y divide-line">
            {runs.map((run) => (
              <div key={run.id} className="px-4 py-3 text-[0.875rem]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{run.looper}</span>
                  <span className="text-mute">{run.skill}</span>
                  <span className={run.status === "error" ? "text-red" : "text-faint"}>{run.status}</span>
                  <span className="ml-auto text-[0.75rem] text-faint">
                    {run.trigger} · {ago(run.at)}
                  </span>
                </div>
                {run.summary && <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">{run.summary}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="tile px-4 py-4 text-[0.875rem] text-mute">No runs yet.</p>
        )}
      </Section>

      <Section title="Model usage" hint="this month">
        <Usage
          sources={false}
          usage={{
            ...usage,
            byModel: usage.byModel.map((m) => ({ ...m, name: nameOf(catalog, m.provider, m.model) })),
            bySource: usage.bySource.map((x) => ({ ...x, name: x.source })),
          }}
        />
      </Section>

      <Section title="People" hint={String(members.length)}>
        <Table
          head={[{ label: "Person" }, { label: "Role" }, { label: "Last sign-in", right: true }]}
          rows={members.map((m) => [
            <div key="p">
              <div className="font-medium">{m.name}</div>
              <div className="text-[0.75rem] text-mute">{m.email ?? "no email"}</div>
            </div>,
            m.role,
            ago(m.lastLoginAt),
          ])}
          empty="Nobody."
        />
      </Section>

      {log.length > 0 && (
        <Section title="Admin log">
          <div className="tile divide-y divide-line">
            {log.map((e) => (
              <div key={e.at} className="flex flex-wrap gap-x-3 px-4 py-2.5 text-[0.8125rem]">
                <span className="text-faint tabular-nums">{date(e.at)}</span>
                <span className="flex-1">{e.detail}</span>
                <span className="text-mute">{e.by}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
