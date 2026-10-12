import Link from "next/link";
import type { Workspace } from "@/lib/workspace";
import { KINDS, kindOf, type Role } from "@/lib/roles";
import { enabledToolkits, TOOLKITS } from "@/lib/composio";
import { connectorsOf, PREFIX } from "@/lib/connectors";
import { altsOf, connectableNames, connectedSet, githubFor, toolkitNames } from "@/lib/tools";
import { repos as githubRepos } from "@/lib/publish";
import { routineFrom } from "@/lib/spec";
import { guessRepo, kindIn, nextStep, presetTools, shipsPRs, stackFor, STEPS, trialKey, workOptions, type LooperDraft, type Trial } from "@/lib/draft";
import { Avatar, ToolIcon } from "../bits";
import { Rich } from "../l/[id]/rich";
import { HireFoot, MetricStep, RepoPick, SkillsStep, SourceStep, ToolsStep, TryRun, WorkStep, type Source, type Swap } from "./steps";

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

/**
 * A test run as the looper's message, the way it will talk in the chat after hire: what it checked as
 * a row of marks, what it found in its own words, then the cards it would put up for approval.
 */
function TrialView({ t, who, avatar }: { t: Trial; who: string; avatar: React.ReactNode }) {
  const stop = t.stages.find((x) => x.ok === "no");
  const research = t.stages.find((x) => x.name === "Research");
  const result = t.stages.find((x) => x.name === "Cards" || x.name === "Reading");
  const held = t.stages.find((x) => x.name === "Held back");
  const checks = t.stages.filter((x) => x !== research && x !== result && x !== held && x !== stop);
  const made = t.cards.filter((c) => !c.held);
  return (
    <div className="chat xt-chat xt-res">
      <div className="msg xt-msg">
        <div className="who2">
          {avatar}
          {who} · test run
        </div>
        {checks.length > 0 && (
          <ul className="xt-checks">
            {checks.map((x) => (
              <li key={x.name} className={x.ok}>
                <b aria-hidden="true">{MARK[x.ok]}</b>
                {x.text}
              </li>
            ))}
          </ul>
        )}
        {stop ? (
          <p className="err">{stop.text}</p>
        ) : (
          <>
            {research && (research.ok === "yes" ? <Rich text={research.text} /> : <p className="dim">{research.text}</p>)}
            {result && <p className={`xt-end ${made.length || result.ok === "yes" ? "yes" : ""}`}>{made.length ? `${made.length} card${made.length > 1 ? "s" : ""} for you to approve:` : result.text}</p>}
          </>
        )}
      </div>
      {made.map((c, i) => (
        <details key={i} className="xt-card">
          <summary>
            <small>Would ask you to approve</small>
            <b>{c.title}</b>
            <span className="dim">{c.how}</span>
          </summary>
          <Rich text={c.detail} />
        </details>
      ))}
      {held && (
        <div className="msg xt-msg xt-held">
          <div className="who2">Held back by the rules</div>
          <Rich text={held.text} />
        </div>
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
    // A looper that opens pull requests needs its repository confirmed before it tries or hires.
    const prs = shipsPRs(skills) && connected.has("github");
    let repoList: { repo: string; homepage: string }[] = [];
    let repoErr = "";
    if (prs)
      try {
        repoList = await githubRepos(await githubFor(ws));
      } catch (e) {
        repoErr = (e as Error).message;
      }
    const who = custom ? data.name || "Your looper" : `${r.name.replace(/ manager$/, "")} looper`;
    const avatar = <Avatar roleId={r.id} size={18} />;
    const doing = (x: (typeof skills)[number]) => {
      const reads = [x.action === "github_pr" ? data.repo || "the repository" : x.tool && name(x.tool), r.sitePages && "your sitemap"].filter(Boolean);
      return `Reading ${reads.length ? reads.join(" and ") : "the rules"}, then drafting cards. Up to 3 minutes`;
    };
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
          {prs && (
            <div className="xt-line">
              <span>Repo</span>
              {repoErr ? (
                <p className="err">GitHub did not list repositories: {repoErr}</p>
              ) : (
                <RepoPick
                  draft={d.id}
                  repos={[...new Set([...(data.repo ? [data.repo] : []), ...repoList.map((x) => x.repo)])]}
                  saved={data.repo ?? ""}
                  guess={guessRepo(repoList, ws.website)}
                />
              )}
            </div>
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
              <TryRun draft={d.id} value="metric" title="Read the metric" again={Boolean(trials.metric)} who={who} avatar={avatar} doing={`Reading ${src}`} />
              {trials.metric && <TrialView t={trials.metric} who={who} avatar={avatar} />}
            </div>
          )}
          {skills.map((x, i) => {
            const t = trials.skills?.[trialKey(x)];
            return (
              <div className="xt-run" key={i}>
                <TryRun
                  draft={d.id}
                  value={`skill:${i}`}
                  title={x.name}
                  again={Boolean(t)}
                  who={who}
                  avatar={avatar}
                  doing={doing(x)}
                  blocked={prs && x.action === "github_pr" && !data.repo ? "Confirm the repo above first" : undefined}
                />
                {t && <TrialView t={t} who={who} avatar={avatar} />}
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
