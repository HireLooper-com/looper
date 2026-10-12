import Link from "next/link";
import { sql } from "@/lib/db";
import type { Workspace } from "@/lib/workspace";
import { role as findRole, KINDS, ROLES, type Role } from "@/lib/roles";
import { TOOLKITS } from "@/lib/composio";
import { connectedSet } from "@/lib/tools";
import { kindsOf, toolsShown } from "@/lib/draft-steps";
import type { Looper } from "@/lib/engine";
import { fmt } from "../l/[id]/shared";
import { Avatar, ToolIcon } from "../bits";
import { Fire } from "../l/[id]/brief-edit";
import type { DraftData } from "@/lib/draft";

type Hired = Looper & { value: string | null; proposed: number };

function status(l: Hired) {
  if (l.plan_status === "waiting") return "Waiting for your model key";
  if (l.plan_status === "planning") return "Planning its week";
  if (l.plan_status === "failed") return "Planning failed, open to retry";
  if (l.proposed) return `${l.proposed} card${l.proposed > 1 ? "s" : ""} to approve`;
  return "Working on its calendar";
}

function metricLine(l: Hired) {
  const short = l.metric_name.split(",")[0];
  if (l.value === null) return `${short}, first reading soon`;
  const v = fmt(Number(l.value), l.unit);
  return l.target === null ? `${short} ${v}` : `${short} ${v} of ${fmt(Number(l.target), l.unit)}`;
}

/** The founder's team as an org chart, like the landing page. Hired loopers link to their dashboard; live roles open the picker. */
export default async function HireChart({ ws }: { ws: Workspace }) {
  const loopers = await sql<Hired>`
    select l.*, (select value from metric_points p where p.looper_id = l.id order by taken_at desc limit 1) as value,
      (select count(*)::int from cards c where c.looper_id = l.id and c.status = 'proposed') as proposed
    from loopers l where l.workspace_id = ${ws.id} and l.fired_at is null order by l.id`;
  const drafts = await sql<{ id: number; role: string; data: DraftData }>`
    select id, role, data from drafts where workspace_id = ${ws.id} order by updated_at desc limit 6`;

  const first = new Map<string, Hired>();
  const extra: Hired[] = [];
  for (const l of loopers) {
    if (l.role !== "custom" && !first.has(l.role)) first.set(l.role, l);
    else extra.push(l);
  }

  const connected = await connectedSet(ws.id);
  // A role's tools as this founder runs them, and a count of the others that do the same job.
  const tools = (r: Role) => {
    const shown = toolsShown(r, connected);
    const others = kindsOf(r).flatMap((k) => KINDS[k].tools).filter((t) => !shown.includes(t));
    return (
      <span className="xo-t">
        {shown.map((t) => <ToolIcon key={t} slug={t} />)}
        {others.length > 0 && (
          <span className="xti" role="img" aria-label={`Or ${others.map((t) => TOOLKITS[t] ?? t).join(", ")}`} title={`Or ${others.map((t) => TOOLKITS[t] ?? t).join(", ")}`}>
            +{others.length}
          </span>
        )}
      </span>
    );
  };

  const groups = (["Distribution", "Operations"] as const).map((g) => [g, ROLES.filter((r) => r.group === g)] as const);
  let col = 0;

  const hiredNode = (l: Hired) => (
    // A box, not a link: the Fire form cannot sit inside a link. The link covers the card under it.
    <div key={`l${l.id}`} className="xo-n on" style={{ gridColumn: ++col }}>
      <Link className="xo-a" href={`/app/l/${l.id}`} aria-label={`Open ${l.name}`} />
      <Fire looper={l.id} name={l.name} back="/app/hire" className="xo-fire" label="Fire" />
      <Avatar roleId={l.role} id={l.id} />
      <b>{l.name}</b>
      <span className="xo-m tab">{metricLine(l)}</span>
      <span className="xo-t">{l.tools.map((t) => <ToolIcon key={t} slug={t} />)}</span>
      <span className="xo-r">
        <i className={l.plan_status === "planning" || l.proposed ? "live" : ""} />
        {status(l)}
      </span>
    </div>
  );

  const roleNode = (r: Role) => {
    const c = ++col;
    if (!r.live)
      return (
        <div key={r.id} className="xo-n off" style={{ gridColumn: c }} aria-disabled="true">
          <Avatar roleId={r.id} />
          <b>{r.name}</b>
          <span className="xo-m">{r.example}</span>
          {tools(r)}
          <span className="xo-r">Coming soon</span>
        </div>
      );
    return (
      <Link key={r.id} className="xo-n" href={`/app/new?role=${r.id}`} style={{ gridColumn: c }}>
        <Avatar roleId={r.id} />
        <b>{r.name}</b>
        <span className="xo-m">{r.work[0]?.name ?? `Pick 1 of ${r.metrics.length} metrics`}</span>
        {tools(r)}
        <span className="xo-r">
          <span className="xo-hire">Hire</span>
        </span>
      </Link>
    );
  };

  const nodes = groups.map(([g, rs]) => {
    const from = col + 1;
    const els = rs.map((r) => (first.has(r.id) ? hiredNode(first.get(r.id)!) : roleNode(r)));
    return { g, from, to: col, els };
  });
  const side = extra.map(hiredNode);
  const custom = ROLES.find((r) => r.id === "custom")!;
  const ownCol = ++col;

  return (
    <>
      <div className="xo">
        <div className="xo-you">
          <span className="xo-av">You</span>
          <b>Founder</b>
          <small>{ws.website ? ws.website.replace(/^https?:\/\//, "") : "Approve the calendar and the skills"}</small>
        </div>
        <div className="xo-g" style={{ ["--n" as string]: col }}>
          {nodes.map((n) => n.els)}
          {side}
          <Link className="xo-n xo-own" href="/app/new?role=custom" style={{ gridColumn: ownCol }}>
            <Avatar roleId="custom" />
            <b>{custom.name}</b>
            <span className="xo-m">{custom.example}</span>
            <span className="xo-r">Pick the metric and the unit of work. It suggests the tools and writes its skills.</span>
          </Link>
          {nodes.map((n) => (
            <div key={n.g} className="xo-lab" style={{ gridColumn: `${n.from} / ${n.to + 1}` }}>
              {n.g}
            </div>
          ))}
        </div>
      </div>

      {drafts.length > 0 && (
        <section className="xo-drafts" aria-labelledby="drafts-h">
          <h2 id="drafts-h">Setting up</h2>
          {drafts.map((d) => (
            <Link key={d.id} href={`/app/new/${d.id}`} className="xo-draft">
              <Avatar roleId={d.role} size={28} />
              <span>
                {d.role === "custom" ? d.data.name || "Your own looper" : `${findRole(d.role)?.name ?? d.role} looper`}
                <small className="dim">{d.data.metric?.name ?? "No metric yet"}</small>
              </span>
              <span className="dim2">Continue</span>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
