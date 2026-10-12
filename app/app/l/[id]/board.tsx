import Link from "next/link";
import { sql } from "@/lib/db";
import type { Card, Looper } from "@/lib/engine";
import { isAuthError } from "@/lib/tools";
import { checksFor } from "@/lib/checks";
import { PR_SLUG, type PrArgs } from "@/lib/publish";
import { approve, done, reject, retry, undo } from "../../../actions";
import { Form, Submit } from "../../../ui";
import { signed } from "./shared";

const hm = (d: Date | null, tz: string) =>
  d ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "";

/** A pull request card in words: the repo, then each file with its new text or its edits. */
function prText(a: PrArgs) {
  const files = (a.files ?? []).map((f) =>
    f.edits?.length
      ? `${f.path}, ${f.edits.length} edit${f.edits.length > 1 ? "s" : ""}:\n${f.edits.map((e) => `- ${e.find.slice(0, 200)}\n+ ${e.replace.slice(0, 400)}`).join("\n")}`
      : f.content === null
        ? `${f.path}: delete`
        : `${f.path}, new text:\n${String(f.content ?? "").slice(0, 1500)}${String(f.content ?? "").length > 1500 ? "\n…" : ""}`,
  );
  return [`Pull request to ${a.repo}: ${a.title}`, ...files].join("\n\n");
}

function Detail({ c }: { c: Card }) {
  const pr = c.action?.tool_slug === PR_SLUG;
  const body = [
    c.detail,
    c.subject ? `Changes: ${c.subject}` : "",
    pr ? prText(c.action!.arguments as PrArgs) : c.action ? `Tool call: ${c.action.tool_slug}\n${JSON.stringify(c.action.arguments, null, 2)}` : "",
    pr ? (c.undo ? "Undo opens a pull request that puts the old files back." : "") : c.undo ? `Undo with: ${c.undo.tool_slug}\n${JSON.stringify(c.undo.arguments, null, 2)}` : c.action ? "No undo call for this one." : "",
    c.result ? (c.result.startsWith("Shipped: ") ? c.result.slice(0, 600) : `Result: ${c.result.slice(0, 600)}`) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!body) return null;
  return (
    <details>
      <summary>Details</summary>
      <p>{body}</p>
    </details>
  );
}

/** Done by hand asks what shipped, so a card nobody shipped never claims the next reading. */
function MarkDone({ card, label }: { card: number; label: string }) {
  return (
    <details style={{ marginTop: 0 }}>
      <summary className="btn2 sm" style={{ listStyle: "none" }}>{label}</summary>
      <form action={done} style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input type="hidden" name="card" value={card} />
        <input name="shipped" required maxLength={500} placeholder="Link to what shipped, or one line" aria-label="What shipped" />
        <Submit className="btn2 sm">Done</Submit>
      </form>
    </details>
  );
}

function Tag({ c, unit }: { c: Card; unit: string }) {
  if (c.status !== "done") return null;
  if (c.attribution === "attributed") return <span className="ok tab">{signed(Number(c.delta), unit)}</span>;
  if (c.attribution === "unattributed") return <span>unattributed</span>;
  return <span>waiting for next reading</span>;
}

type Row = Card & { routine: string | null; by: string | null };
type Check = { day: number; status: string; reading: string; verdict: string };

