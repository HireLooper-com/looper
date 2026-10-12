"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { MetricPreset, WorkUnit } from "@/lib/roles";
import type { Skill } from "@/lib/plan";
import { draftMetric, draftRepo, draftSkills, draftTools, draftTry, draftWork } from "../../actions";
import { Form } from "../../ui";

export type Source = { slug: string; name: string; connected: boolean };
export type ToolRow = { slug: string; name: string; why: string; icon: ReactNode; connected: boolean; checked: boolean; kind?: Swap };
export type Alt = { slug: string; name: string; connected: boolean; icon?: ReactNode };
/** A role's default the founder can swap for the tool they run: the kind's name, like "help desk", and what can fill it. */
export type Swap = { name: string; options: Alt[] };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Enter in a text field submits the form's first button; this one, so it never removes a skill. */
const Enter = ({ value }: { value: string }) => (
  <button type="submit" name="do" value={value} className="sr" tabIndex={-1} aria-hidden="true" />
);

/** A submit button that says which action it is (`do`), and shows its own busy text while that one runs. */
function Do({ value, children, busy, className = "btn" }: { value: string; children: ReactNode; busy?: string; className?: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("do") === value;
  return (
    <button className={className} type="submit" name="do" value={value} disabled={pending}>
      {mine ? (busy ?? "Saving") : children}
    </button>
  );
}

function Foot({ back, children }: { back?: string; children: ReactNode }) {
  return (
    <div className="xb-foot">
      {back ? (
        <Link className="btn2" href={back}>
          Back
        </Link>
      ) : (
        <Link className="btn2" href="/app/hire">
          Team
        </Link>
      )}
      <div className="xb-act">{children}</div>
    </div>
  );
}

const from = (m: MetricPreset, toolkits: Record<string, string>, swap?: Swap | null) =>
  m.source === "manual"
    ? "You enter it"
    : m.source === "geo"
      ? "Asked daily with web search"
      : swap
        ? `From your ${swap.name}`
        : `From ${toolkits[m.source] ?? m.source}`;

const SETTINGS = "/app/settings#connectors";

/** A select of the tools that do one job, connected ones first. */
function AltSelect({ id, name, swap, value, onChange }: { id: string; name: string; swap: Swap; value?: string; onChange?: (v: string) => void }) {
  const on = swap.options.filter((o) => o.connected);
  const off = swap.options.filter((o) => !o.connected);
  const opts = (xs: Alt[]) => xs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>);
  return (
    <select id={id} name={name} {...(onChange ? { value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) } : { defaultValue: value })}>
      {on.length > 0 && <optgroup label="Connected">{opts(on)}</optgroup>}
      {off.length > 0 && <optgroup label={on.length ? "Connect next" : "Tools"}>{opts(off)}</optgroup>}
    </select>
  );
}

/** Step 1, a predefined role: one of its metrics. */
export function MetricStep({
  draft,
  role,
  metrics,
  picked,
  manualName,
  toolkits,
  swaps,
}: {
  draft?: number;
  role: string;
  metrics: MetricPreset[];
  picked: number;
  manualName: string;
  toolkits: Record<string, string>;
  swaps: ({ swap: Swap; picked: string } | null)[]; // per metric: the founder's own tool, when another tool does the same job
}) {
  const [mi, setMi] = useState(picked);
  const sw = swaps[mi];
  const busy = "Saving";
  return (
    <Form action={draftMetric}>
      {draft && <input type="hidden" name="draft" value={draft} />}
      <input type="hidden" name="role" value={role} />
      <div className="xm" role="radiogroup" aria-label="Metric">
        {metrics.map((m, i) => (
          <label className="xm-r" key={m.name}>
            <input type="radio" name="metric" value={i} checked={mi === i} onChange={() => setMi(i)} />
            <span>
              {m.source === "manual" ? "A metric you track yourself" : m.name}
              <small>
                {from(m, toolkits, swaps[i]?.swap)}
                {m.direction === "down" ? ", lower is better" : ""}
              </small>
            </span>
          </label>
        ))}
      </div>
      {metrics[mi]?.source === "manual" && (
        <>
          <label htmlFor="mname">Metric name</label>
          <input id="mname" name="mname" required defaultValue={manualName} placeholder="Demo calls booked, last 7 days" maxLength={80} />
        </>
      )}
      {sw && (
        <>
          <label htmlFor="from">Your {sw.swap.name}</label>
          <AltSelect key={mi} id="from" name="from" swap={sw.swap} value={sw.picked} />
          <p className="note">
            The looper works the same in any of them. Using another one? Add it as a <Link href={SETTINGS}>custom connector</Link>.
          </p>
        </>
      )}
      <Foot back={draft ? undefined : "/app/hire"}>
        <Do value="next" busy={busy}>
          Continue
        </Do>
      </Foot>
    </Form>
  );
}

