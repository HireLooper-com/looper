import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { Card } from "@/lib/engine";
import { approve, reject } from "../../actions";
import { Submit } from "../../ui";
import { Avatar } from "../bits";
import { fmt } from "../l/[id]/shared";

type Row = {
  id: number;
  name: string;
  role: string;
  metric_name: string;
  unit: string;
  target: string | null;
  target_date: string;
  ws_id: number;
  ws: string;
  value: string | null;
  proposed: number;
  failed: number;
};

/** Every looper in every workspace the founder belongs to, and every card waiting on them. */
export default async function All() {
  const u = await requireUser();
  const loopers = await sql<Row>`
    select l.id, l.name, l.role, l.metric_name, l.unit, l.target, l.target_date, w.id as ws_id, w.name as ws,
      (select value from metric_points p where p.looper_id = l.id order by taken_at desc limit 1) as value,
      (select count(*)::int from cards c where c.looper_id = l.id and c.status = 'proposed') as proposed,
      (select count(*)::int from runs r join routines rt on rt.id = r.routine_id
        where rt.looper_id = l.id and r.status = 'failed' and r.started_at > now() - interval '7 days') as failed
    from loopers l join workspaces w on w.id = l.workspace_id join members m on m.workspace_id = w.id
    where m.user_id = ${u.id} and l.fired_at is null order by w.id, l.id`;
  const cards = await sql<Card & { looper: string; role: string; ws: string }>`
    select c.*, l.name as looper, l.role, w.name as ws from cards c
    join loopers l on l.id = c.looper_id join workspaces w on w.id = l.workspace_id join members m on m.workspace_id = w.id
    where m.user_id = ${u.id} and c.status = 'proposed' order by c.created_at desc limit 50`;
  const groups = [...new Set(loopers.map((l) => l.ws))];

  return (
    <main className="wide xset">
      <h1>
        All workspaces.{" "}
        <span className="c">
          {loopers.length} looper{loopers.length === 1 ? "" : "s"}, {cards.length} card{cards.length === 1 ? "" : "s"} to approve.
        </span>
      </h1>

      {cards.length > 0 && (
        <section className="xset-s" id="approve">
          <div className="xset-h">
            <h2>To approve</h2>
            <p className="dim">Cards waiting on you across {groups.length} workspace{groups.length === 1 ? "" : "s"}, newest first.</p>
          </div>
          <div className="xset-b">
            {cards.map((c) => (
              <div className="xset-c xset-p xset-card" key={c.id}>
                <Avatar roleId={c.role} id={c.looper_id} size={36} />
                <span className="xset-t">
                  <span>{c.title}</span>
                  <small>
                    {c.ws} · <Link href={`/app/l/${c.looper_id}?tab=board`}>{c.looper}</Link> · {c.tool || "by hand"}
                  </small>
                </span>
                <span className="xset-btns">
                  <form action={approve}>
                    <input type="hidden" name="card" value={c.id} />
                    <Submit className="btn sm" busy="Approving">Approve</Submit>
                  </form>
                  <details>
                    <summary className="btn2 sm" style={{ listStyle: "none" }}>Reject</summary>
                    <form action={reject} style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <input type="hidden" name="card" value={c.id} />
                      <input name="reason" placeholder="Why? The looper reads this" aria-label="Reason" />
                      <Submit className="btn2 sm">Reject</Submit>
                    </form>
                  </details>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.map((g) => {
        const ls = loopers.filter((l) => l.ws === g);
        return (
          <section className="xset-s" key={g}>
            <div className="xset-h">
              <h2>{g}</h2>
              <p className="dim">
                {ls.length} looper{ls.length === 1 ? "" : "s"}, {ls.reduce((n, l) => n + l.proposed, 0)} to approve
              </p>
            </div>
            <div className="xset-b">
              <div className="xset-grid">
                {ls.map((l) => (
                  <Link className="xset-c xset-p xset-lk" key={l.id} href={`/app/l/${l.id}`}>
                    <Avatar roleId={l.role} id={l.id} size={36} />
                    <span className="xset-t">
                      <b>{l.name}</b>
                      <small>{l.metric_name.split(",")[0]}</small>
                      <small className="tab">
                        {l.value === null ? "No reading yet" : fmt(Number(l.value), l.unit)}
                        {l.target !== null && ` of ${fmt(Number(l.target), l.unit)}`}
                        {l.proposed > 0 && ` · ${l.proposed} to approve`}
                        {l.failed > 0 && <span className="bad"> · {l.failed} failed runs, 7 days</span>}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        );
      })}
      {!loopers.length && <p className="dim">No loopers yet. Pick a workspace and hire one from Team.</p>}
    </main>
  );
}