/** What the looper read on each check day after the card was done, with its verdict. */
function Checks({ list }: { list: Check[] | undefined }) {
  const done = (list ?? []).filter((k) => k.status === "done" || k.status === "failed");
  if (!done.length) return null;
  return (
    <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
      {done.map((k) => (
        <div key={k.day}>
          Day {k.day}: {k.status === "failed" ? `could not read. ${k.reading}` : k.reading}
          {k.verdict && k.verdict !== "baseline" && (
            <span className={k.verdict === "keep" ? "ok" : k.verdict === "revert" ? "bad" : ""}> {k.verdict === "revert" ? "worse, undo suggested" : k.verdict}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function BoardTab({ l, tz }: { l: Looper; tz: string }) {
  const cards = await sql<Row>`
    select c.*, r.name as routine, u.email as by from cards c left join routines r on r.id = c.routine_id
    left join users u on u.id = c.acted_by
    where c.looper_id = ${l.id} and (c.status not in ('done','reverted') or c.updated_at > now() - interval '14 days')
      and (c.status <> 'rejected' or c.updated_at > now() - interval '14 days')
    order by c.created_at desc limit 200`;
  // Names next to decisions only matter once a workspace has collaborators.
  const [{ n: people }] = await sql<{ n: number }>`select count(*)::int as n from members where workspace_id = ${l.workspace_id}`;
  const who = (c: Row) => (people > 1 && c.by ? ` · ${c.by.split("@")[0]}` : "");
  const col = (s: Card["status"][]) => cards.filter((c) => s.includes(c.status));
  const checks = await checksFor(cards.filter((c) => c.status === "done" || c.status === "reverted").map((c) => c.id));
  const rejected = col(["rejected"]);

  const card = (c: Row) => (
    <div key={c.id} className={`kc ${c.status === "running" ? "run" : ""} ${c.status === "failed" ? "failed" : ""}`}>
      {c.title}
      <div className="tg">
        <span>
          {hm(c.status === "done" ? c.done_at : c.created_at, tz)} · {c.tool || "by hand"}
          {c.status !== "proposed" && who(c)}
        </span>
        <Tag c={c} unit={l.unit} />
        {c.status === "failed" && <span className="bad">failed</span>}
        {c.status === "reverted" && <span>undone</span>}
        {c.status === "running" && c.ext?.pr && <span>waiting for merge</span>}
      </div>
      <Detail c={c} />
      <Checks list={checks.get(c.id)} />
      {c.status === "running" && c.ext?.pr && (
        <div className="acts">
          <a className="btn2 sm" href={c.ext.pr.url} target="_blank" rel="noreferrer">
            Review pull request
          </a>
        </div>
      )}
      {c.status === "proposed" && (
        <div className="acts">
          <form action={approve}>
            <input type="hidden" name="card" value={c.id} />
            <Submit className="btn sm" busy="Approving">Approve</Submit>
          </form>
          <details style={{ marginTop: 0 }}>
            <summary className="btn2 sm" style={{ listStyle: "none" }}>Reject</summary>
            <form action={reject} style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input type="hidden" name="card" value={c.id} />
              <input name="reason" placeholder="Why? The looper reads this" aria-label="Reason" />
              <Submit className="btn2 sm">Reject</Submit>
            </form>
          </details>
        </div>
      )}
      {c.status === "approved" && !c.action && (
        <div className="acts">
          <MarkDone card={c.id} label="Mark done" />
        </div>
      )}
      {c.status === "done" && c.undo && (
        <div className="acts">
          <Form action={undo}>
            <input type="hidden" name="card" value={c.id} />
            <Submit className="btn2 sm" busy="Undoing">Undo</Submit>
          </Form>
        </div>
      )}
      {c.status === "failed" && isAuthError(c.result) && (
        <p className="err" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
          {c.tool || "The tool"} rejected the key or sign-in. Reconnect it, then retry.
        </p>
      )}
      {c.status === "failed" && (
        <div className="acts">
          {isAuthError(c.result) && (
            <Link className="btn sm" href="/app/settings#tools">
              Reconnect {c.tool || "tool"}
            </Link>
          )}
          <form action={retry}>
            <input type="hidden" name="card" value={c.id} />
            <Submit className="btn2 sm" busy="Retrying">Retry</Submit>
          </form>
          <MarkDone card={c.id} label="I did it by hand" />
        </div>
      )}
    </div>
  );

  const columns: [string, Card["status"][]][] = [
    ["Proposed", ["proposed"]],
    ["Approved", ["approved", "failed"]],
    ["Running", ["running"]],
    ["Done", ["done", "reverted"]],
  ];
  return (
    <>
      <div className="board">
        {columns.map(([name, s]) => {
          const list = col(s);
          return (
            <section className="col" key={name} aria-label={name}>
              <h3>
                {name} <span className="tab">{list.length}</span>
              </h3>
              {list.length ? list.map(card) : <div className="empty">{name === "Proposed" ? "New cards land here after each routine run." : "None"}</div>}
            </section>
          );
        })}
      </div>
      {rejected.length > 0 && (
        <>
          <h2>
            Rejected, last 14 days <span className="c">Reasons feed the next reflection.</span>
          </h2>
          <div className="rows">
            {rejected.map((c) => (
              <div className="r" key={c.id}>
                <span>{c.title}</span>
                <span className="v">
                  {c.reject_reason || "No reason given"}
                  {who(c)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