/** Step 1, your own looper: its name, the metric, and where it reads it. The model works out which way is better. */
export function SourceStep({
  draft,
  sources,
  picked,
  metric,
  name,
}: {
  draft?: number;
  sources: Source[];
  picked: string;
  metric: string;
  name: string;
}) {
  const on = sources.filter((s) => s.connected);
  const off = sources.filter((s) => !s.connected);
  return (
    <Form action={draftMetric}>
      {draft && <input type="hidden" name="draft" value={draft} />}
      <input type="hidden" name="role" value="custom" />
      <label htmlFor="lname">Name</label>
      <input id="lname" name="lname" required maxLength={40} defaultValue={name} placeholder="Pipeline looper" autoFocus={!name} />
      <label htmlFor="mname">Metric</label>
      <input id="mname" name="mname" required maxLength={80} defaultValue={metric} placeholder="Demo calls booked, last 7 days" />
      <label htmlFor="source">Read it from</label>
      <select id="source" name="source" required defaultValue={picked}>
        <option value="" disabled>
          Pick a tool
        </option>
        {on.length > 0 && (
          <optgroup label="Connected">
            {on.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={on.length ? "Connect after hire" : "Tools"}>
          {off.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
          <option value="manual">I enter it by hand</option>
        </optgroup>
      </select>
      <Foot back={draft ? undefined : "/app/hire"}>
        <Do value="next" busy="Thinking of units of work">
          Continue
        </Do>
      </Foot>
    </Form>
  );
}

/** Step 2: what one card ships. */
export function WorkStep({
  draft,
  options,
  picked,
  own,
  canSuggest,
}: {
  draft: number;
  options: WorkUnit[];
  picked: string;
  own: string;
  canSuggest: boolean;
}) {
  const [w, setW] = useState(picked || (options.length ? "0" : "own"));
  return (
    <Form action={draftWork}>
      <input type="hidden" name="draft" value={draft} />
      <Enter value="next" />
      <div className="xm" role="radiogroup" aria-label="Unit of work">
        {options.map((o, i) => (
          <label className="xm-r" key={o.name} title={o.detail || undefined}>
            <input type="radio" name="work" value={i} checked={w === String(i)} onChange={() => setW(String(i))} />
            <span>{o.name}</span>
          </label>
        ))}
        <label className="xm-r xm-own">
          <input type="radio" name="work" value="own" checked={w === "own"} onChange={() => setW("own")} aria-label="Your own" />
          <input
            type="text"
            name="own"
            required={w === "own"}
            maxLength={120}
            defaultValue={own}
            placeholder="Or your own"
            onFocus={() => setW("own")}
            aria-label="Your own unit of work"
          />
        </label>
      </div>
      {canSuggest && (
        <Do value="again" className="link xm-more" busy="Thinking">
          Suggest 3 others
        </Do>
      )}
      <Foot back={`/app/new/${draft}?s=1`}>
        <Do value="next" busy="Picking tools">
          Continue
        </Do>
      </Foot>
    </Form>
  );
}

/** Step 3: the tools, each with why, connected here or later from the looper's dock. */
export function ToolsStep({ draft, rows, more }: { draft: number; rows: ToolRow[]; more: { slug: string; name: string }[] }) {
  return (
    <Form action={draftTools}>
      <input type="hidden" name="draft" value={draft} />
      <Enter value="next" />
      <div className="xb-tools">
        {rows.map((t) => (
          <ToolLine key={t.slug} t={t} />
        ))}
      </div>
      {more.length > 0 && (
        <details className="xb-more">
          <summary>Add a tool</summary>
          <select id="extra" name="extra" defaultValue="" aria-label="Add a tool">
            <option value="">None</option>
            {more.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>
        </details>
      )}
      <p className="note">
        Not ready? Connect later.
        {rows.some((r) => r.kind) && (
          <>
            {" "}
            Tool not listed? Add a <Link href={SETTINGS}>custom connector</Link>.
          </>
        )}
      </p>
      <Foot back={`/app/new/${draft}?s=2`}>
        <Do value="next" busy="Writing skills, about 30 seconds">
          Continue
        </Do>
      </Foot>
    </Form>
  );
}

/** One tool on step 3. A row with a kind swaps for the founder's own tool in place; `as_<default>` carries the pick. */
function ToolLine({ t }: { t: ToolRow }) {
  const [slug, setSlug] = useState(t.slug);
  const alt = t.kind?.options.find((o) => o.slug === slug);
  const cur = alt ? { name: alt.name, connected: alt.connected, icon: alt.icon ?? t.icon } : t;
  return (
    <div className="xset-c xset-tool">
      <input type="checkbox" name="tool" value={slug} defaultChecked={t.checked} aria-label={`Use ${cur.name}`} />
      {cur.icon}
      <span className="xset-t">
        {t.kind ? (
          <>
            <label className="sr" htmlFor={`as_${t.slug}`}>
              Your {t.kind.name}
            </label>
            <AltSelect id={`as_${t.slug}`} name={`as_${t.slug}`} swap={t.kind} value={slug} onChange={setSlug} />
          </>
        ) : (
          <b>{cur.name}</b>
        )}
        <small>{t.why}</small>
      </span>
      {cur.connected ? (
        <span className="pill on">Connected</span>
      ) : (
        <Do value={`connect:${slug}`} className="btn2 sm" busy="Opening">
          Connect
        </Do>
      )}
    </div>
  );
}

/** Step 4: the skills, each with when it runs, its rules and how its cards are judged. */
export function SkillsStep({
  draft,
  skills,
  judged,
  icons,
}: {
  draft: number;
  skills: Skill[];
  judged: string[];
  icons: { icon: ReactNode; line: string }[];
}) {
  return (
    <Form action={draftSkills}>
      <input type="hidden" name="draft" value={draft} />
      <Enter value="save" />
      <div className="xb-sk">
        {skills.map((s, i) => (
          <article className="xset-c xb-s" key={`${i}-${s.name}`}>
            <div className="xb-s-top">
              <input name={`name_${i}`} defaultValue={s.name} aria-label="Skill name" className="xb-s-n" maxLength={80} />
              <Do value={`remove:${i}`} className="btn2 sm" busy="Removing">
                Remove
              </Do>
            </div>
            <p className="xb-s-tool">
              {icons[i].icon}
              {icons[i].line}
              <span className="xb-judge">{judged[i]}</span>
            </p>
            <fieldset className="xb-when">
              <legend className="sr">Runs</legend>
              {DAYS.map((d, n) => (
                <label key={d} className="xb-day">
                  <input type="checkbox" name={`day_${i}`} value={n} defaultChecked={s.days.includes(n)} />
                  <span>{d}</span>
                </label>
              ))}
              <label className="sr" htmlFor={`hour_${i}`}>
                Hour
              </label>
              <select id={`hour_${i}`} name={`hour_${i}`} defaultValue={s.hour} className="xb-hour">
                {Array.from({ length: 13 }, (_, h) => h + 6).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </fieldset>
            <details className="xb-rules">
              <summary>Rules</summary>
              <textarea id={`rules_${i}`} name={`rules_${i}`} defaultValue={s.rules} rows={Math.min(10, s.rules.split("\n").length + 3)} aria-label="Rules" />
            </details>
          </article>
        ))}
      </div>

      <details className="xb-ask">
        <summary>Change with a sentence</summary>
        <textarea id="ask" name="ask" rows={2} aria-label="What to change" placeholder="Two posts a week, Tuesday and Thursday." />
        <div className="xset-act">
          <Do value="ask" className="btn2 sm" busy="Rewriting, about 30 seconds">
            Change
          </Do>
          <Do value="again" className="link" busy="Writing again">
            Start over
          </Do>
        </div>
      </details>

      <Foot back={`/app/new/${draft}?s=3`}>
        <Do value="next" busy="Saving">
          Continue
        </Do>
      </Foot>
    </Form>
  );
}

/** Step 5: one test run, of the metric read (`metric`) or a skill (`skill:<i>`). Runs on the owner's key; saves nothing but the result. */
/** While a test run works, the looper "types" under it and says what it is reading. The old result hides meanwhile. */
function Typing({ who, avatar, doing }: { who: string; avatar: ReactNode; doing: string }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="chat xt-chat" aria-live="polite">
      <div className="msg typing xt-typing">
        <div className="who2">
          {avatar}
          {who}
        </div>
        {doing}
        <span className="dots3" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

/** One row of Try it: what runs, its button, and the looper typing while it runs. `blocked` says why it cannot run yet. */
export function TryRun({
  draft,
  value,
  title,
  again,
  who,
  avatar,
  doing,
  blocked,
}: {
  draft: number;
  value: string;
  title: string;
  again: boolean;
  who: string;
  avatar: ReactNode;
  doing: string;
  blocked?: string;
}) {
  return (
    <Form action={draftTry}>
      <input type="hidden" name="draft" value={draft} />
      <div className="xt-top">
        <b>{title}</b>
        {blocked ? (
          <span className="dim2 xt-why">{blocked}</span>
        ) : (
          <Do value={value} className={again ? "btn2 sm" : "btn sm"} busy={value === "metric" ? "Reading" : "Running"}>
            {again ? "Try again" : "Try"}
          </Do>
        )}
      </div>
      <Typing who={who} avatar={avatar} doing={doing} />
    </Form>
  );
}

/**
 * Step 5, for a looper that opens pull requests: the founder confirms the one repository they go to.
 * Looper suggests the repo whose homepage or name matches the website and never picks without a click.
 */
export function RepoPick({ draft, repos, saved, guess }: { draft: number; repos: string[]; saved: string; guess: string }) {
  const [v, setV] = useState(saved || guess);
  const sure = Boolean(saved) && v === saved;
  return (
    <Form action={draftRepo} className="xt-repo">
      <input type="hidden" name="draft" value={draft} />
      <div className="xt-repo-row">
        <label htmlFor="xt-repo" className="sr">
          Repository for pull requests
        </label>
        <select id="xt-repo" name="repo" value={v} onChange={(e) => setV(e.target.value)}>
          {!v && <option value="">Pick a repository</option>}
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {sure ? (
          <span className="xt-ok">✓ Confirmed</span>
        ) : (
          <Do value="repo" className="btn sm" busy="Checking">
            {saved ? "Use this one" : "Confirm"}
          </Do>
        )}
      </div>
      <small>
        {sure
          ? `Every pull request goes to ${saved}. It reads no other repository.`
          : !saved && v && v === guess
            ? `Suggested: its homepage or name matches your website. Confirm it, and every pull request goes there and nowhere else.`
            : "Every pull request goes to the repository you confirm here, and nowhere else."}
      </small>
    </Form>
  );
}

/** Step 5: hire, after the summary and the test runs. */
export function HireFoot({ draft, hireLabel }: { draft: number; hireLabel: string }) {
  return (
    <Form action={draftSkills}>
      <input type="hidden" name="draft" value={draft} />
      <Foot back={`/app/new/${draft}?s=4`}>
        <Do value="hire" busy="Hiring">
          {hireLabel}
        </Do>
      </Foot>
    </Form>
  );
}
