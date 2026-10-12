import { sql } from "@/lib/db";
import type { Looper } from "@/lib/engine";
import { DAYS, dayStart, hh, isReflectionFriday, local } from "@/lib/time";
import { runNow, setMode } from "../../../actions";
import { Form, Submit } from "../../../ui";
import { when } from "./shared";

type Routine = { id: number; name: string; tool: string; days: number[]; hour: number; mode: string };
type Version = { routine_id: number; version: number; rules: string; source: string; effective_from: Date; by: string | null };

export default async function CalendarTab({ l, tz, names }: { l: Looper; tz: string; names: Record<string, string> }) {
  const TOOLKITS = names;
  const routines = await sql<Routine>`select id, name, tool, days, hour, mode from routines where looper_id = ${l.id} order by hour, id`;
  const versions = await sql<Version>`
    select v.routine_id, v.version, v.rules, v.source, v.effective_from, u.email as by from routine_versions v
    join routines r on r.id = v.routine_id left join users u on u.id = v.created_by where r.looper_id = ${l.id} order by v.version desc`;
  const runs = await sql<{ routine_id: number; started_at: Date; status: string; cards: number; error: string | null }>`
    select distinct on (routine_id) routine_id, started_at, status, cards, error from runs
    where routine_id in (select id from routines where looper_id = ${l.id}) order by routine_id, started_at desc`;
  const lastRun = new Map(runs.map((r) => [r.routine_id, r]));

  const now = new Date();
  const today = local(now, tz);
  const monday = dayStart(now, tz, -today.wd);
  const dates = DAYS.map((d, i) => ({ d, date: local(new Date(monday.getTime() + i * 864e5 + 12 * 3600e3), tz).d }));
  const reflectThisWeek = isReflectionFriday(new Date(l.created_at), new Date(monday.getTime() + 4 * 864e5 + 17 * 3600e3), tz);
  const hours = [...new Set([...routines.map((r) => r.hour), ...(reflectThisWeek ? [16] : [])])].sort((a, b) => a - b);

  if (!routines.length)
    return <p className="dim">No routines yet. {l.plan_status === "ready" ? "" : "The looper writes them from your website and metric as soon as your model key is connected."}</p>;

  return (
    <>
      <div className="cal" role="table" aria-label="This week">
        <div className="hd" />
        {dates.map((x, i) => (
          <div key={x.d} className={`hd tab ${i === today.wd ? "today" : ""}`}>
            {x.d} {x.date}
          </div>
        ))}
        {hours.map((h) => (
          <div key={h} style={{ display: "contents" }}>
            <div className="hr tab">{hh(h)}</div>
            {DAYS.map((_, d) => (
              <div className="cl" key={d}>
                {routines
                  .filter((r) => r.hour === h && r.days.includes(d))
                  .map((r) => (
                    <div key={r.id} className={`ev ${d === today.wd && h <= today.h && h + 3 > today.h ? "hot" : ""}`}>
                      {r.name}
                      <small>{TOOLKITS[r.tool] ?? "By hand"}</small>
                    </div>
                  ))}
                {reflectThisWeek && d === 4 && h === 16 && (
                  <div className="ev rv">
                    Reflection chat
                    <small>You and the looper, 30 min</small>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {!reflectThisWeek && <p className="note">Reflection is next week: Friday 16:00, every second week.</p>}

      <h2>Routines</h2>
      <div className="rows">
        {routines.map((r) => {
          const vs = versions.filter((v) => v.routine_id === r.id);
          const live = vs.find((v) => new Date(v.effective_from) <= now);
          const next = vs.find((v) => new Date(v.effective_from) > now);
          const run = lastRun.get(r.id);
          return (
            <div className="r" key={r.id} style={{ alignItems: "flex-start", flexDirection: "column" }}>
              <div style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <b style={{ fontWeight: 600 }}>{r.name}</b>
                  <div className="dim tab">
                    {r.days.map((d) => DAYS[d]).join(", ")} {hh(r.hour)} · {TOOLKITS[r.tool] ?? "by hand"}
                    {run && ` · last run ${when(run.started_at, tz)}, ${run.status === "failed" ? "failed" : `${run.cards} card${run.cards === 1 ? "" : "s"}`}`}
                  </div>
                  {run?.status === "failed" && <div className="err" style={{ marginTop: 4 }}>{run.error}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
                  <form action={setMode}>
                    <input type="hidden" name="routine" value={r.id} />
                    <input type="hidden" name="mode" value={r.mode === "auto" ? "ask" : "auto"} />
                    <span className={`pill ${r.mode === "auto" ? "on" : ""}`} style={{ marginRight: 8 }}>{r.mode === "auto" ? "Runs alone" : "Asks first"}</span>
                    <Submit className="btn2 sm">{r.mode === "auto" ? "Ask first" : "Let it run alone"}</Submit>
                  </form>
                  <Form action={runNow}>
                    <input type="hidden" name="routine" value={r.id} />
                    <Submit className="btn2 sm" busy="Running, up to a minute">Run now</Submit>
                  </Form>
                </div>
              </div>
              <details style={{ width: "100%" }}>
                <summary className="dim" style={{ cursor: "pointer" }}>
                  Rules v{live?.version ?? 0}
                  {live?.source.startsWith("chat:") && `, changed in chat${live.by ? ` by ${live.by}` : ""}`}
                  {next && ` · v${next.version} from ${when(next.effective_from, tz)}`}
                </summary>
                <pre className="rules">{live?.rules}</pre>
                {next && (
                  <>
                    <div className="note">
                      v{next.version}, agreed in reflection{next.by ? ` by ${next.by}` : ""}, applies from {when(next.effective_from, tz)}:
                    </div>
                    <pre className="rules">{next.rules}</pre>
                  </>
                )}
              </details>
            </div>
          );
        })}
      </div>
    </>
  );
}
