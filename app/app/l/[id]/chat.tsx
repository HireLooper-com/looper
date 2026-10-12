import type { Looper } from "@/lib/engine";
import { messages, type Change, type Message } from "@/lib/talk";
import { slotText } from "@/lib/talk-turns";
import { applyChange, dismissChange, talk } from "../../../actions";
import { Form, Submit } from "../../../ui";
import { Avatar } from "../../bits";
import { Diff } from "./reflection";
import { Rich } from "./rich";
import { Composer } from "./talk-ui";
import { fmt, when } from "./shared";

function What({ c, l, names }: { c: Change; l: Looper; names: Record<string, string> }) {
  switch (c.kind) {
    case "rules":
      return (
        <>
          <div className="mono dim">{c.name} · rules v{c.from_version} → v{c.from_version + 1}, from now</div>
          <Diff from={c.from} to={c.to} />
        </>
      );
    case "schedule":
      return (
        <div className="mono dim">
          {c.name} · {slotText(c.from)} → {slotText(c.to)}
        </div>
      );
    case "routine":
      return (
        <>
          <div className="mono dim">
            New routine · {c.name} · {slotText({ days: c.days, hour: c.hour, mode: "ask" })} · {c.tool ? names[c.tool] ?? c.tool : "by hand"}
          </div>
          <pre className="rules">{c.rules}</pre>
        </>
      );
    case "target":
      return (
        <div className="mono dim">
          Target · {c.from.target === null ? "not set" : fmt(c.from.target, l.unit)} by {c.from.date} → {c.to.target === null ? "not set" : fmt(c.to.target, l.unit)} by {c.to.date}
        </div>
      );
    case "brief":
      return (
        <>
          <div className="mono dim">Brief</div>
          <Diff from={c.from} to={c.to} />
        </>
      );
    case "run":
      return <div className="mono dim">Run {c.name} now · cards land on the board</div>;
  }
}

function ChangeCard({ m, i, c, l, names, me }: { m: Message; i: number; c: Change; l: Looper; names: Record<string, string>; me: string }) {
  return (
    <div className={`tc ${c.status}`}>
      <What c={c} l={l} names={names} />
      {c.why && <div className="note">{c.why}</div>}
      {c.status === "proposed" ? (
        <div className="acts">
          <Form action={applyChange}>
            <input type="hidden" name="talk" value={m.id} />
            <input type="hidden" name="i" value={i} />
            <Submit className="btn sm" busy={c.kind === "run" ? "Running, up to a minute" : "Applying"}>
              {c.kind === "run" ? "Run now" : "Apply"}
            </Submit>
          </Form>
          <form action={dismissChange}>
            <input type="hidden" name="talk" value={m.id} />
            <input type="hidden" name="i" value={i} />
            <Submit className="btn2 sm" busy="Dismissing">Dismiss</Submit>
          </form>
        </div>
      ) : (
        <div className="dim tc-s">
          {c.status === "applied" ? `Applied${c.by && c.by !== me ? ` by ${c.by}` : ""}.` : "Dismissed."} {c.note}
        </div>
      )}
    </div>
  );
}

/** The chat with the looper, in the right panel of the looper page next to the tabs. */
export default async function ChatPanel({ l, tz, me, names, routines }: { l: Looper; tz: string; me: string; names: Record<string, string>; routines: { name: string }[] }) {
  const list = await messages(l.id);
  const short = l.metric_name.split(",")[0].toLowerCase();
  const asks = [
    `How far is ${short} from the target?`,
    "What are you working on this week?",
    routines[0] ? `Run ${routines[0].name.toLowerCase()} now` : "What should your first routine be?",
  ];

  return (
    <div className="talk">
      <div className="talk-h">
        <Avatar roleId={l.role} id={l.id} size={28} />
        <div>
          <b>{l.name}</b>
          <small>{l.metric_name}</small>
        </div>
      </div>
      {list.length > 0 ? (
        // The log is a column-reverse scroller around one child, so it opens scrolled to the newest message without script.
        <div className="talk-log" role="log" aria-label={`Messages with ${l.name}`}>
          <div className="chat">
            {list.map((m) => (
              <div key={m.id} className={`msg ${m.role === "user" ? "me" : ""}`}>
                <div className="who2">
                  {m.role === "user" ? (m.email && m.email !== me ? m.email : "You") : l.name} · {when(m.created_at, tz)}
                </div>
                {m.role === "user" ? m.content : <Rich text={m.content} />}
                {m.changes.map((c, i) => (
                  <ChangeCard key={i} m={m} i={i} c={c} l={l} names={names} me={me} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="dim talk-hi">
          Ask about {short}, a card or a routine, or ask for a change to a rule, the schedule or the target. {l.name} proposes it here and nothing changes until you press Apply.
        </p>
      )}
      <Form action={talk} reset className="talk-f">
        <input type="hidden" name="looper" value={l.id} />
        {list.length === 0 && (
          <div className="asks">
            {asks.map((a) => (
              <button key={a} className="btn2 sm" type="submit" name="ask" value={a}>
                {a}
              </button>
            ))}
          </div>
        )}
        <Composer name={l.name} placeholder={`Message ${l.name}`} />
        <div className="talk-b">
          <span className="dim2">Shift+Enter for a new line</span>
          <Submit className="btn sm" busy="Answering">Send</Submit>
        </div>
      </Form>
    </div>
  );
}
