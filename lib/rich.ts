// The small markdown a looper writes in chat: paragraphs, `-` and `1.` lists, **bold**, *italic*, `code`.
// Pure, tested in test/rich.test.ts. Anything else stays plain text; nothing becomes HTML.

export type Span = { t: "text" | "b" | "i" | "code"; v: string };
export type Block = { t: "p"; lines: Span[][] } | { t: "ul" | "ol"; start: number; items: Span[][] };

const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g;

export function spans(s: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ t: "text", v: s.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[4] !== undefined) out.push({ t: "i", v: m[4] });
    else out.push({ t: "b", v: (m[2] ?? m[3]).trim() });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ t: "text", v: s.slice(at) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+/;

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let cur = null as Block | null;
  const close = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(HEADING, "").trimEnd();
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (!line.trim()) close();
    else if (b || n) {
      const t = b ? "ul" : "ol";
      if (cur?.t !== t) {
        close();
        cur = { t, start: n ? Number(n[1]) : 1, items: [] };
      }
      cur.items.push(spans(b ? b[1] : n![2]));
    } else if (cur && cur.t !== "p" && /^\s{2,}/.test(raw)) {
      // An indented line continues the list item above it.
      const last = cur.items[cur.items.length - 1];
      last.push({ t: "text", v: " " }, ...spans(line.trim()));
    } else {
      if (cur?.t !== "p") {
        close();
        cur = { t: "p", lines: [] };
      }
      cur.lines.push(spans(line.trim()));
    }
  }
  close();
  return out;
}
