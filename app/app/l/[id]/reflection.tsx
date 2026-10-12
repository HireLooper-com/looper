import { sql } from "@/lib/db";
import type { Looper } from "@/lib/engine";
import { lineDiff, type Reflection } from "@/lib/reflection";
import { dayStart, isReflectionFriday, nextMonday } from "@/lib/time";
import { acceptDiff, proposeDiff, sendReflection, startReflection } from "../../../actions";
import { Form, Submit } from "../../../ui";
import { when } from "./shared";
import { Rich } from "./rich";

function nextReflection(hiredAt: Date, tz: string) {
  for (let i = 0; i < 21; i++) {
    const day = dayStart(new Date(), tz, i);
    const at = new Date(day.getTime() + 16 * 3600e3);
    if (isReflectionFriday(hiredAt, at, tz) && at > new Date()) return at;
  }
  return null;
}

export function Diff({ from, to }: { from: string; to: string }) {
  return (
    <div className="diff" aria-label="Rule changes">
      {lineDiff(from, to).map(([k, line], i) => (
        <div key={i} className={k === "-" ? "m" : k === "+" ? "p" : "k"}>{line}</div>
      ))}
    </div>
  );
}

export default async function ReflectionTab({ l, tz, me }: { l: Looper; tz: string; me: string }) {
  const all = await sql<Reflection>`select * from reflections where looper_id = ${l.id} order by due_on desc limit 12`;
  const cur = all.find((r) => r.status === "open" || r.status === "proposed");
  const past = all.filter((r) => r !== cur);
  const next = nextReflection(new Date(l.created_at), tz);
  const monday = nextMonday(new Date(), tz);

  return (
    <>
      {cur ? (
        <>
          <h2 style={{ marginTop: 0 }}>
            Reflection, {new Date(cur.due_on).toISOString().slice(0, 10)}. <span className="c">30 minutes on what moved the metric and what did not.</span>
          </h2>
          {cur.messages.length === 0 ? (
            <Form action={startReflection}>
              <input type="hidden" name="reflection" value={cur.id} />
              <p className="dim">The looper has read the last two weeks: readings, done cards with their deltas, and every rejected card with your reason.</p>
              <Submit busy="Reading the last two weeks">Start the reflection</Submit>
            </Form>
          ) : (
            <>
              <div className="chat">
                {cur.messages.map((m, i) => (
                  <div key={i} className={`msg ${m.role === "user" ? "me" : ""}`}>
                    <div className="who2">{m.role === "user" ? (m.by && m.by !== me ? m.by : "You") : l.name}</div>
                    {m.role === "user" ? m.content : <Rich text={m.content} />}
                  </div>
                ))}
              </div>
              {cur.status === "open" && (
                <>
                  <Form action={sendReflection} reset>
                    <input type="hidden" name="reflection" value={cur.id} />
                    <label htmlFor="text">Your reply</label>
                    <textarea id="text" name="text" rows={3} style={{ fontFamily: "var(--font)", fontSize: 15 }} placeholder="Stop pausing keywords on Mondays, weekend data is thin." />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <Submit busy="The looper is writing">Send</Submit>
                    </div>
                  </Form>
                  <Form action={proposeDiff}>
                    <input type="hidden" name="reflection" value={cur.id} />
                    <p className="note" style={{ marginTop: 20 }}>Done talking? The chat ends in a diff of the looper's rules. Nothing changes until you accept it.</p>
                    <Submit className="btn2" busy="Writing the diff">End with a diff</Submit>
                  </Form>
                </>
              )}
            </>
          )}

          {cur.status === "proposed" && cur.proposal && (
            <form action={acceptDiff} style={{ marginTop: 24 }}>
              <input type="hidden" name="reflection" value={cur.id} />
              <h2>The diff</h2>
              <p>{cur.proposal.summary}</p>
              {cur.proposal.changes.length === 0 && <p className="dim">No rule changes. The routines stay as they are.</p>}
              {cur.proposal.changes.map((c) => (
                <div key={c.routine_id} style={{ marginBottom: 20 }}>
                  <div className="mono dim">{c.name} · v{c.from_version} → v{c.from_version + 1}</div>
                  <Diff from={c.from} to={c.to} />
                  <div className="note">{c.why}</div>
                  <details>
                    <summary className="dim" style={{ cursor: "pointer", marginTop: 8 }}>Edit before accepting</summary>
                    <textarea name={`rules-${c.routine_id}`} rows={Math.max(4, c.to.split("\n").length + 1)} defaultValue={c.to} />
                  </details>
                </div>
              ))}
              <Submit busy="Saving">Accept, applies {when(monday, tz)}</Submit>
            </form>
          )}
        </>
      ) : (
        <div className="rows">
          <div className="r">
            <span>Next reflection</span>
            <span className="v">{next ? `${when(next, tz)}, 30 min` : "Every second Friday, 16:00"}</span>
          </div>
          <div className="r">
            <span>What it covers</span>
            <span className="v">Readings, done cards and their deltas, rejected cards and your reasons</span>
          </div>
          <div className="r">
            <span>How it ends</span>
            <span className="v">A diff of the rules you accept or edit, applied from the next Monday</span>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <>
          <h2>Past reflections</h2>
          <div className="rows">
            {past.map((r) => (
              <details className="r" key={r.id} style={{ display: "block" }}>
                <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                  <span className="tab">{new Date(r.due_on).toISOString().slice(0, 10)}</span>
                  <span className="v">{r.proposal?.changes.length ? r.proposal.changes.map((c) => `${c.name} v${c.from_version} → v${c.from_version + 1}`).join(", ") : r.status === "accepted" ? "No rule changes" : "Not finished"}</span>
                </summary>
                {r.proposal?.summary && <p className="dim" style={{ marginTop: 10 }}>{r.proposal.summary}</p>}
                {r.proposal?.changes.map((c) => <Diff key={c.routine_id} from={c.from} to={c.to} />)}
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}
