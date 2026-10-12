import { Fragment } from "react";
import { blocks, type Span } from "@/lib/rich";

function Spans({ s }: { s: Span[] }) {
  return s.map((x, i) =>
    x.t === "b" ? <b key={i}>{x.v}</b> : x.t === "i" ? <em key={i}>{x.v}</em> : x.t === "code" ? <code key={i}>{x.v}</code> : <Fragment key={i}>{x.v}</Fragment>,
  );
}

/** A looper's reply: paragraphs and lists from its markdown, rendered as text, never as HTML. */
export function Rich({ text }: { text: string }) {
  return (
    <div className="rich">
      {blocks(text).map((b, i) =>
        b.t === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Spans s={l} />
              </Fragment>
            ))}
          </p>
        ) : (
          (() => {
            const L = b.t;
            return (
              <L key={i} start={b.t === "ol" && b.start !== 1 ? b.start : undefined}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Spans s={it} />
                  </li>
                ))}
              </L>
            );
          })()
        ),
      )}
    </div>
  );
}
