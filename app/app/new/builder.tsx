import Link from "next/link";
import type { Workspace } from "@/lib/workspace";
import { KINDS, kindOf, type Role } from "@/lib/roles";
import { enabledToolkits, TOOLKITS } from "@/lib/composio";
import { connectorsOf, PREFIX } from "@/lib/connectors";
import { altsOf, connectableNames, connectedSet, toolkitNames } from "@/lib/tools";
import { routineFrom } from "@/lib/spec";
import { kindIn, nextStep, presetTools, stackFor, STEPS, trialKey, workOptions, type LooperDraft, type Trial } from "@/lib/draft";
import { Avatar, ToolIcon } from "../bits";
import { HireFoot, MetricStep, SkillsStep, SourceStep, ToolsStep, TryButton, WorkStep, type Source, type Swap } from "./steps";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const short = (r: Role) => {
  const s = r.name.replace(/ manager$/, "");
  return /[A-Z]{2}/.test(s) ? s : s.toLowerCase();
};

/** "Checked on day 14 and 28" from the role's check-back, or the metric. */
function judgedLine(r: Role, slug: string | undefined, tool: string) {
  const preset = r.routines.find((p) => p.slug === slug);
  const days = routineFrom(r, { tool, check: preset?.check }).check_days.filter((d) => d > 0);
  if (!days.length) return "Checked by the metric";
  return `Checked on day ${days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days.at(-1)}`}`;
}

const MARK = { yes: "✓", warn: "!", no: "×" } as const;

/** A test run in one line: the problem that stopped it, or what it made. The stages wait behind a click. */
function TrialView({ t }: { t: Trial }) {
  const stop = t.stages.find((x) => x.ok === "no");
  const made = t.cards.filter((c) => !c.held);
  const last = t.stages.at(-1);
  const head = stop ? stop.text : made.length ? `${made.length} card${made.length > 1 ? "s" : ""}` : (last?.text ?? "Done");
  return (
    <div className="xt-res">
      <p className={`xt-head ${stop ? "no" : made.length || last?.ok === "yes" ? "yes" : "warn"}`}>
        <b aria-hidden="true">{MARK[stop ? "no" : made.length || last?.ok === "yes" ? "yes" : "warn"]}</b>
        {head}
      </p>
      {made.length > 0 && (
        <div className="xt-cards">
          {made.map((c, i) => (
            <details key={i} className="xt-card">
              <summary>{c.title}</summary>
              <small>{c.how}</small>
              <p>{c.detail}</p>
            </details>
          ))}
        </div>
      )}
      {t.stages.length > 1 && (
        <details className="xt-how">
          <summary>How it ran</summary>
          <ol className="xt-st">
            {t.stages.map((x) => (
              <li key={x.name} className={x.ok}>
                <b aria-hidden="true">{MARK[x.ok]}</b>
                <span>
                  <em>{x.name}</em> {x.text}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** One step of the looper builder. `d` is null on step 1 before anything is saved. */
export default async function Builder({ ws, role: r, d, step }: { ws: Workspace; role: Role; d: LooperDraft | null; step: number }) {
  const data = d?.data ?? {};
  const reached = d ? nextStep(data) : 1;
  const connected = await connectedSet(ws.id);
  const custom = r.id === "custom";
  const stack = stackFor(r, connected, data.stack);
  const swapOf = async (kind: string | undefined): Promise<Swap | undefined> => {
    if (!kind || !KINDS[kind]) return undefined;
    const options = (await altsOf(ws.id, kind, connected)).map((o) => ({ ...o, icon: <ToolIcon slug={o.slug} name={o.name} /> }));
    return options.length > 1 ? { name: KINDS[kind].name, options } : undefined;
  };

  const titles = [
    [custom ? "Your looper." : "The metric.", "What it works to improve."],
    ["One card.", "What it ships each time."],
    ["Tools.", "Connect what it needs."],
    ["Skills.", "What it does each week."],
    ["Try it.", "Nothing is saved."],
  ];

  let body: React.ReactNode = null;
  if (step === 1 && custom) {
    // Your own looper picks any tool: connected ones first, then the workspace's custom connectors, then the rest.
    const on = await enabledToolkits();
    const own = (await connectorsOf(ws.id)).map((c) => ({ slug: PREFIX + c.slug, name: c.name, connected: true }));
    const all = [
      ...Object.entries(TOOLKITS)
        .filter(([slug]) => !on || on.has(slug) || connected.has(slug))
        .map(([slug, name]) => ({ slug, name, connected: connected.has(slug) })),
      ...own,
    ];
    const sources: Source[] = all.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
    body = <SourceStep draft={d?.id} sources={sources} picked={data.metric?.source ?? ""} metric={data.metric?.name ?? ""} name={data.name ?? ""} />;
  } else if (step === 1) {
    const i = data.metric ? r.metrics.findIndex((m) => m.name === data.metric!.name || (m.source === "manual" && data.metric!.source === "manual")) : 0;
    body = (
      <MetricStep
        draft={d?.id}
        role={r.id}
        metrics={r.metrics}
        picked={Math.max(0, i)}
        manualName={data.metric?.source === "manual" ? data.metric.name : ""}
        toolkits={TOOLKITS}
        swaps={await Promise.all(
          r.metrics.map(async (m, j) => {
            const k = kindOf(m.source);
            const swap = await swapOf(k);
            if (!k || !swap) return null;
            // The tool picked before for this metric, then the founder's own of this kind, then the role's default.
            const before = j === i ? data.metric?.source : undefined;
            const want = [before, stack[k], m.source].find((x) => x && swap.options.some((o) => o.slug === x));
            return { swap, picked: want ?? swap.options[0].slug };
          }),
        )}
      />
    );
  } else if (step === 2 && d) {
    const options = workOptions(r, data);
    const i = data.work ? options.findIndex((o) => o.name === data.work!.name) : -1;
    body = (
      <>
        {data.note && <p className="err">{data.note}</p>}
        <WorkStep draft={d.id} options={options} picked={data.work ? (i >= 0 ? String(i) : "own") : ""} own={i < 0 ? (data.work?.name ?? "") : ""} canSuggest={custom} />
      </>
    );
  } else if (step === 3 && d) {
    const names = await toolkitNames(ws.id);
    const options = data.toolOptions ?? presetTools(r, { ...data, stack });
    const ticked = data.tools ?? data.picked;
    const kinds = await Promise.all(options.map((t) => swapOf(t.kind ?? kindIn(t.slug, stack))));
    const rows = options.map((t, j) => ({
      slug: t.slug,
      name: names[t.slug] ?? t.slug,
      why: t.why,
      icon: <ToolIcon slug={t.slug} name={names[t.slug]} />,
      connected: connected.has(t.slug) || t.slug.startsWith(PREFIX),
      checked: ticked ? ticked.includes(t.slug) : true,
      kind: kinds[j]?.options.some((o) => o.slug === t.slug) ? kinds[j] : undefined,
    }));
    const can = await connectableNames(ws.id);
    const more = Object.entries(can)
      .filter(([slug]) => !options.some((o) => o.slug === slug))
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    body = <ToolsStep draft={d.id} rows={rows} more={more} />;
  } else if (step === 4 && d) {
    const names = await toolkitNames(ws.id);
    const skills = data.skills ?? [];
    body = skills.length ? (
      <SkillsStep
        draft={d.id}
        skills={skills}
        judged={skills.map((s) => judgedLine(r, s.slug, s.tool))}
        icons={skills.map((s) => ({
          icon: s.tool ? <ToolIcon slug={s.tool} name={names[s.tool]} /> : <span className="xti" aria-hidden="true">✎</span>,
          line:
            s.action === "manual" || !s.tool
              ? "By hand"
              : s.action === "github_pr" && s.tool !== "github"
                ? `${names[s.tool] ?? s.tool}, then GitHub`
                : (names[s.tool] ?? s.tool),
        }))}
      />
    ) : (
      <p className="err">No skills yet. Go back one step and press Continue to write them.</p>
    );
  } else if (step === 5 && d && data.metric && data.work) {
    const names = await toolkitNames(ws.id);
    const skills = data.skills ?? [];
    const m = data.metric;
    const name = (slug: string) => names[slug] ?? TOOLKITS[slug] ?? slug;
    const tools = [...new Set([m.source, ...(data.tools ?? [])])].filter((t) => t !== "manual" && t !== "geo");
    const on = (t: string) => connected.has(t) || t.startsWith(PREFIX);
    const src = m.source === "manual" ? "you enter it" : m.source === "geo" ? "AI answers" : name(m.source);
    const readable = m.source !== "manual" && m.source !== "geo";
    const trials = data.trials ?? {};
    body = (
      <>
        <section className="xset-c xt-sum">
          <p className="xt-line">
            <span>Metric</span>
            <b>{m.name.split(",")[0]}</b>
            <small>from {src}</small>
          </p>
          {tools.length > 0 && (
            <p className="xt-line">
              <span>Tools</span>
              <span className="xt-tools">
                {tools.map((t) => (
                  <span key={t} className={on(t) ? "xt-tool" : "xt-tool off"} title={on(t) ? "Connected" : "Not connected"}>
                    <ToolIcon slug={t} name={names[t]} />
                    {name(t)}
                    {!on(t) && <small>not connected</small>}
                  </span>
                ))}
              </span>
            </p>
          )}
          <table className="xt-week">
            <caption className="sr">The week</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr">Skill</span>
                </th>
                {DAYS.map((x) => (
                  <th key={x} scope="col">
                    {x.slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.map((x, i) => (
                <tr key={i}>
                  <th scope="row">{x.name}</th>
                  {DAYS.map((_, n) => (
                    <td key={n} className="tab">
                      {x.days.includes(n) ? `${String(x.hour).padStart(2, "0")}:00` : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="xt-list">
          {readable && (
            <div className="xt-run">
              <div className="xt-top">
                <b>Read the metric</b>
                <TryButton draft={d.id} value="metric" again={Boolean(trials.metric)}>
                  Try
                </TryButton>
              </div>
              {trials.metric && <TrialView t={trials.metric} />}
            </div>
          )}
          {skills.map((x, i) => {
            const t = trials.skills?.[trialKey(x)];
            return (
              <div className="xt-run" key={i}>
                <div className="xt-top">
                  <b>{x.name}</b>
                  <TryButton draft={d.id} value={`skill:${i}`} again={Boolean(t)}>
                    Try
                  </TryButton>
                </div>
                {t && <TrialView t={t} />}
              </div>
            );
          })}
        </div>
        <HireFoot draft={d.id} hireLabel={custom ? "Hire" : `Hire the ${short(r)} looper`} />
      </>
    );
  }

  return (
    <main className="xb">
      <div className="who">
        <Avatar roleId={r.id} size={40} />
        <span className="dim">{custom ? data.name || "Your own looper" : `${r.name} looper`}</span>
      </div>
      <ol className="xs" aria-label="Looper setup">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const cls = n === step ? "now" : n < reached ? "done" : "";
          return (
            <li key={s} className={cls} aria-current={n === step ? "step" : undefined}>
              <b className="tab">{cls === "done" ? "✓" : n}</b>
              {d && n <= reached && n !== step ? <Link href={`/app/new/${d.id}?s=${n}`}>{s}</Link> : s}
            </li>
          );
        })}
      </ol>
      <h1>
        {titles[step - 1][0]} <span className="c">{titles[step - 1][1]}</span>
      </h1>
      {body}
    </main>
  );
}
