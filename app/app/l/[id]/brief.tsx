import type { Looper } from "@/lib/engine";
import { parseNotes, type Field } from "@/lib/brief";
import type { SetupStep } from "@/lib/roles";
import { when } from "./shared";
import { Editable, Fire, LearnAgain } from "./brief-edit";

// The looper's brief as a page: what the business does, then what it learned at hire, one property
// per `key: value` line. Routines read all of it before every card. Anyone in the workspace can edit;
// an edit keeps the previous text under earlier versions.

const LABEL: Record<string, string> = { url: "URL", edit: "May edit", never: "Never touches", repo: "Repository" };
const label = (k: string) => LABEL[k.toLowerCase()] ?? k[0].toUpperCase() + k.slice(1);

// `code`, a path (src/app/**) or a file name (schema.sql) set in mono; the rest stays prose.
const CODE = /(`[^`]+`|(?<![\w/])(?:[\w.:@<>*\[\]-]*\/[\w./@<>*\[\]-]*[\w*\]>/]|\.?[\w<>-]+\.(?:tsx?|jsx?|mdx?|json|ya?ml|sql|css|html|astro|example|txt))(?![\w/]))/g;

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(CODE).map((part, i) =>
        i % 2 ? (
          <code key={i}>{part.replace(/^`|`$/g, "")}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Value({ f }: { f: Field }) {
  if (!f.items.length) return <div className="xpg-v"><Rich text={f.text} /></div>;
  return (
    <ul className="xpg-v xpg-list">
      {f.items.map((x, i) => (
        <li key={i}>
          {x.path ? <code>{x.path}</code> : <span>{x.note}</span>}
          {x.path && x.note && <span className="dim"> {x.note}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function BriefTab({ l, steps, tz, me, names }: { l: Looper; steps: SetupStep[]; tz: string; me: string; names: Record<string, string> }) {
  const site = l.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const edited = steps.some((s) => l.setup?.[s.id]?.by);
  const who = (by?: string) => (by ? (by === me ? "you" : by) : "the looper");

  return (
    <article className="xpg">
      <h2 className="xpg-t">
        Brief <span className="c">{l.name} reads this before every card. Change a line and the next routine follows it.</span>
      </h2>

      <div className="xpg-props">
        <div className="xpg-p">
          <span className="xpg-k">Website</span>
          <div className="xpg-v">
            {site ? (
              <a href={/^https?:/.test(l.website) ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer">
                {site}
              </a>
            ) : (
              <span className="dim2">Add it in Settings</span>
            )}
          </div>
        </div>
        <div className="xpg-p">
          <span className="xpg-k">Business metric</span>
          <div className="xpg-v">{l.metric_name}</div>
        </div>
        <div className="xpg-p">
          <span className="xpg-k">What the business does</span>
          <Editable looper={l.id} text={l.brief ?? ""} rows={3}>
            <div className="xpg-v">{l.brief || <span className="dim2">Written when the looper plans its week.</span>}</div>
          </Editable>
        </div>
      </div>

      {steps.map((s) => {
        const st = l.setup?.[s.id];
        const fields = st?.status === "done" ? parseNotes(st.text) : [];
        return (
          <section key={s.id} className="xpg-s">
            <h3>
              {s.name}
              {st?.status === "done" && (
                <span className="c">
                  {" "}
                  {st.by ? "Edited" : "Learned"} by {who(st.by)}, {when(new Date(st.at), tz)}
                </span>
              )}
            </h3>
            {!st || st.status !== "done" ? (
              // A person can write the notes before the looper learns them, like the repo when GitHub has several.
              <Editable looper={l.id} step={s.id} text="">
                <p className={st?.status === "failed" ? "err" : "dim"}>
                  {!st ? "Not learned yet." : st.status === "waiting" ? "Waiting for its tool to be connected." : `Failed: ${st.text}`}
                  {s.id === "repo" && " Edit to name it yourself, like repo: owner/name."}
                </p>
              </Editable>
            ) : (
              <Editable looper={l.id} step={s.id} text={st.text}>
                <div className="xpg-props">
                  {fields.map((f, i) =>
                    f.key ? (
                      <div className="xpg-p" key={i}>
                        <span className="xpg-k">{label(f.key)}</span>
                        <Value f={f} />
                      </div>
                    ) : (
                      <p className="xpg-v" key={i}>
                        <Rich text={f.text} />
                      </p>
                    ),
                  )}
                </div>
              </Editable>
            )}
            {!!st?.history?.length && (
              <details className="xpg-h">
                <summary>
                  {st.history.length} earlier version{st.history.length > 1 ? "s" : ""}
                </summary>
                {st.history.map((h, i) => (
                  <div key={i}>
                    <div className="dim">
                      {h.by ? "Edited" : "Learned"} by {who(h.by)}, {when(new Date(h.at), tz)}
                    </div>
                    <pre>{h.text}</pre>
                  </div>
                ))}
              </details>
            )}
          </section>
        );
      })}

      {steps.length > 0 && (
        <div className="xpg-foot">
          <LearnAgain looper={l.id} edited={edited} />
          <span className="dim2">Reads {[...new Set(steps.map((s) => (s.tool ? names[s.tool] ?? s.tool : "the website")))].join(" and ")} again and writes the notes from scratch.</span>
        </div>
      )}

      {!l.fired_at && (
        <div className="xpg-foot">
          <Fire looper={l.id} name={l.name} />
          <span className="dim2">Stops every routine and takes {l.name} off the team. Cards, metric readings and reflections stay.</span>
        </div>
      )}
    </article>
  );
}
