import type { ReactNode } from "react";

/**
 * Renders the small slice of markdown models write in chat: paragraphs, headings,
 * bullet and numbered lists, **bold**, *italic*, `code` and [links](url).
 * Anything else stays as literal text, so we never show raw asterisks.
 */
type Block = { kind: "p"; text: string } | { kind: "h"; text: string } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

function blocks(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (const line of src.replace(/\r\n/g, "\n").split("\n")) {
    const b = line.match(BULLET) ?? line.match(NUMBER);
    const h = line.match(HEADING);
    if (!line.trim()) {
      flush();
    } else if (h) {
      flush();
      out.push({ kind: "h", text: h[1] });
    } else if (b) {
      flush();
      const kind = BULLET.test(line) ? "ul" : "ol";
      const last = out[out.length - 1];
      if (last?.kind === kind) last.items.push(b[1]);
      else out.push({ kind, items: [b[1]] });
    } else {
      const last = out[out.length - 1];
      if (!para.length && (last?.kind === "ul" || last?.kind === "ol") && /^\s{2,}/.test(line)) last.items[last.items.length - 1] += ` ${line.trim()}`;
      else para.push(line);
    }
  }
  flush();
  return out;
}

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*|https?:\/\/[^\s)]+)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__")))
      return <strong key={i} className="font-semibold">{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={i} className="rounded-[5px] bg-ink/[0.07] px-1 py-px font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link || /^https?:\/\//.test(part)) {
      const href = link ? link[2] : part;
      const safe = /^(https?:|mailto:|\/)/.test(href);
      if (!safe) return link ? link[1] : part;
      return (
        <a key={i} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
          {link ? link[1] : part}
        </a>
      );
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{inline(part.slice(1, -1))}</em>;
    return part;
  });
}

/** Same text with markdown markers removed, for one-line previews. */
export const plain = (s: string) =>
  s
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "");

export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {blocks(text).map((b, i) => {
        const gap = i === 0 ? "" : "mt-2.5";
        if (b.kind === "h") return <div key={i} className={`${gap} font-semibold`}>{inline(b.text)}</div>;
        if (b.kind === "p") return <p key={i} className={`${gap} whitespace-pre-wrap`}>{inline(b.text)}</p>;
        const List = b.kind;
        return (
          <List key={i} className={`${gap} flex flex-col gap-1 pl-5 ${b.kind === "ul" ? "list-disc marker:text-mute" : "list-decimal marker:text-mute"}`}>
            {b.items.map((it, j) => (
              <li key={j} className="pl-0.5">{inline(it)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
