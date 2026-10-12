import { sql } from "@/lib/db";
import { TOOLKITS } from "@/lib/composio";
import type { Looper } from "@/lib/engine";
import { enterMetric, readNow, setTarget } from "../../../actions";
import { Form, Submit } from "../../../ui";
import { fmt, signed } from "./shared";

function Chart({ vals, target, unit }: { vals: number[]; target: number | null; unit: string }) {
  const W = 720, H = 260, L = 52, R = 16, T = 16, B = 28;
  // Round the top of the axis to a clean step so labels read 0, 1.5, 3, 4.5.
  const raw = Math.max(target ?? 0, ...vals) * 1.15 || 1;
  const step = Math.pow(10, Math.floor(Math.log10(raw / 3)));
  const unitStep = [1, 2, 2.5, 5, 10].map((k) => k * step).find((s) => s * 3 >= raw) ?? raw / 3;
  const max = unitStep * 3;
  const min = Math.min(0, ...vals);
  const x = (i: number) => L + (vals.length > 1 ? (i * (W - L - R)) / (vals.length - 1) : (W - L - R) / 2);
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const grid = [0, 1 / 3, 2 / 3, 1].map((k) => min + (max - min) * k);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Metric over the last ${vals.length} readings`}>
      {grid.map((g) => (
        <g key={g}>
          <line className="gl" x1={L} x2={W - R} y1={y(g)} y2={y(g)} />
          <text x={L - 8} y={y(g) + 4} textAnchor="end">{fmt(g, unit)}</text>
        </g>
      ))}
      {target !== null && (
        <>
          <line className="tg" x1={L} x2={W - R} y1={y(target)} y2={y(target)} />
          <text x={W - R} y={y(target) - 6} textAnchor="end">target {fmt(target, unit)}</text>
        </>
      )}
      {vals.length > 1 && <polygon className="ar" points={`${x(0)},${y(min)} ${pts} ${x(vals.length - 1)},${y(min)}`} />}
      {vals.length > 1 && <polyline className="ln" points={pts} />}
      {vals.length > 0 && <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={4} fill="var(--acc)" />}
    </svg>
  );
}

export default async function MetricTab({ l }: { l: Looper }) {
  const points = await sql<{ value: string; taken_at: Date; note: string }>`
    select value, taken_at, note from (select * from metric_points where looper_id = ${l.id} order by taken_at desc limit 30) p order by taken_at`;
  const [s] = await sql<{ done: number; attributed: number; delta: string | null; rejected: number }>`
    select count(*) filter (where status = 'done')::int as done,
           count(*) filter (where attribution = 'attributed')::int as attributed,
           sum(delta) filter (where attribution = 'attributed') as delta,
           count(*) filter (where status = 'rejected')::int as rejected
    from cards where looper_id = ${l.id}`;
  const vals = points.map((p) => Number(p.value));
  const last = vals[vals.length - 1];
  const target = l.target === null ? null : Number(l.target);
  const gap = last === undefined || target === null ? null : target - last;
  const daysLeft = Math.ceil((new Date(l.target_date).getTime() - Date.now()) / 864e5);
  const src =
    l.metric_source === "manual" ? "You enter it" : l.metric_source === "geo" ? "AI answers with web search, on your keys" : TOOLKITS[l.metric_source] ?? l.metric_source;
  const note = points[points.length - 1]?.note;

  return (
    <div className="mx">
      <div>
        <div className="dim">{l.metric_name}</div>
        <div className="big tab">
          {last === undefined ? "–" : fmt(last, l.unit)}
          {target !== null && <small>{l.direction === "down" ? "target under " : "of "}{fmt(target, l.unit)}</small>}
        </div>
        <div className="dim tab">
          {last === undefined
            ? "First reading comes with the next daily read."
            : target === null
              ? "The looper sets a target 20% better than this reading."
              : gap === 0
                ? "On target."
                : `${signed(gap!, l.unit)} to go, ${daysLeft} days left`}
        </div>
        <Chart vals={vals} target={target} unit={l.unit} />
        {l.metric_source === "geo" && (
          <>
            <h2>The {l.prompts.length || 10} buyer questions</h2>
            {note && <p className="dim">Last reading: {note}</p>}
            {l.prompts.length ? (
              <ol className="xq">
                {l.prompts.map((q) => <li key={q}>{q}</li>)}
              </ol>
            ) : (
              <p className="dim">The looper writes them when it plans its week.</p>
            )}
          </>
        )}
      </div>
      <div>
        <div className="rows">
          <div className="r"><span>Source</span><span className="v">{src}</span></div>
          <div className="r"><span>Target</span><span className="v tab">{target === null ? "set on day 1" : fmt(target, l.unit)}, by {new Date(l.target_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></div>
          <div className="r"><span>Cards done</span><span className="v tab">{s.done}</span></div>
          <div className="r"><span>Attributed</span><span className="v tab">{s.attributed} cards, {s.delta === null ? "±0" : signed(Number(s.delta), l.unit)}</span></div>
          <div className="r"><span>Rejected</span><span className="v tab">{s.rejected}, reasons go to the reflection</span></div>
        </div>
        {l.metric_source !== "manual" && l.metric_error && (
          <p className="err" style={{ margin: "16px 0 0", fontSize: 13 }}>
            The daily read failed: {l.metric_error.slice(0, 300).replace(/\.?$/, ".")} The looper tries again in 6 hours.
          </p>
        )}
        {l.metric_source !== "manual" && (
          <Form action={readNow}>
            <input type="hidden" name="looper" value={l.id} />
            <div style={{ marginTop: 16 }}><Submit className="btn2 sm" busy="Reading">{l.metric_source === "geo" ? "Ask the questions now" : `Read from ${src} now`}</Submit></div>
          </Form>
        )}
        <details style={{ marginTop: 16 }}>
          <summary className="dim" style={{ cursor: "pointer", fontSize: 14 }}>Change the target</summary>
          <Form action={setTarget}>
            <input type="hidden" name="looper" value={l.id} />
            <div className="row2">
              <div>
                <label htmlFor="t-target">Target{l.unit ? ` (${l.unit})` : ""}</label>
                <input id="t-target" name="target" inputMode="decimal" required defaultValue={target ?? ""} />
              </div>
              <div>
                <label htmlFor="t-date">By</label>
                <input id="t-date" name="date" type="date" required defaultValue={new Date(l.target_date).toISOString().slice(0, 10)} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}><Submit className="btn2 sm">Save target</Submit></div>
          </Form>
        </details>
        <form action={enterMetric} style={{ marginTop: 16 }}>
          <input type="hidden" name="looper" value={l.id} />
          <label htmlFor="value">Enter a reading by hand</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="value" name="value" inputMode="decimal" required placeholder={last === undefined ? "" : String(last)} />
            <Submit className="btn2">Save</Submit>
          </div>
        </form>
      </div>
    </div>
  );
}
